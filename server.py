# Gevent monkey patching must happen before any other imports
try:
    from gevent import monkey as _gevent_monkey
    _gevent_monkey.patch_all()

    from gunicorn.workers.ggevent import GeventWorker
    original = GeventWorker.handle_quit

    def graceful_handle_quit(self, sig, frame):
        """Gracefully mark worker loop as not alive to stop processing."""
        self.alive = False

    GeventWorker.handle_quit = graceful_handle_quit

    # geventwebsocket KeyError guard: some clients may have empty client_address
    # which triggers `KeyError: ''` on delete from server.clients
    try:
        from geventwebsocket import handler as _gw_handler
        _orig_run_ws = _gw_handler.WebSocketHandler.run_websocket

        def _safe_run_websocket(self, *args, **kwargs):
            try:
                return _orig_run_ws(self, *args, **kwargs)
            except KeyError:
                # Be defensive: ensure client is removed without raising
                try:
                    clients = getattr(self.server, 'clients', None)
                    addr = getattr(self, 'client_address', None)
                    if isinstance(clients, dict):
                        clients.pop(addr, None)
                except Exception:
                    pass
                return None

        _gw_handler.WebSocketHandler.run_websocket = _safe_run_websocket
    except Exception:
        pass
except Exception:
    pass
"""Main application bootstrap: app creation, core routes, and error handlers."""

import os
import signal
import time
import traceback
from configparser import SectionProxy
from datetime import datetime as dt, timedelta, datetime
from os import path, listdir
from typing import Any, Dict, List, Optional, Union
import urllib.request as http
from bs4 import BeautifulSoup as bs

from flask import render_template, url_for, request, redirect, session, Response, send_from_directory
from flask_login import login_user, logout_user, current_user
from flask_socketio import SocketIO
from socketio import RedisManager as _SioRedisManager
from werkzeug.middleware.proxy_fix import ProxyFix

from modules.logging import init_logging, get_logger, log_action
from modules.redis_client import init_redis_client
from modules.rate_limiter import create_rate_limiter
from modules.presence_manager import RedisPresenceManager
from modules.force_logout_manager import RedisForceLogoutManager
from modules.file_cache_manager import RedisFileCacheManager
from modules.upload_manager import RedisUploadManager
from modules.server import Server
from modules.threadpool import ThreadPool
from modules.middleware import init_middleware

from routes import register_all
from services.media import MediaService
from services.permissions import dirs_by_permission
from utils.common import make_dir

# Initialize logging first
init_logging()
_log = get_logger(__name__)

# Global variables for graceful shutdown
_redis_client = None
_socketio = None
_shutdown_requested = False

# Initialize Redis client
redis_client = None
try:
    # We need to create a temporary app to read config
    temp_app = Server(path.dirname(path.realpath(__file__)))
    redis_config = {}
    # Try dict-style access first
    try:
        redis_config = temp_app._sql.config['redis']
    except Exception:
        # Fallback to ConfigParser-style access
        try:
            redis_config = {
                'server':
                temp_app._sql.config.get('redis', 'server', fallback=None),
                'port':
                temp_app._sql.config.get('redis', 'port', fallback=6379),
                'password':
                temp_app._sql.config.get('redis', 'password', fallback=None),
                'socket':
                temp_app._sql.config.get('redis', 'socket', fallback=None),
                'db':
                temp_app._sql.config.get('redis', 'db', fallback=0)
            }
            # Convert port to int
            try:
                redis_config['port'] = int(redis_config['port'])
            except (ValueError, TypeError):
                redis_config['port'] = 6379
        except Exception:
            redis_config = {}

    if redis_config:
        _log.info("Attempting to connect to Redis...")
        # Normalize to dict for typed init_redis_client
        try:
            if isinstance(redis_config, SectionProxy):
                redis_config = {
                    'server': redis_config.get('server', fallback=None),
                    'port':
                    int(redis_config.get('port', fallback='6379') or 6379),
                    'password': redis_config.get('password', fallback=None),
                    'socket': redis_config.get('socket', fallback=None),
                    'db': redis_config.get('db', fallback='0'),
                }
        except Exception:
            pass
        # Convert to plain dict and coalesce None to {}
        redis_dict = (dict(redis_config) if hasattr(redis_config, 'items') else
                      (redis_config or {}))
        # Type assertion for mypy - we know it's a dict at this point
        redis_client = init_redis_client(redis_dict)  # type: ignore
        if not redis_client or not redis_client.connected:
            _log.error("❌ Redis connection FAILED - application cannot start")
            _log.error(
                "Please check Redis configuration and ensure Redis server is running"
            )
            exit(1)
        else:
            _log.info("✅ Redis connection SUCCESSFUL")
            _redis_client = redis_client  # Store globally for shutdown
    else:
        _log.warning(
            "No Redis configuration found - using fallback mechanisms")
