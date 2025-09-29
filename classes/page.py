from flask_login import current_user

class Page():
    def __init__(self, dname, name, url, shared=1, html='', id=0):
        self.dname = dname
        self.name = name
        self.url = url
        self.shared = shared
        self.html = html
        self.id = id

    def is_current(self, url):
        return 'id=active' if self.url in url and self.url != '/' else 'id=active' if self.url == url else ''

    def is_allowed(self):
        return current_user.is_allowed(self.id)

class Pages():
    def __init__(self, *args):
        self.gen(*args)

    def gen(self, *args):
        self.list = []
        i = 0
        for arg in args:
            if 'login' not in arg and 'logout' not in arg:
                self.list.append(Page(*arg, id=i))
                i += 1
            else:
                self.list.append(Page(*arg, -1))

    def get(self, logged=True, exclude='//////'):
        pages = []
        for page in self.list:
            if exclude not in page.url and ((logged and current_user.is_allowed(page.id)) or (not logged and page.id == -1)):
                pages.append(page)
        return pages

    def id_by_name(self, name):
        for page in self.list:
            if page.name == name:
                return page.id

    def url_by_name(self, name):
        for page in self.list:
            if page.name == name:
                return page.url
            
    def get_page_by_name(self,name):
        for page in self.list:
            if page.name == name:
                return page

    def __getitem__(self, i):
        return self.list[i]

    def __len__(self):
        return len(self.list)
