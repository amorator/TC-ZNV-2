import types
from flask import Flask
from jinja2 import DictLoader


def _minimal_app(monkeypatch):
    app = Flask(__name__)

    # Provide minimal SQL and config for files route
    class _SQL:
        config = {'files': {'root': '/tmp'}}

        def file_by_path(self, *a, **k):
            return []

        def category_id_by_folder(self, *a, **k):
            return None

    setattr(app, '_sql', _SQL())
    setattr(app, 'flash_error', lambda *a, **k: None)
    setattr(app, 'permission_required', lambda *a, **k: (lambda f: f))
    setattr(app, 'hash', lambda s: s)
    # dirs_by_permission returns empty
    from services import permissions as perms
    monkeypatch.setattr(perms, 'dirs_by_permission', lambda *a, **k: [])
    # import and register files
    from routes import files as files_routes
    # bypass permissions decorator in files module
    files_routes.require_permissions = lambda *a, **k: (lambda f: f)
    files_routes.register(app,
                          media_service=types.SimpleNamespace(),
                          socketio=None)
    # provide minimal template to avoid TemplateNotFound
    app.jinja_loader = DictLoader({'files.j2.html': 'Файлы'})
    return app


def test_files_empty_dirs_renders_page(monkeypatch):
    app = _minimal_app(monkeypatch)
    c = app.test_client()
    r = c.get('/files')
    assert r.status_code == 200
    assert 'Файлы' in r.get_data(as_text=True)
