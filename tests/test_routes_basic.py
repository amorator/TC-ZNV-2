import types
import pytest
from flask import Flask


def create_min_app():
    app = Flask(__name__)

    # minimal Server-like surface
    class _SQL:

        def push_get_vapid_public(self):
            return ''

        def push_get_vapid_private(self):
            return ''

        def push_get_vapid_subject(self):
            return 'mailto:test@example.com'

    setattr(app, '_sql', _SQL())
    setattr(app, 'permission_required', lambda *a, **k: (lambda f: f))
    setattr(app, 'flash_error', lambda *a, **k: None)
    setattr(
        app, 'logger',
        types.SimpleNamespace(info=lambda *a, **k: None,
                              error=lambda *a, **k: None))
    # dummy login endpoint for redirects
    app.add_url_rule('/login', 'login', lambda: 'login')
    return app


def test_index_redirect_when_unauth(monkeypatch):
    app = create_min_app()

    from routes import index as index_routes
    monkeypatch.setattr(index_routes, 'current_user',
                        types.SimpleNamespace(is_authenticated=False))
    index_routes.register(app)

    wc = app.test_client()
    resp = wc.get('/')
    assert resp.status_code in (301, 302)


def test_push_vapid_public_missing(monkeypatch):
    app = create_min_app()
    from routes import push as push_routes
    push_routes.register(app)

    wc = app.test_client()
    resp = wc.get('/push/vapid_public')
    # since we return 400 when VAPID key missing
    assert resp.status_code in (200, 400)