except Exception as e:
    _log.error(f"Redis initialization error: {e}")
    exit(1)

# Create main app with Redis client
app = Server(path.dirname(path.realpath(__file__)), redis_client=redis_client)
# No adapter: use ConfigParser (config.ini) only

# Initialize Redis-based components
rate_limiters = create_rate_limiter(redis_client) if redis_client else {}
presence_manager = RedisPresenceManager(redis_client) if redis_client else None
force_logout_manager = RedisForceLogoutManager(
    redis_client) if redis_client else None
file_cache_manager = RedisFileCacheManager(
    redis_client) if redis_client else None
upload_manager = RedisUploadManager(redis_client) if redis_client else None

# Store components in app for access by routes
setattr(app, 'rate_limiters', rate_limiters)
setattr(app, 'presence_manager', presence_manager)
setattr(app, 'force_logout_manager', force_logout_manager)
setattr(app, 'file_cache_manager', file_cache_manager)
setattr(app, 'upload_manager', upload_manager)

# Re-enable presence and force-logout (disabled during testing)
app.config['PRESENCE_DISABLED'] = False
app.config['FORCE_LOGOUT_DISABLED'] = False
app.config['VERSION'] = '0.1.0'
_log.info('Presence and force-logout features are ENABLED')


# Expose selected config to client-side (read once at startup)
def _get_sync_idle_seconds() -> int:
    val = int(app._sql.config.get('web', 'sync_idle_seconds', fallback='30'))
    return val if val > 0 else 30


app.config['SYNC_IDLE_SECONDS'] = _get_sync_idle_seconds()


@app.context_processor
def inject_client_config():
    return {
        '__config': {
            'syncIdleSeconds': int(app.config.get('SYNC_IDLE_SECONDS') or 30),
        }
    }


# Initialize middleware for access logging
init_middleware(app)

# Respect proxy headers to keep original scheme/host/port (avoids forced 443 redirects)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
# Always build cross-process Redis manager from [redis] config (force Redis client_manager)
_socketio_kwargs = {}
_client_manager = None
_client_manager_url = None
try:
    mq = None  # legacy/broker url (unused now)
    cm_url = None  # client manager url for python-socketio RedisManager
    # Build from [redis]
    try:
        redis_cfg = None
        try:
            redis_cfg = app._sql.config['redis']
        except Exception:
            redis_cfg = None
        if redis_cfg and isinstance(redis_cfg, dict):
            host = redis_cfg.get('server') or redis_cfg.get('host') or None
            port = int(redis_cfg.get('port') or 6379)
            password = redis_cfg.get('password') or None
            socket_path = redis_cfg.get('socket') or None
            db = str(redis_cfg.get('db') or '0')
        else:
            host = app._sql.config.get('redis', 'server', fallback=None)
            port = app._sql.config.get('redis', 'port', fallback=None)
            password = app._sql.config.get('redis', 'password', fallback=None)
            socket_path = app._sql.config.get('redis', 'socket', fallback=None)
            db = app._sql.config.get('redis', 'db', fallback='0')
            try:
                port = int(port) if port else 6379
            except Exception:
                port = 6379
        if socket_path:
            # Valid for python-socketio RedisManager
            cm_url = (f"unix://:{password}@{socket_path}?db={db}"
                      if password else f"unix:///{socket_path}?db={db}")
            # Keep legacy form only for logging compatibility if needed
            mq = (f"redis+unix://:{password}@{socket_path}?db={db}"
                  if password else f"redis+unix:///{socket_path}?db={db}")
        elif host:
            cm_url = (f"redis://:{password}@{host}:{port}/{db}"
                      if password else f"redis://{host}:{port}/{db}")
            mq = cm_url
    except Exception:
        mq = None
    if cm_url:
        try:
            # Force Redis client manager to avoid accidental KombuManager selection
            _client_manager = _SioRedisManager(cm_url)
            _socketio_kwargs['client_manager'] = _client_manager
            safe_mq = cm_url
            if '://' in safe_mq and '@' in safe_mq:
                scheme_sep = safe_mq.find('://') + 3
                at_pos = safe_mq.find('@', scheme_sep)
                if at_pos != -1 and safe_mq[scheme_sep] == ':':
                    safe_mq = f"{safe_mq[:scheme_sep]}:***{safe_mq[at_pos:]}"
            _log.info('Socket.IO using Redis (client_manager) url=%s', safe_mq)
        except Exception as e:
            _log.error(f"Failed to initialize Redis client manager: {e}")
    else:
        _log.info('Socket.IO message_queue disabled (single-process/dev mode)')
