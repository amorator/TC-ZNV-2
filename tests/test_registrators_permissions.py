import types
import json
from flask import Flask, jsonify


def _app(monkeypatch):
    app = Flask(__name__)
    setattr(app, 'flash_error', lambda *a, **k: None)
    setattr(app, 'permission_required', lambda *a, **k: (lambda f: f))

    class _SQL:
        config = {'db': {'prefix': 'web'}, 'admin': {'group': 'Программисты'}}
        _last = None

        def execute_query(self, sql, params=None):
            s = str(sql)
            # Registrator fetch
            if 'FROM web_registrator' in s:
                return [(1, 'reg', 'http://t/{file}', 1)]
            # Groups listing
            if 'FROM web_group' in s:
                return [(10, 'Программисты'), (11, 'QA')]
            # Users listing
            if 'FROM web_user' in s and 'permission' in s:
                return [
                    (1, 'admin', 'z'),
                    (2, 'john', 'aef,a,abcdflm,ab,ab,ab,abcd'),
                ]
            return []

        def execute_scalar(self, *a, **k):
            return 1

        def setting_get(self, key):
            return None

        def setting_set(self, key, value):
            self._last = (key, value)

    setattr(app, '_sql', _SQL())
    from routes import registrators as r
    # Bypass @require_permissions in registrators
    r.require_permissions = lambda *a, **k: (lambda f: f)
    r.register(app, socketio=None)
    return app


def test_registrators_permissions_enforce_admin_access(monkeypatch):
    app = _app(monkeypatch)
    client = app.test_client()
    resp = client.post('/registrators/1/permissions',
                       json={'permissions': {
                           'user': {
                               '2': 1
                           },
                           'group': {}
                       }})
    assert resp.status_code == 200
    # Inspect saved value to ensure admin group was granted implicitly
    key, value = app._sql._last
    perms = json.loads(value)
    assert perms['group'].get('10') == 1  # admin group id forced
