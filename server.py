# Gevent monkey patching must happen before any other imports
try:
    from gevent import monkey as _gevent_monkey
    _gevent_monkey.patch_all()
    
    from gunicorn.workers.ggevent import GeventWorker
    original = GeventWorker.handle_quit
    def graceful_handle_quit(self, sig, frame):
        self.alive = False  # просто останавливаем цикл
    GeventWorker.handle_quit = graceful_handle_quit
except Exception:
    pass

from flask import render_template, url_for, request, send_from_directory, redirect, session, abort, Response
from flask_login import login_required, login_user, logout_user, current_user
from datetime import datetime as dt
from datetime import timedelta as td
from os import path, rename, remove, mkdir, listdir
from subprocess import Popen
from re import search
from bs4 import BeautifulSoup as bs
import urllib.request as http
from hashlib import md5

from classes.user import User
from classes.request import Request
from classes.order import Order
from classes.page import Page, Pages
from modules.server import Server
from flask_socketio import SocketIO
from modules.threadpool import ThreadPool
from utils.common import make_dir, hash_str
from services.media import MediaService
from services.permissions import dirs_by_permission
from routes import register_all
#from werkzeug.middleware.proxy_fix import ProxyFix

#import signal
    
#def handle_exit(sig, frame):
#    print("Получен сигнал завершения, выходим корректно...")
#    sys.exit(0)
    
# Register signal handler for Ctrl+C
#signal.signal(signal.SIGINT, handle_exit)
#signal.signal(signal.SIGTERM, handle_exit)

app = Server(path.dirname(path.realpath(__file__)))
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins='*', logger=False, engineio_logger=False, ping_interval=25, ping_timeout=60, allow_upgrades=True, transports=['websocket', 'polling'])
tp = ThreadPool(int(app._sql.config['videos']['max_threads']))
media_service = MediaService(tp, app._sql.config['files']['root'], app._sql, socketio)
register_all(app, tp, media_service, socketio)

# moved to utils.common: make_dir, hash_str

make_dir(app._sql.config['files']['root'], 'video')
make_dir(app._sql.config['files']['root'], 'req')

# Trust proxy headers from Nginx for correct scheme/host and login redirects
#app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

@app.context_processor
def inject_pages():
    return dict(pages=app.pages)

#############################################################
#   404   401   403   500   421     413

@app.errorhandler(401)
def unautorized(e):
    session['redirected_from'] = request.url
    return redirect(url_for('login'))

@app.errorhandler(403)
def forbidden(e):
    return redirect(request.referrer if request.referrer != None else '/')

@app.errorhandler(404)
def not_found(e):
    return redirect(request.referrer if request.referrer != None else '/')

@app.errorhandler(405)
def method_not_allowed(e):
    return redirect('/')

@app.errorhandler(413)
def too_large(e):
    return f"Слишком большой файл {e}!", 403

@app.errorhandler(500)
def internal_server_error(e):
    return f"Ошибка сервера {e}! Сообщите о проблемме 21-00 (ОАСУ).", 500

##############################################################

@app.login_manager.user_loader
def load_user(id):
    user = app._sql.user_by_id([id])
    if user and not user.is_enabled():
        return None
    return user

@app.login_manager.unauthorized_handler
def unauthorized_handler():
    session['redirected_from'] = request.url
    return redirect(url_for('login'))

################################################################

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect('/')
    if request.method == 'GET':
        return render_template('login.j2.html')
    user = app._sql.user_by_login([request.form['login']])
    if not user:
        app.flash_error('Неверное имя пользователя или пароль!')
        return render_template('login.j2.html')
    if not user.is_enabled():
        app.flash_error('Пользователь откючен!')
        return render_template('login.j2.html')
    if app.hash(request.form['password']) != user.password:
        app.flash_error(f'Неверное имя пользователя или пароль!')
        return render_template('login.j2.html')
    login_user(user)
    return redirect(session['redirected_from'] if 'redirected_from' in session.keys() else '/')

@app.route('/logout')
def logout():
    logout_user()
    if session.get('was_once_logged_in'):
        del session['was_once_logged_in']
    return redirect('/')

@app.route('/theme')
def theme():
    if 'theme' in session.keys():
        session['theme'] = (session['theme'] + 1) % (len(listdir('static/css/themes')) - 1)
    else:
        session['theme'] = 1
    return redirect(request.referrer)

#######################################################

@app.route('/', methods=['GET'])
def index():
    if current_user.is_authenticated == False:
        return redirect('/login')
    return render_template('index.j2.html')

#############################################################

#############################################################

@app.route('/proxy' + '/<string:url>', methods=['GET'])
def proxy(url):
    rem = lambda x, a : a.remove(x) if x in a else None
    raw = http.urlopen('http://' + url.replace("!", "/")).read()
    html = bs(raw, features="html.parser")
    a = [i for i in html.body.findAll('a')]
    a.reverse()
    a.pop()
    return '|'.join(i.text for i in a)
############################################################

def signal_handler(signum, frame):
    """Handle Ctrl+C (SIGINT) gracefully."""
    print('\nПолучен сигнал остановки (Ctrl+C). Завершение работы...')
    
    # Stop Socket.IO gracefully
    try:
        socketio.stop()
        print('Socket.IO остановлен.')
    except Exception as e:
        print(f'Ошибка при остановке Socket.IO: {e}')
    
    # Stop media service
    try:
        media_service.stop()
        print('Media service остановлен.')
    except Exception as e:
        print(f'Ошибка при остановке media service: {e}')
    
    # Stop thread pool
    try:
        tp.stop()
        print('Thread pool остановлен.')
    except Exception as e:
        print(f'Ошибка при остановке thread pool: {e}')
    
    print('Приложение корректно завершено.')
    exit(0)

if __name__ == '__main__':
    try:
        # Development only
        register_all(app, tp, media_service, socketio)
        print('Приложение запущено. Нажмите Ctrl+C для остановки.')
        app.run_debug()
    except KeyboardInterrupt:
        # Fallback handler
        signal_handler(signal.SIGINT, None)
