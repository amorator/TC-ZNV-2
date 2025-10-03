from flask_login import UserMixin

class User(UserMixin):
    def __init__(self, id, login, name, password, gid, enabled, permission):
         self.id = id
         self.login = login
         self.name = name
         self.password = password
         self.gid = gid
         self.enabled = enabled
         self.permission = permission.split(',')

    def is_anonymous(self):
         return False

    # Use UserMixin's default is_authenticated behavior (always True for logged-in users)
    # Do not override to avoid breaking Flask-Login

    def is_active(self):
         return bool(self.is_enabled())

    def is_enabled(self):
         return int(self.enabled)

    def get_id(self):
         return str(self.id)

    def is_admin(self, id):
        return 'z' in self.permission[id]

    def is_allowed(self, id, perm='a'):
        if id <= 0:
            return True
        id -= 1
        if id > len(self.permission):
            id = len(self.permission) - 1
        return self.is_admin(id) or perm in self.permission[id]

    def permission_string(self):
        return ','.join(self.permission)

    # --- New permissions adapter API ---
    @property
    def permissions(self):
        """Map legacy page-letter permissions to named scopes.

        Page indexes (1-based) legacy mapping:
        3: files page
          a: files.view (enter/list/show)
          b: files.upload / record / add
          c: files.edit_any / move
          d: files.delete_any
          l: files.notes (view and edit notes)
          m: files.mark_viewed (mark as viewed)
          z: admin.any
          Note: viewers list is visible to all users
        1: requests (examples)
          e: requests.approve
          f: requests.allow
          z: admin.any
        """
        try:
            from modules.permissions import (
                FILES_VIEW_PAGE, FILES_UPLOAD, FILES_EDIT_ANY, FILES_DELETE_ANY,
                FILES_MARK_VIEWED, FILES_NOTES, REQUESTS_APPROVE, REQUESTS_ALLOW,
                REQUESTS_VIEW_PAGE, ORDERS_VIEW_PAGE, USERS_VIEW_PAGE, USERS_MANAGE,
                GROUPS_VIEW_PAGE, GROUPS_MANAGE, ADMIN_ANY, FILES_DISPLAY_ALL,
            )
        except Exception:
            # Fallback if import cycle during app startup
            return set()

        mapping = {
            3: {
                'a': FILES_VIEW_PAGE,
                'b': FILES_UPLOAD,
                'c': FILES_EDIT_ANY,
                'd': FILES_DELETE_ANY,
                'l': FILES_NOTES,
                'm': FILES_MARK_VIEWED,
                'f': FILES_DISPLAY_ALL,
                'z': ADMIN_ANY,
            },
            1: {
                'a': REQUESTS_VIEW_PAGE,
                'e': REQUESTS_APPROVE,
                'f': REQUESTS_ALLOW,
                'z': ADMIN_ANY,
            },
            2: {
                'a': ORDERS_VIEW_PAGE,
                'z': ADMIN_ANY,
            },
            4: {  # users page
                'a': USERS_VIEW_PAGE,
                'b': USERS_MANAGE,  # manage includes add/edit/toggle/delete/reset
                'z': ADMIN_ANY,
            },
            5: {  # groups page
                'a': GROUPS_VIEW_PAGE,
                'b': GROUPS_MANAGE,
                'z': ADMIN_ANY,
            },
        }

        result = set()
        # First, map explicit letters to scopes
        for index, letters in enumerate(self.permission, start=1):
            page_map = mapping.get(index)
            if not page_map:
                continue
            for ch in letters:
                scope = page_map.get(ch)
                if scope:
                    result.add(scope)
        # Then, grant implicit view if user has any non-view action on a page
        view_scope_by_page = {
            1: REQUESTS_VIEW_PAGE,
            2: ORDERS_VIEW_PAGE,
            3: FILES_VIEW_PAGE,
            4: USERS_VIEW_PAGE,
            5: GROUPS_VIEW_PAGE,
        }
        for index, letters in enumerate(self.permission, start=1):
            view_scope = view_scope_by_page.get(index)
            if not view_scope:
                continue
            if not letters:
                continue
            # If any letter other than 'a' (view) is present, grant view
            if any(ch != 'a' for ch in letters):
                result.add(view_scope)
        # Ensure configured admin account has all permissions (from config via SQLUtils flag)
        if getattr(self, 'is_config_admin', False):
            result.add('admin.any')
        return result

    def has(self, scope: str) -> bool:
        """Check if user has named permission scope or admin.any."""
        perms = self.permissions
        return 'admin.any' in perms or scope in perms

    def permission_labels(self):
        """Return human-readable labels for user's permissions (for UI)."""
        try:
            from modules.permissions import to_human_labels
        except Exception:
            return []
        return to_human_labels(self.permissions)