except Exception:
    pass

socketio = SocketIO(
    app,
    async_mode='gevent',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=True,
    ping_interval=20,
    ping_timeout=120,
    allow_upgrades=True,
    **_socketio_kwargs,
)
_socketio = socketio  # Store globally for shutdown
# Expose Socket.IO on app for route modules that look up app.socketio
setattr(app, 'socketio', socketio)
manager_obj = getattr(getattr(socketio, 'server', None), 'manager', None)
manager_name = manager_obj.__class__.__name__ if manager_obj is not None else 'None'
if _client_manager is not None:
    _log.info('Socket.IO client manager=%s, Redis configured', manager_name)
else:
    _log.info(
        'Socket.IO client manager=%s, message_queue not configured (single-process/dev)',
        manager_name)
tp = ThreadPool(int(app._sql.config['videos']['max_threads']))
media_service = MediaService(tp, app._sql.config['files']['root'], app._sql,
                             socketio)
# NOTE: Removed early directory creation to avoid root-owned folders when gunicorn starts as root.
# Directories are created lazily in route handlers under the effective runtime user.
setattr(app, 'media_service', media_service)
register_all(app, tp, media_service, socketio)


@app.errorhandler(401)
def unautorized(e):
    """Redirect unauthorized users to login, preserving original URL."""
    try:
        # Preserve target only for real page navigations (not XHR/JSON endpoints)
        def _is_html_nav(req):
            if req.method != 'GET':
                return False
            accept = (req.headers.get('Accept') or '')
            if 'text/html' not in accept:
                return False
            if (req.headers.get('X-Requested-With') or '') == 'XMLHttpRequest':
                return False
            return True

        def _disallowed_target(path: str) -> bool:
            p = path or ''
            return (p.startswith('/admin/presence')
                    or p.startswith('/presence/')
                    or p.startswith('/admin/sessions')
                    or p.startswith('/push/') or p.startswith('/api/'))

        if request.endpoint != 'login' and _is_html_nav(
                request) and not _disallowed_target(request.path):
            session['redirected_from'] = request.url
        return redirect(url_for('login'))
    except Exception:
        return redirect(url_for('login'))


@app.errorhandler(403)
def forbidden(e):
    """Redirect forbidden access back to referrer or home."""
    try:
        ref = request.referrer
        # Avoid redirect loops: if no referrer or referrer equals current URL, go home
        if not ref or ref == request.url:
            return redirect('/')
        # Avoid redirecting to JSON/service endpoints
        try:
            from urllib.parse import urlparse
            path_only = (urlparse(ref).path or '')
            if path_only.startswith('/admin/presence') or path_only.startswith('/presence/') or \
               path_only.startswith('/admin/sessions') or path_only.startswith('/push/') or \
               path_only.startswith('/api/'):
                return redirect('/')
        except Exception:
            pass
        return redirect(ref)
    except Exception:
        return redirect('/')


@app.errorhandler(404)
def not_found(e):
    """Redirect 404 back to referrer or home."""
    try:
        ref = request.referrer
        # Avoid redirect loops: if no referrer or referrer equals current URL, go home
        if not ref or ref == request.url:
            return redirect('/')
        # Avoid redirecting to JSON/service endpoints
        try:
            from urllib.parse import urlparse
            path_only = (urlparse(ref).path or '')
            if path_only.startswith('/admin/presence') or path_only.startswith('/presence/') or \
               path_only.startswith('/admin/sessions') or path_only.startswith('/push/') or \
               path_only.startswith('/api/'):
                return redirect('/')
        except Exception:
            pass
        return redirect(ref)
    except Exception:
        return redirect('/')


