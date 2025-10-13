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

app = Server(path.dirname(path.realpath(__file__)))
# Initialize logging
init_logging()
_log = get_logger(__name__)

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
    if mq:
        _socketio_kwargs['message_queue'] = mq
        try:
            _log.debug('Socket.IO using message_queue=%s', mq)
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
                   request.remote_addr,
                   success=False)
        return render_template('login.j2.html')
    if not user.is_enabled():
        app.flash_error('Пользователь отключен!')
        log_action('LOGIN',
                   user.name,
                   'login failed: user disabled',
                   request.remote_addr,
                   success=False)
        return render_template('login.j2.html')
    if app.hash(request.form['password']) != user.password:
        app.flash_error('Неверное имя пользователя или пароль!')
        log_action('LOGIN',
                   user.name,
                   'login failed: bad password',
                   request.remote_addr,
                   success=False)
        return render_template('login.j2.html')
    login_user(user)
    log_action('LOGIN', user.name, f'user logged in', request.remote_addr)
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
    log_action('LOGOUT', user_name, f'user logged out', request.remote_addr)
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
        #     response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'  # 1 year
        #     # Set Expires to 1 year from now
        #     expires_date = dt.utcnow() + timedelta(days=365)
        #     response.headers['Expires'] = expires_date.strftime('%a, %d %b %Y %H:%M:%S GMT')
        #     response.headers['ETag'] = f'"{hash(filename)}"'
        # else:
        #     # Moderate caching for other static files
        #     response.headers['Cache-Control'] = 'public, max-age=86400'  # 1 day
        #     # Set Expires to 1 day from now
        #     expires_date = dt.utcnow() + timedelta(days=1)
        #     response.headers['Expires'] = expires_date.strftime('%a, %d %b %Y %H:%M:%S GMT')
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
def proxy(url: str) -> str:
    """Simple proxy to fetch and parse links from remote HTML (internal use)."""
    try:
        target = 'http://' + url.replace('!', '/')
        _log.info('[proxy] fetch %s', target)
        raw = http.urlopen(target, timeout=15).read()
        html = bs(raw, features='html.parser') if bs else None
        if not html or not getattr(html, 'body', None):
            _log.warning('[proxy] no HTML body for %s', target)
            return ''
        links = list(reversed([i for i in html.body.findAll('a')]))
        if links:
            try:
                links.pop()
            except Exception:
                pass
        texts = [str(getattr(i, 'text', '')).strip() for i in links]
        # Filter empty and service anchors
        texts = [t for t in texts if t and t not in ('..', '.')]
        out = '|'.join(texts)
        try:
            _log.info('[proxy] %d links: %s', len(texts),
                      ', '.join(texts[:20]))
        except Exception:
            pass
        return out
    except Exception as e:
        _log.error('[proxy] error for %s: %s', url, e)
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

# Removed DEV-only Socket.IO debug and rebroadcast handlers
if __name__ == '__main__':
    try:
        # Development only
        register_all(app, tp, media_service, socketio)
        print('Приложение запущено. Нажмите Ctrl+C для остановки.')
        app.run_debug()
    except KeyboardInterrupt:
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
