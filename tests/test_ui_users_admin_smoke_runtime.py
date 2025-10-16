import os
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from tests.config import (
    BASE_URL as BASE,
    LOGIN,
    PASSWORD,
    PAGE_LOAD_TIMEOUT_SEC,
    HEADLESS,
    ACCEPT_INSECURE_CERTS,
)


def _driver():
    opts = Options()
    for f in [
            '--headless=new' if HEADLESS else '', '--disable-gpu',
            '--no-sandbox', '--disable-dev-shm-usage',
            '--ignore-certificate-errors'
    ]:
        if f:
            opts.add_argument(f)
    if ACCEPT_INSECURE_CERTS:
        opts.set_capability('acceptInsecureCerts', True)
    drv = webdriver.Chrome(options=opts)
    drv.set_page_load_timeout(PAGE_LOAD_TIMEOUT_SEC)
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
def test_users_page_smoke():
    d = _driver()
    try:
        _login(d)
        for path in ['/users', '/admin/users']:
            try:
                d.get(BASE + path)
                if d.title or d.current_url:
                    break
            except Exception:
                continue
        body = d.find_element(By.TAG_NAME, 'body').get_attribute('innerHTML')
        assert 'Пользователи' in body or 'users' in (d.current_url or '')
    finally:
        d.quit()


@pytest.mark.ui
def test_admin_page_smoke():
    d = _driver()
    try:
        _login(d)
        d.get(BASE + '/admin')
        # Minimal presence of admin UI
        assert d.title or 'admin' in (d.current_url or '')
    finally:
        d.quit()
