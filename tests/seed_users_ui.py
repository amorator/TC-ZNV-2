import os
import time
import sys
from selenium import webdriver
from selenium.webdriver.chrome.options import Options


BASE = os.getenv('BASE_URL', 'http://localhost:5000')
ADMIN_LOGIN = os.getenv('LOGIN', 'admin')
ADMIN_PASSWORD = os.getenv('PASSWORD', 'admin')


def make_chrome():
    opts = Options()
    for f in [
        '--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
        '--disable-setuid-sandbox','--no-zygote','--single-process','--ignore-certificate-errors'
    ]:
        opts.add_argument(f)
    opts.set_capability('acceptInsecureCerts', True)
    d = webdriver.Chrome(options=opts)
    d.set_page_load_timeout(30)
    d.set_script_timeout(30)
    return d


def login_admin(d):
    d.get(f'{BASE}/login')
    d.find_element('css selector', '#login').send_keys(ADMIN_LOGIN)
    d.find_element('css selector', '#password').send_keys(ADMIN_PASSWORD)
    d.find_element('css selector', "button[type=submit]").click()
    time.sleep(0.3)


def create_user(d, username: str, full_name: str, password: str, is_admin: bool=False):
    d.get(f'{BASE}/users')
    # Ищем кнопку добавления пользователя
    add_selectors = ["#add-user-button", "[data-action='add-user']", "a[href='/users/add']", "button.btn-primary"]
    btn = None
    for sel in add_selectors:
        els = d.find_elements('css selector', sel)
        if els:
            btn = els[0]
            break
    if not btn:
        raise RuntimeError('Add user button not found')
    btn.click()
    time.sleep(0.2)
    # Заполняем форму (подберите реальные селекторы при необходимости)
    def fill_if(selector, value):
        els = d.find_elements('css selector', selector)
        if els:
            els[0].clear()
            els[0].send_keys(value)
            return True
        return False
    fill_if('#new_login, #user_login, input[name="login"]', username)
    fill_if('#new_fullname, #user_fullname, input[name="full_name"]', full_name)
    fill_if('#new_password, #user_password, input[name="password"]', password)
    # Опционально роль/чекбокс админа
    if is_admin:
        for sel in ['#is_admin', 'input[name="is_admin"]']:
            els = d.find_elements('css selector', sel)
            if els and not els[0].is_selected():
                els[0].click()
                break
    # Сабмит
    submit_candidates = [".modal-footer .btn-primary", "button[type='submit']", "#save-user"]
    for sel in submit_candidates:
        els = d.find_elements('css selector', sel)
        if els:
            els[0].click()
            break
    time.sleep(0.3)


def main():
    if len(sys.argv) < 2:
        print('Usage: seed_users_ui.py count [prefix]', file=sys.stderr)
        return 2
    count = int(sys.argv[1])
    prefix = sys.argv[2] if len(sys.argv) > 2 else 'qauser'
    d = make_chrome()
    try:
        login_admin(d)
        for i in range(count):
            u = f"{prefix}{i:03d}"
            create_user(d, username=u, full_name=f"QA User {i:03d}", password='QAtest123!')
        print(f"Created {count} users with prefix '{prefix}'")
    finally:
        d.quit()


if __name__ == '__main__':
    raise SystemExit(main())


