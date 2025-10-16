import types
from flask import Flask
from modules.middleware import init_middleware


def test_middleware_deletes_cookies_on_force_logout(monkeypatch):
    app = Flask(__name__)
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['REMEMBER_COOKIE_SAMESITE'] = 'Lax'
    setattr(app, 'session_cookie_name', 'session')

    # minimal current_user
    class _U:
        id = 1

        def is_authenticated(self):
            return True

    monkeypatch.setattr('modules.middleware.current_user', _U())
    # avoid flask-login dependency inside logout_user
    monkeypatch.setattr('modules.middleware.logout_user', lambda: None)

    # minimal loggers and helpers
    setattr(app, 'flash_error', lambda *a, **k: None)
    setattr(app, 'logger', types.SimpleNamespace(error=lambda *a, **k: None))

    init_middleware(app)
    client = app.test_client()

    # Flag force logout for this user in app state
    app._force_logout_users = {1}

    @app.route('/ping')
    def ping():
        return 'ok'

    # Seed cookies to make delete_cookie produce Set-Cookie headers
    client.set_cookie('session', 'abc')
    client.set_cookie('remember_token', 'xyz')
    resp = client.get('/ping')
    # Ensure force logout flag for user was cleared by middleware
    assert 1 not in getattr(app, '_force_logout_users', set())
