import os
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from tests.config import BASE_URL as BASE

LOGIN = os.getenv('LOGIN', 'admin')
PASSWORD = os.getenv('PASSWORD', 'admin')


def _driver():
    opts = Options()
    for f in [
            '--headless=new', '--disable-gpu', '--no-sandbox',
            '--disable-dev-shm-usage', '--ignore-certificate-errors'
    ]:
        opts.add_argument(f)
    drv = webdriver.Chrome(options=opts)
    drv.set_page_load_timeout(30)
    return drv


def _login(d):
    d.get(BASE + '/login')
    user = d.find_element(By.NAME, 'login')
    pwd = d.find_element(By.NAME, 'password')
    user.clear()
    user.send_keys(LOGIN)
    pwd.clear()
    pwd.send_keys(PASSWORD)
    pwd.submit()


@pytest.mark.ui
def test_groups_page_smoke():
    d = _driver()
    try:
        _login(d)
        for path in ['/groups', '/admin/groups']:
            try:
                d.get(BASE + path)
                if d.title or d.current_url:
                    break
            except Exception:
                continue
        body = d.find_element(By.TAG_NAME, 'body').get_attribute('innerHTML')
        assert 'Группы' in body or 'groups' in (d.current_url or '')
    finally:
        d.quit()
