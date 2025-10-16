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

import signal
from os import path, listdir
from datetime import datetime as dt, timedelta
import urllib.request as http
try:
    from bs4 import BeautifulSoup as bs
except Exception:
    bs = None
from modules.logging import init_logging, get_logger, log_action
from modules.redis_client import init_redis_client
from modules.rate_limiter import create_rate_limiter
from modules.presence_manager import RedisPresenceManager
from modules.force_logout_manager import RedisForceLogoutManager
from modules.file_cache_manager import RedisFileCacheManager
from modules.upload_manager import RedisUploadManager

from flask import render_template, url_for, request, redirect, session, Response, send_from_directory
from flask_login import login_user, logout_user, current_user
from flask_socketio import SocketIO

from modules.server import Server
from modules.threadpool import ThreadPool
from utils.common import make_dir
from services.media import MediaService
from services.permissions import dirs_by_permission
from routes import register_all
try:
    from werkzeug.middleware.proxy_fix import ProxyFix
except Exception:
    ProxyFix = None
from modules.middleware import init_middleware

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
        redis_client = init_redis_client(redis_config)
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

# Initialize Redis-based components
rate_limiters = create_rate_limiter(redis_client) if redis_client else {}
presence_manager = RedisPresenceManager(redis_client) if redis_client else None
force_logout_manager = RedisForceLogoutManager(
    redis_client) if redis_client else None
file_cache_manager = RedisFileCacheManager(
    redis_client) if redis_client else None
upload_manager = RedisUploadManager(redis_client) if redis_client else None

# Store components in app for access by routes
app.rate_limiters = rate_limiters
app.presence_manager = presence_manager
app.force_logout_manager = force_logout_manager
app.file_cache_manager = file_cache_manager
app.upload_manager = upload_manager

# Initialize middleware for access logging
try:
    init_middleware(app)
except Exception:
    pass

# Respect proxy headers to keep original scheme/host/port (avoids forced 443 redirects)
try:
    if ProxyFix:
        app.wsgi_app = ProxyFix(app.wsgi_app,
                                x_for=1,
                                x_proto=1,
                                x_host=1,
                                x_port=1)
except Exception:
    pass
# Optional cross-process message queue (e.g., Redis) to deliver emits across workers
_socketio_kwargs = {}
try:
    mq = None
    # Prefer dict-style access if available
    try:
        mq = app._sql.config['socketio']['message_queue']
    except Exception:
        # Fallback to ConfigParser-style access
        try:
            mq = app._sql.config.get('socketio',
                                     'message_queue',
                                     fallback=None)
        except Exception:
            mq = None
    # If Socket.IO message_queue not configured, try fallback to [redis]
    if not mq:
        try:
            # Try dict-style first
            redis_cfg = None
            try:
                redis_cfg = app._sql.config['redis']
            except Exception:
                redis_cfg = None
            if not redis_cfg:
                try:
                    # Access via ConfigParser interface
                    host = app._sql.config.get('redis',
                                               'server',
                                               fallback=None)
                    port = app._sql.config.get('redis', 'port', fallback=None)
                    password = app._sql.config.get('redis',
                                                   'password',
                                                   fallback=None)
                    socket_path = app._sql.config.get('redis',
                                                      'socket',
                                                      fallback=None)
                    db = app._sql.config.get('redis', 'db', fallback='0')
                    # Prefer unix socket if provided
                    if socket_path:
                        if password:
                            mq = f"redis+unix://:{password}@{socket_path}?db={db}"
                        else:
                            mq = f"redis+unix:///{socket_path}?db={db}"
                    elif host:
                        if password:
                            mq = f"redis://:{password}@{host}:{port or 6379}/{db}"
                        else:
                            mq = f"redis://{host}:{port or 6379}/{db}"
                except Exception:
                    mq = None
            else:
                # Dict-style config
                host = redis_cfg.get('server') or redis_cfg.get(
                    'host') or '127.0.0.1'
                port = redis_cfg.get('port') or 6379
                password = redis_cfg.get('password') or None
                socket_path = redis_cfg.get('socket') or None
                db = str(redis_cfg.get('db') or '0')
                try:
                    port = int(port)
                except Exception:
                    port = 6379
                if socket_path:
                    if password:
                        mq = f"redis+unix://:{password}@{socket_path}?db={db}"
                    else:
                        mq = f"redis+unix:///{socket_path}?db={db}"
                else:
                    if password:
                        mq = f"redis://:{password}@{host}:{port}/{db}"
                    else:
                        mq = f"redis://{host}:{port}/{db}"
        except Exception:
            mq = None
    if mq:
        _socketio_kwargs['message_queue'] = mq
        try:
            # Mask password in logs if present
            safe_mq = mq
            try:
                if '://' in safe_mq and '@' in safe_mq and '://' in safe_mq:
                    scheme_sep = safe_mq.find('://') + 3
                    at_pos = safe_mq.find('@', scheme_sep)
                    if at_pos != -1 and safe_mq[scheme_sep] == ':':
                        safe_mq = f"{safe_mq[:scheme_sep]}:***{safe_mq[at_pos:]}"
            except Exception:
                safe_mq = mq
            _log.debug('Socket.IO using message_queue=%s', safe_mq)
        except Exception:
            pass