@app.errorhandler(405)
def method_not_allowed(e):
    """Redirect 405 to home."""
    try:
        ref = request.referrer
        if not ref or ref == request.url:
            return redirect('/')
        # Avoid redirecting to JSON/service endpoints
        try:
            from urllib.parse import urlparse
            path_only = (urlparse(ref).path or '')
            if path_only.startswith('/admin/presence') or path_only.startswith('/presence/') or \
               path_only.startswith('/admin/sessions') or path_only.startswith('/push/') or \
               path_only.startswith('/api/'):
                return redirect('/')
        except Exception:
            pass
        return redirect(ref)
    except Exception:
        return redirect('/')


@app.errorhandler(413)
def too_large(e):
    """Return human-readable 413 payload too large error."""
    return f"Слишком большой файл {e}!", 403


def _render_50x(err, code):
    try:
        now_text = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        details = ''.join(traceback.format_exc())
        # If there is no active exception context, format_exc returns 'NoneType: None\n'
        if details.strip() == 'NoneType: None':
            details = ''
        # Keep only from the last traceback frame for brevity
        if details:
            marker = 'File '
            last = details.rfind(marker)
            if last != -1:
                details = details[last:]
        return render_template(
            'error_pages/50x.j2.html',
            error_text=str(err),
            error_details=details,
            now_text=now_text,
        ), code
    except Exception:
        return f"Ошибка сервера {err}! Сообщите о проблеме 21-00 (ОАСУ).", code


@app.errorhandler(500)
def internal_server_error(e):
    return _render_50x(e, 500)


@app.errorhandler(502)
def bad_gateway(e):
    return _render_50x(e, 502)


@app.errorhandler(503)
def service_unavailable(e):
    return _render_50x(e, 503)


@app.errorhandler(504)
def gateway_timeout(e):
    return _render_50x(e, 504)


@app.login_manager.user_loader
def load_user(id):
    """Load user for session management; ignore disabled accounts."""
    user = app._sql.user_by_id([id])
    if user and not user.is_enabled():
        return None
    return user


@app.login_manager.unauthorized_handler
def unauthorized_handler():
    """Handle unauthorized access by redirecting to login and saving target."""
    try:

        def _is_html_nav(req):
            if req.method != 'GET':
                return False
            accept = (req.headers.get('Accept') or '')
            if 'text/html' not in accept:
                return False
            if (req.headers.get('X-Requested-With') or '') == 'XMLHttpRequest':
                return False
            return True

        def _disallowed_target(path: str) -> bool:
            p = path or ''
            return (p.startswith('/admin/presence')
                    or p.startswith('/presence/')
                    or p.startswith('/admin/sessions')
                    or p.startswith('/push/') or p.startswith('/api/'))

        if request.endpoint != 'login' and _is_html_nav(
                request) and not _disallowed_target(request.path):
            session['redirected_from'] = request.url
        return redirect(url_for('login'))
    except Exception:
        return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
@getattr(app, 'rate_limiters', {}).get('login', lambda f: f)
def login():
    """Authenticate user and start session.

	- GET: render login form
	- POST: validate credentials and redirect to previous target or home

	Logs authentication attempts in actions.log.
	"""
    if current_user.is_authenticated:
        return redirect('/')
    if request.method == 'GET':
        return render_template('login.j2.html')
    user = app._sql.user_by_login([request.form['login']])
    if not user:
        app.flash_error('Неверное имя пользователя или пароль!')
        log_action('LOGIN',
                   'unknown',
                   'login failed: user not found',
                   request.remote_addr or '',
                   success=False)
        return render_template('login.j2.html')
    if not user.is_enabled():
        app.flash_error('Пользователь отключен!')
        log_action('LOGIN',
                   user.name,
                   'login failed: user disabled',
                   request.remote_addr or '',
                   success=False)
        return render_template('login.j2.html')
    if app.hash(request.form['password']) != user.password:
        app.flash_error('Неверное имя пользователя или пароль!')
        log_action('LOGIN',
                   user.name,
                   'login failed: bad password',
                   request.remote_addr or '',
                   success=False)
        return render_template('login.j2.html')
    login_user(user)
    log_action('LOGIN', user.name, f'user logged in', request.remote_addr
               or '')

    def _sanitize_target(url: str) -> str:
        try:
            if not url:
                return '/'
            # Only allow same-origin relative paths, avoid JSON endpoints
            from urllib.parse import urlparse
            parsed = urlparse(url)
            # If absolute URL, drop to path
            path_only = parsed.path or '/'
            disallowed = (path_only.startswith('/admin/presence')
                          or path_only.startswith('/presence/')
                          or path_only.startswith('/admin/sessions')
                          or path_only.startswith('/push/')
                          or path_only.startswith('/api/'))
            return '/' if disallowed else (path_only or '/')
        except Exception:
            return '/'

    target = _sanitize_target(session.get(
        'redirected_from')) if 'redirected_from' in session.keys() else '/'
    # Mark that user just logged in to trigger one-time push permission prompt
    resp = redirect(target)
    resp.set_cookie('just_logged_in',
                    '1',
                    secure=True,
                    httponly=False,
                    samesite='Lax',
                    path='/')
    return resp


