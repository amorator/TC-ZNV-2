from flask import Flask, flash, url_for, abort
from flask_login import LoginManager, current_user
from flask_cors import CORS
from functools import wraps
from hashlib import md5
from re import sub
from os import chdir

from classes.page import Pages
from modules.SQLUtils import SQLUtils

class Server(Flask):
    def __init__(self, root, name=__name__):
        super().__init__(name, root_path=root)
        CORS(self, resources={r'*': {'origins': '*'}}, supports_credentials=True)
        self.secret_key = 'achudwshoiqxjqi@eowe1J2'
        self.config['TEMPLATES_AUTO_RELOAD'] = True
        self.config['SESSION_TYPE'] = 'filesystem'
        self.config['SESSION_PERMANENT'] = True
        self.config['PERMANENT_SESSION_LIFETIME'] = 86400
        self.config['SESSION_COOKIE_HTTPONLY'] = False
        self.config['SESSION_REFRESH_EACH_REQUEST'] = True
        self.init()
        self.load_data()

    def init(self):
        self.login_manager = LoginManager(self)
        self.login_manager.login_view = 'login'
        self.login_manager.login_message = u'Please log in to access this page.'
        self.login_manager.refresh_view = 'reauth'
        self._sql = SQLUtils()

    def load_data(self):
        self.pages = Pages(
            ['Главная', 'index', '/', 0],
            ['Заявки', 'requests', '/rsts', 0],
            ['Наряды-допуски', 'orders', '/rdrs', 0],
            ['Видео', 'files', '/fls', 0],
            ['Вход', 'login', '/login', 1, 'class=right'],
            ['Выход', 'logout', '/logout', 1, 'class=right'],
            ['Пользователи', 'users', '/srs', 0, 'class=right'],
        )
        self.get_dirs()

    def get_dirs(self):
        self.dirs = []
        for i in self._sql.config['videos']['dirs'].split(','):
            self.dirs.append({i: self._sql.config[i]['name']})
            for j in self._sql.config[i]['dirs'].split(','):
                t = j.split(':')
                self.dirs[len(self.dirs) - 1].update({t[0]: t[1]})

    def run_debug(self):
        self.run(host='0.0.0.0', port=443, ssl_context=('/etc/ssl/.ssl/znv.crt', '/etc/ssl/.ssl/znv.key'), threaded=True, debug=True)

    def hash(self, s):
        return md5(s.encode('utf-8')).hexdigest()

    def flash_error(self, e):
        msg = sub("['\"]", '', str(e))
        flash(msg)

    def permission_required(self, id, perm='a'):
        def _permission_required(f):
            @wraps(f)
            def wrap(*args, **kwargs):
                if not current_user.is_authenticated:
                    return abort(401)
                if current_user.is_allowed(id, perm):
                    return f(*args, **kwargs)
                else:
                    return abort(403)
            return wrap
        return _permission_required