except Exception:
    pass

socketio = SocketIO(
    app,
    async_mode='gevent',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False,
    ping_interval=20,
    ping_timeout=120,
    allow_upgrades=True,
    **_socketio_kwargs,
)
_socketio = socketio  # Store globally for shutdown
# Expose Socket.IO on app for route modules that look up app.socketio
try:
    setattr(app, 'socketio', socketio)
except Exception:
    pass
tp = ThreadPool(int(app._sql.config['videos']['max_threads']))
media_service = MediaService(tp, app._sql.config['files']['root'], app._sql,
                             socketio)
# NOTE: Removed early directory creation to avoid root-owned folders when gunicorn starts as root.
# Directories are created lazily in route handlers under the effective runtime user.
try:
    setattr(app, 'media_service', media_service)
except Exception:
    pass
register_all(app, tp, media_service, socketio)


# ==== DEV-ONLY START (TODO: remove in production) ============================
@app.after_request
def _dev_disable_cache(resp):
    try:
        resp.headers[
            'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
    except Exception:
        pass
    return resp


# ==== DEV-ONLY END ===========================================================


@app.errorhandler(401)
def unautorized(e):
    """Redirect unauthorized users to login, preserving original URL."""
    session['redirected_from'] = request.url
    return redirect(url_for('login'))


@app.errorhandler(403)
def forbidden(e):
    """Redirect forbidden access back to referrer or home."""
    return redirect(request.referrer if request.referrer != None else '/')


@app.errorhandler(404)
def not_found(e):
    """Redirect 404 back to referrer or home."""
    return redirect(request.referrer if request.referrer != None else '/')


@app.errorhandler(405)
def method_not_allowed(e):
    """Redirect 405 to home."""
    return redirect('/')


@app.errorhandler(413)
def too_large(e):
    """Return human-readable 413 payload too large error."""
    return f"Слишком большой файл {e}!", 403


def _render_50x(err, code):
    try:
        import traceback
        from datetime import datetime
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
    session['redirected_from'] = request.url
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
@app.rate_limiters.get('login', lambda f: f)
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
    target = session['redirected_from'] if 'redirected_from' in session.keys(
    ) else '/'
    # Mark that user just logged in to trigger one-time push permission prompt
    resp = redirect(target)
    try:
        resp.set_cookie('just_logged_in',
                        '1',
                        secure=True,
                        httponly=False,
                        samesite='Lax',
                        path='/')
    except Exception:
        pass
    return resp


@app.route('/logout')
def logout():
    """Terminate session and redirect to home."""
    user_name = current_user.name if current_user.is_authenticated else 'unknown'
    logout_user()
    log_action('LOGOUT', user_name, f'user logged out', request.remote_addr
               or '')
    if session.get('was_once_logged_in'):
        del session['was_once_logged_in']
    return redirect('/')


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
    """Serve static files with aggressive caching for offline functionality."""
    try:
        response = send_from_directory('static', filename)
        # ==== DEV-ONLY START (TODO: remove in production) ============================
        # During development, force-disable caching of static files to ensure the
        # recorder iframe (/files/rec) always loads fresh assets and avoids SW races.
        try:
            response.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        except Exception:
            pass
        return response
        # ==== DEV-ONLY END ===========================================================
        # --- PROD: uncomment the block below to re-enable aggressive caching ---
        # if filename.endswith(('.js', '.css')):
        #	 response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'  # 1 year
        #	 # Set Expires to 1 year from now
        #	 expires_date = dt.utcnow() + timedelta(days=365)
        #	 response.headers['Expires'] = expires_date.strftime('%a, %d %b %Y %H:%M:%S GMT')
        #	 response.headers['ETag'] = f'"{hash(filename)}"'
        # else:
        #	 # Moderate caching for other static files
        #	 response.headers['Cache-Control'] = 'public, max-age=86400'  # 1 day
        #	 # Set Expires to 1 day from now
        #	 expires_date = dt.utcnow() + timedelta(days=1)
        #	 response.headers['Expires'] = expires_date.strftime('%a, %d %b %Y %H:%M:%S GMT')
        # return response
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
@app.rate_limiters.get('proxy', lambda f: f)
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
        try:
            setattr(app, '_proxy_rate_limit', {})
        except Exception:
            pass

    import time
    current_time = time.time()
    rate_limiter = getattr(app, '_proxy_rate_limit', {})
    if client_ip in rate_limiter:
        last_request = rate_limiter[client_ip]
        if current_time - last_request < 1:  # Max 1 request per second per IP
            _log.warning(f'[proxy] rate limit exceeded for {client_ip}')
            return ''

    try:
        rate_limiter[client_ip] = current_time
        setattr(app, '_proxy_rate_limit', rate_limiter)
    except Exception:
        pass

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

        _log.debug('[proxy] fetch')
        raw = http.urlopen(target, timeout=15).read()
        html = bs(raw, features='html.parser') if bs else None
        body = getattr(html, 'body', None) if html is not None else None
        if not body:
            _log.warning(f'[proxy] no HTML body for {target}')
            return ''
        links = []
        try:
            links = list(reversed([i for i in body.find_all('a')]))
        except Exception:
            links = []
        if links:
            try:
                links.pop()
            except Exception:
                pass
        texts = [str(getattr(i, 'text', '')).strip() for i in links]
        # Filter empty and service anchors
        texts = [t for t in texts if t and t not in ('..', '.')]
        out = '|'.join(texts)
        # do not log extracted texts to avoid leaking remote content
        _log.debug(f'[proxy] links={len(texts)}')
        return out
    except Exception as e:
        _log.error(f'[proxy] error for {url}: {e}')
        return ''


def signal_handler(signum, frame):
    """Handle Ctrl+C (SIGINT) gracefully by shutting down subsystems."""
    _log.info('Получен сигнал остановки (Ctrl+C/TERM). Завершение работы...')

    # Stop Socket.IO gracefully
    try:
        socketio.stop()
        _log.info('Socket.IO остановлен.')
    except Exception as e:
        _log.exception('Ошибка при остановке Socket.IO: %s', e)

    # Stop media service
    try:
        media_service.stop()
        _log.info('Media service остановлен.')
    except Exception as e:
        _log.exception('Ошибка при остановке media service: %s', e)

    # Stop thread pool
    try:
        tp.stop()
        _log.info('Thread pool остановлен.')
    except Exception as e:
        _log.exception('Ошибка при остановке thread pool: %s', e)

    _log.info('Приложение корректно завершено.')
    exit(0)


# Register OS signal handlers for graceful shutdown
try:
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
except Exception:
    # In some environments (e.g., when managed by another server), signals may be handled externally
    pass


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    global _shutdown_requested
    if _shutdown_requested:
        _log.warning("Force shutdown requested, exiting immediately...")
        exit(1)

    _shutdown_requested = True
    _log.info(f"Received signal {signum}, initiating graceful shutdown...")

    try:
        # Stop Socket.IO gracefully
        if _socketio:
            _log.info("Stopping Socket.IO...")
            _socketio.stop()

        # Close Redis connection gracefully
        if _redis_client:
            _log.info("Closing Redis connection...")
            try:
                _redis_client.shutdown()
            except Exception as e:
                _log.warning(f"Error closing Redis connection: {e}")

        _log.info("Graceful shutdown completed")
    except Exception as e:
        _log.error(f"Error during graceful shutdown: {e}")
    finally:
        exit(0)


# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Removed DEV-only Socket.IO debug and rebroadcast handlers
if __name__ == '__main__':
    try:
        # Development only
        register_all(app, tp, media_service, socketio)
        try:
            app.logger.info(
                'Приложение запущено. Нажмите Ctrl+C для остановки.')
        except Exception:
            pass
        app.run_debug()
    except KeyboardInterrupt:
        signal_handler(signal.SIGINT, None)
