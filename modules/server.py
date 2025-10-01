"""Application server wrapper extending Flask with auth and utilities."""

from functools import wraps
from hashlib import md5
from os import getenv
from re import sub

from flask import Flask, flash, abort
from flask_cors import CORS
from flask_login import LoginManager, current_user

from modules.SQLUtils import SQLUtils


class Server(Flask):
    """Flask app with login manager, DB access, and helpers."""

    def __init__(self, root, name=__name__):
        super().__init__(name, root_path=root)
        CORS(self, resources={r'*': {'origins': '*'}}, supports_credentials=True)
        # Prefer env-provided secret for sessions; fallback to static default
        self.config['SECRET_KEY'] = getenv('SECRET_KEY', 'achudwshoiqxjqi@eowe1J2')
        self.config['TEMPLATES_AUTO_RELOAD'] = True
        self.config['SESSION_TYPE'] = 'filesystem'
        self.config['SESSION_PERMANENT'] = True
        self.config['PERMANENT_SESSION_LIFETIME'] = 86400
        self.config['SESSION_COOKIE_HTTPONLY'] = False
        self.config['SESSION_COOKIE_SECURE'] = True
        self.config['SESSION_REFRESH_EACH_REQUEST'] = True
        self.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
        self.config['REMEMBER_COOKIE_SECURE'] = True
        self.config['REMEMBER_COOKIE_SAMESITE'] = 'Lax'
        self.init()
        self.get_dirs()

    def init(self) -> None:
        """Initialize login manager and SQL utilities."""
        self.login_manager = LoginManager(self)
        self.login_manager.login_view = 'login'
        self.login_manager.login_message = 'Please log in to access this page.'
        self.login_manager.refresh_view = 'reauth'
        self._sql = SQLUtils()

    def get_dirs(self) -> None:
        """Build directories structure from configuration."""
        self.dirs = []
        for i in self._sql.config['videos']['dirs'].split(','):
            self.dirs.append({i: self._sql.config[i]['name']})
            for j in self._sql.config[i]['dirs'].split(','):
                t = j.split(':')
                self.dirs[len(self.dirs) - 1].update({t[0]: t[1]})

    def run_debug(self) -> None:
        """Run development server with TLS and debug enabled."""
        self.run(host='0.0.0.0', port=443, ssl_context=('/etc/ssl/.ssl/znv.crt', '/etc/ssl/.ssl/znv.key'), threaded=True, debug=True)

    def hash(self, s: str) -> str:
        """Return MD5 hash for a string (legacy)."""
        return md5(s.encode('utf-8')).hexdigest()

    def flash_error(self, e: Exception) -> None:
        """Normalize and flash an error message to UI."""
        msg = sub("['\"]", '', str(e))
        flash(msg)

    def permission_required(self, id: int, perm: str = 'a'):
        """Decorator to enforce permission checks for a page id and verb."""
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
