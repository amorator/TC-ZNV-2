from flask_login import current_user
from datetime import datetime as dt

class File():
    def __init__(self, id, display_name, real_name, path, owner, description='', date='', ready=1, viewed=None, note=''):
        self.display_name = display_name
        self.real_name = real_name
        self.path = path
        self.description = description if description else 'Нет описания...'
        self.date = date if date else dt.now().strftime('%Y-%m-%d %H:%M')
        self.owner = owner
        self.id = id
        self.ready = ready
        self.viewed = viewed
        self.note = note if note else ''
