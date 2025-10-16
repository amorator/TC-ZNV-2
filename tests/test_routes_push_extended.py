import types
from flask import Flask


def _app_with_push(monkeypatch, authenticated=False):
    app = Flask(__name__)

    class _SQL:

        def push_get_vapid_public(self):
            return ''

        def push_get_vapid_private(self):
            return ''

        def push_get_vapid_subject(self):
            return 'mailto:test@example.com'

        def push_add_subscription(self, *a, **k):
            pass

    setattr(app, '_sql', _SQL())
    setattr(app, 'flash_error', lambda *a, **k: None)
    from routes import push as push_routes
    monkeypatch.setattr(
        push_routes, 'current_user',
        types.SimpleNamespace(is_authenticated=authenticated, id=1, name='u'))
    push_routes.register(app)
    return app


def test_push_delivered_unauthorized(monkeypatch):
    app = _app_with_push(monkeypatch, authenticated=False)
    wc = app.test_client()
    resp = wc.post('/push/delivered', json={'title': 't', 'body': 'b'})
    assert resp.status_code == 401


def test_push_delivered_authorized(monkeypatch):
    app = _app_with_push(monkeypatch, authenticated=True)
    wc = app.test_client()
    resp = wc.post('/push/delivered', json={'title': 't', 'body': 'b'})
    assert resp.status_code == 200


def test_push_test_unauthorized(monkeypatch):
    app = _app_with_push(monkeypatch, authenticated=False)
    wc = app.test_client()
    resp = wc.post('/push/test')
    assert resp.status_code == 401

