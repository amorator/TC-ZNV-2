from flask_login import UserMixin

class User(UserMixin):
    def __init__(self, id, login, name, password, gid, enabled, permission):
         self.id = id
         self.login = login
         self.name = name
         self.password = password
         self.gid = gid
         self.enabled = enabled
         self.authenticated = False
         self.permission = permission.split(',')

    def is_anonymous(self):
         return False

    def is_authenticated(self):
         return self.authenticated

    def is_active(self):
         return self.active

    def is_enabled(self):
         return int(self.enabled)

    def get_id(self):
         return self.id

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