@app.route('/logout')
def logout():
    """Terminate session and redirect to home."""
    user_name = current_user.name if current_user.is_authenticated else 'unknown'
    user_id = getattr(current_user, 'id',
                      None) if current_user.is_authenticated else None
    # Remove any presence entries for this user
    try:
        if user_id is not None and presence_manager is not None:
            presence_manager.remove_user_presence(int(user_id))
    except Exception:
        pass
    # Remove current HTTP session from tracked active sessions (best-effort)
    try:
        cookie_name = getattr(app, 'session_cookie_name', 'session')
        sid = request.cookies.get(cookie_name) or request.cookies.get(
            'session')
        if sid and hasattr(app, '_sessions'):
            app._sessions.pop(sid, None)
    except Exception:
        pass
    # Fully clear server-side session and logout
    logout_user()
    session.clear()
    log_action('LOGOUT', user_name, f'user logged out', request.remote_addr
               or '')
    # Build response and explicitly clear cookies so client stops sending stale sid
    resp = redirect('/')
    try:
        resp.delete_cookie(app.session_cookie_name,
                           path='/',
                           samesite=app.config.get('SESSION_COOKIE_SAMESITE',
                                                   'Lax'))
        resp.delete_cookie('session',
                           path='/',
                           samesite=app.config.get('SESSION_COOKIE_SAMESITE',
                                                   'Lax'))
        resp.delete_cookie('remember_token',
                           path='/',
                           samesite=app.config.get('REMEMBER_COOKIE_SAMESITE',
                                                   'Lax'))
    except Exception:
        pass
    return resp


@app.route('/theme')
def theme():
    """Cycle UI theme and return to referrer."""
    if 'theme' in session.keys():
        session['theme'] = (session['theme'] +
                            1) % (len(listdir('static/css/themes')) - 1)
    else:
        session['theme'] = 1
    return redirect(request.referrer)


@app.route('/static/<path:filename>')
def static_files(filename):
    """Serve static files with proper caching for development and production."""
    try:
        response = send_from_directory('static', filename)

        # Check if we're in development mode
        is_dev = app.debug

        if is_dev:
            # Development mode: disable caching to ensure fresh assets
            response.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        else:
            # Production mode: enable aggressive caching
            if filename.endswith(('.js', '.css')):
                response.headers[
                    'Cache-Control'] = 'public, max-age=31536000, immutable'  # 1 year
                # Set Expires to 1 year from now
                expires_date = dt.utcnow() + timedelta(days=365)
                response.headers['Expires'] = expires_date.strftime(
                    '%a, %d %b %Y %H:%M:%S GMT')
                response.headers['ETag'] = f'"{hash(filename)}"'
            else:
                # Moderate caching for other static files
                response.headers[
                    'Cache-Control'] = 'public, max-age=86400'  # 1 day
                # Set Expires to 1 day from now
                expires_date = dt.utcnow() + timedelta(days=1)
                response.headers['Expires'] = expires_date.strftime(
                    '%a, %d %b %Y %H:%M:%S GMT')

        return response
    except Exception as e:
        _log.error(f"Failed to serve static file {filename}: {e}")
        return Response('File not found', status=404)


