import types


class _SQL:

    def __init__(self, group_name='ops'):
        self._group_name = group_name
        self.config = {
            'root1': {
                'only_group': '1'
            },
            'root2': {
                'only_group': '0'
            },
        }

    def group_name_by_id(self, _):
        return self._group_name

    def category_id_by_folder(self, root):
        return 1

    def subcategory_by_category(self, _):
        # pretend DB has two subs for hydration
        return [
            types.SimpleNamespace(folder_name='g-ops',
                                  display_name='ops',
                                  enabled=1),
            types.SimpleNamespace(folder_name='g-qa',
                                  display_name='qa',
                                  enabled=1)
        ]


class _App:

    def __init__(self, dirs, sql):
        self.dirs = dirs
        self._sql = sql


def _user(perms, name_val='user'):
    # current_user stub with legacy is_allowed letters mapping and has() by scopes
    class U:
        gid = 1
        name = name_val
        _perm_scopes = set(perms)

        def has(self, scope):
            return scope in self._perm_scopes

        # legacy letters: allow z (admin) if admin.any
        def is_allowed(self, page_id, letter):
            if 'admin.any' in self._perm_scopes and letter == 'z':
                return True
            if letter == 'a':
                return True
            if letter == 'f':
                return 'files.display_all' in self._perm_scopes
            return False

    return U()


def test_dirs_by_permission_group_restricted_allows_only_user_group(
        monkeypatch):
    from services.permissions import dirs_by_permission
    app = _App(dirs=[{
        'root1': 'Root 1',
        'g-ops': 'ops',
        'g-qa': 'qa'
    }],
               sql=_SQL('ops'))
    monkeypatch.setattr('services.permissions.current_user',
                        _user(perms=set()))
    out = dirs_by_permission(app, 3, 'a')
    assert out and 'g-ops' in out[0] and 'g-qa' not in out[0]


def test_dirs_by_permission_display_all_shows_full(monkeypatch):
    from services.permissions import dirs_by_permission
    app = _App(dirs=[{
        'root1': 'Root 1',
        'g-ops': 'ops',
        'g-qa': 'qa'
    }],
               sql=_SQL('ops'))
    monkeypatch.setattr('services.permissions.current_user',
                        _user(perms={'files.display_all'}))
    out = dirs_by_permission(app, 3, 'a')
    assert out and 'g-qa' in out[0]


def test_dirs_by_permission_admin_any_sees_all(monkeypatch):
    from services.permissions import dirs_by_permission
    app = _App(dirs=[{'root1': 'Root 1', 'g-ops': 'ops'}], sql=_SQL('ops'))
    monkeypatch.setattr('services.permissions.current_user',
                        _user(perms={'admin.any'}, name_val='admin'))
    out = dirs_by_permission(app, 3, 'a')
    assert out and 'g-ops' in out[0]
