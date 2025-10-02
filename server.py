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
from datetime import datetime as dt
import urllib.request as http
from bs4 import BeautifulSoup as bs
from modules.logging import init_logging, get_logger, log_action

from flask import render_template, url_for, request, redirect, session, Response
from flask_login import login_user, logout_user, current_user
from flask_socketio import SocketIO

from modules.server import Server
from modules.threadpool import ThreadPool
from utils.common import make_dir
from services.media import MediaService
from services.permissions import dirs_by_permission
from routes import register_all
from werkzeug.middleware.proxy_fix import ProxyFix
from modules.middleware import init_middleware

app = Server(path.dirname(path.realpath(__file__)))
# Initialize logging
init_logging()
_log = get_logger(__name__)

# Initialize middleware for access logging
init_middleware(app)

# Respect proxy headers to keep original scheme/host/port (avoids forced 443 redirects)
try:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
except Exception:
    pass
socketio = SocketIO(
    app,
    async_mode='gevent',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False,
    ping_interval=25,
    ping_timeout=60,
    allow_upgrades=True,
    transports=['websocket', 'polling'],
)
tp = ThreadPool(int(app._sql.config['videos']['max_threads']))
media_service = MediaService(tp, app._sql.config['files']['root'], app._sql, socketio)
register_all(app, tp, media_service, socketio)

make_dir(app._sql.config['files']['root'], 'video')
make_dir(app._sql.config['files']['root'], 'req')

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

@app.errorhandler(500)
def internal_server_error(e):
    """Return generic 500 error with contact hint."""
    return f"Ошибка сервера {e}! Сообщите о проблеме 21-00 (ОАСУ).", 500

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
        log_action('LOGIN', 'unknown', 'login failed: user not found', request.remote_addr, success=False)
        return render_template('login.j2.html')
    if not user.is_enabled():
        app.flash_error('Пользователь отключен!')
        log_action('LOGIN', user.name, 'login failed: user disabled', request.remote_addr, success=False)
        return render_template('login.j2.html')
    if app.hash(request.form['password']) != user.password:
        app.flash_error('Неверное имя пользователя или пароль!')
        log_action('LOGIN', user.name, 'login failed: bad password', request.remote_addr, success=False)
        return render_template('login.j2.html')
    login_user(user)
    log_action('LOGIN', user.name, f'user logged in', request.remote_addr)
    return redirect(session['redirected_from'] if 'redirected_from' in session.keys() else '/')

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
        session['theme'] = (session['theme'] + 1) % (len(listdir('static/css/themes')) - 1)
    else:
        session['theme'] = 1
    return redirect(request.referrer)

@app.route('/proxy' + '/<string:url>', methods=['GET'])
def proxy(url: str) -> str:
    """Simple proxy to fetch and parse links from remote HTML (internal use)."""
    raw = http.urlopen('http://' + url.replace('!', '/')).read()
    html = bs(raw, features='html.parser')
    links = list(reversed([i for i in html.body.findAll('a')]))
    if links:
        try:
            links.pop()
        except Exception:
            pass
    return '|'.join(i.text for i in links)

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

if __name__ == '__main__':
    try:
        # Development only
        register_all(app, tp, media_service, socketio)
        print('Приложение запущено. Нажмите Ctrl+C для остановки.')
        app.run_debug()
    except KeyboardInterrupt:
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