@app.route('/proxy' + '/<string:url>', methods=['GET'])
@getattr(app, 'rate_limiters', {}).get('proxy', lambda f: f)
def proxy(url: str) -> str:
    """Simple proxy to fetch and parse links from remote HTML (internal use only)."""

    # Protection Layer 1: Check Referer header
    referer = request.headers.get('Referer', '')
    if not referer or '/files/' not in referer:
        _log.warning(f'[proxy] blocked: bad referer: {referer}')
        return ''

    # Protection Layer 2: Check for special header from registrator import
    registrator_header = request.headers.get('X-Registrator-Import', '')
    if registrator_header != '1':
        _log.warning('[proxy] blocked: missing import header')
        return ''

    # Protection Layer 3: Check User-Agent (should be from browser, not direct calls)
    user_agent = request.headers.get('User-Agent', '')
    if not user_agent or len(user_agent) < 10:
        _log.warning(f'[proxy] blocked: suspicious user-agent: {user_agent}')
        return ''

    # Protection Layer 4: Rate limiting per IP
    client_ip = request.environ.get('REMOTE_ADDR', '') or ''
    if not hasattr(app, '_proxy_rate_limit') or not isinstance(
            getattr(app, '_proxy_rate_limit'), dict):
        setattr(app, '_proxy_rate_limit', {})

    current_time = time.time()
    rate_limiter = getattr(app, '_proxy_rate_limit', {})
    if client_ip in rate_limiter:
        last_request = rate_limiter[client_ip]
        if current_time - last_request < 1:  # Max 1 request per second per IP
            _log.warning(f'[proxy] rate limit exceeded for {client_ip}')
            return ''

    rate_limiter[client_ip] = current_time
    setattr(app, '_proxy_rate_limit', rate_limiter)

    # Protection Layer 5: Validate URL format
    if not url or len(url) < 3 or '!' not in url:
        _log.warning(f'[proxy] blocked: bad url format: {url}')
        return ''

    # Protection Layer 6: Check for suspicious patterns
    suspicious_patterns = ['..', 'admin', 'config', 'system', 'etc', 'proc']
    url_lower = url.lower()
    for pattern in suspicious_patterns:
        if pattern in url_lower:
            _log.warning(f'[proxy] blocked: suspicious pattern in {url}')
            return ''

    try:
        target = 'http://' + url.replace('!', '/')
        raw = http.urlopen(target, timeout=15).read()
        html = bs(raw, features='html.parser') if bs else None
        body = getattr(html, 'body', None) if html is not None else None
        if not body:
            return ''
        links = list(reversed([i for i in body.find_all('a')]))
        if links:
            links.pop()
        texts = [str(getattr(i, 'text', '')).strip() for i in links]
        texts = [t for t in texts if t and t not in ('..', '.')]
        return '|'.join(texts)
    except Exception:
        return ''


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully (idempotent)."""
    global _shutdown_requested
    if _shutdown_requested:
        _log.warning("Repeated shutdown signal received, ignoring duplicate")
        return

    _shutdown_requested = True
    _log.info(f"Received signal {signum}, initiating graceful shutdown...")

    # Under Gunicorn, worker lifecycle is managed by master; skip socketio.stop()
    running_under_gunicorn = False
    try:
        running_under_gunicorn = ('gunicorn' in os.environ.get(
            'SERVER_SOFTWARE', '').lower()
                                  or 'GUNICORN_CMD_ARGS' in os.environ)
    except Exception:
        running_under_gunicorn = False

    # Stop Socket.IO gracefully only in standalone/dev runs
    if not running_under_gunicorn:
        if _socketio is not None and hasattr(_socketio, 'stop'):
            _log.info("Stopping Socket.IO...")
            try:
                _socketio.stop()
            except Exception as e:
                _log.warning(f"Socket.IO stop error: {e}")

    # Stop media service
    if 'media_service' in globals() and media_service:
        try:
            media_service.stop()
            _log.info('Media service stopped.')
        except Exception as e:
            _log.warning(f"Media service stop error: {e}")

    # Stop thread pool
    if 'tp' in globals() and tp:
        try:
            tp.stop()
            _log.info('Thread pool stopped.')
        except Exception as e:
            _log.warning(f"Thread pool stop error: {e}")

    # Close Redis connection gracefully
    if _redis_client is not None:
        _log.info("Closing Redis connection...")
        try:
            _redis_client.shutdown()
        except Exception as e:
            _log.warning(f"Error closing Redis connection: {e}")

    _log.info("Graceful shutdown completed")
    exit(0)


# Register signal handlers once
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Removed DEV-only Socket.IO debug and rebroadcast handlers
if __name__ == '__main__':
    # Development only
    register_all(app, tp, media_service, socketio)
    app.logger.info('Приложение запущено. Нажмите Ctrl+C для остановки.')
    app.run_debug()
