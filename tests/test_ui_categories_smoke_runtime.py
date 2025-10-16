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


@pytest.mark.ui
def test_categories_page_opens_after_login():
    d = _driver()
    try:
        # login
        d.get(BASE + '/login')
        d.find_element(By.NAME, 'login').send_keys(LOGIN)
        pwd = d.find_element(By.NAME, 'password')
        pwd.send_keys(PASSWORD)
        pwd.submit()
        # open categories
        d.get(BASE + '/categories')
        body = d.find_element(By.TAG_NAME, 'body').get_attribute('innerHTML')
        assert 'Категории' in body or 'categories' in (d.current_url or '')
    finally:
        d.quit()
