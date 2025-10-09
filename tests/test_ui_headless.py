import os
import time
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
import socket
from urllib.parse import urlparse


BASE = os.getenv('BASE_URL', 'http://localhost:5000')
LOGIN = os.getenv('LOGIN', 'admin')
PASSWORD = os.getenv('PASSWORD', 'admin')


def _ensure_host_resolves_or_skip():
    parsed = urlparse(BASE)
    host = parsed.hostname or BASE
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    try:
        socket.getaddrinfo(host, port)
    except Exception:
        pytest.skip(f"Host does not resolve in this environment: {host}")
    try:
        # Проверяем только доступность сервера, не HTTP статус
        import requests
        response = requests.head(BASE, timeout=5, allow_redirects=True)
        # Если получили любой HTTP ответ (даже 400, 401, 403, 500) - сервер работает
        # Пропускаем только при network errors (connection refused, timeout)
        pass
    except requests.exceptions.ConnectionError:
        pytest.skip(f'Server not reachable: {BASE}')
    except requests.exceptions.Timeout:
        pytest.skip(f'Server timeout: {BASE}')
    except Exception as e:
        # Для других ошибок (DNS, SSL) тоже пропускаем
        pytest.skip(f'Network error: {e}')


def make_chrome():
    _ensure_host_resolves_or_skip()
    opts = Options()
    for f in [
        '--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
        '--disable-setuid-sandbox','--no-zygote','--single-process','--ignore-certificate-errors'
    ]:
        opts.add_argument(f)
    # TLS: strict if CERT_FILE defined else accept self-signed
    if os.getenv('CERT_FILE'):
        pass
    else:
        opts.set_capability('acceptInsecureCerts', True)
    # Используем Selenium Manager (автоподбор chromedriver под Chromium)
    driver = webdriver.Chrome(options=opts)
    driver.set_page_load_timeout(30)
    driver.set_script_timeout(30)
    return driver


@pytest.mark.ui
def test_admin_table_visible_selenium():
    _ensure_host_resolves_or_skip()
    d = make_chrome()
    try:
        d.get(f'{BASE}/login')
        d.find_element('css selector', '#login').send_keys(LOGIN)
        d.find_element('css selector', '#password').send_keys(PASSWORD)
        d.find_element('css selector', "button[type=submit]").click()
        time.sleep(0.2)
        d.get(f'{BASE}/admin')
        table = d.find_element('css selector', "table[role='table']")
        assert table.is_displayed()
        # Скриншот состояния страницы → tests/artifacts/
        try:
            artifacts_dir = os.path.join(os.path.dirname(__file__), 'artifacts')
            os.makedirs(artifacts_dir, exist_ok=True)
            d.save_screenshot(os.path.join(artifacts_dir, 'admin_headless.png'))
        except Exception:
            pass
    finally:
        d.quit()


@pytest.mark.ui
def test_files_table_visible_selenium():
    _ensure_host_resolves_or_skip()
    d = make_chrome()
    try:
        d.get(f'{BASE}/login')
        d.find_element('css selector', '#login').send_keys(LOGIN)
        d.find_element('css selector', '#password').send_keys(PASSWORD)
        d.find_element('css selector', "button[type=submit]").click()
        time.sleep(0.2)
        d.get(f'{BASE}/files')
        # По ARIA-метке из шаблона
        table = d.find_element('css selector', "table[role='table'][aria-label='Таблица файлов']")
        assert table.is_displayed()
    finally:
        d.quit()


@pytest.mark.ui
def test_users_table_visible_selenium():
    _ensure_host_resolves_or_skip()
    d = make_chrome()
    try:
        d.get(f'{BASE}/login')
        d.find_element('css selector', '#login').send_keys(LOGIN)
        d.find_element('css selector', '#password').send_keys(PASSWORD)
        d.find_element('css selector', "button[type=submit]").click()
        time.sleep(0.2)
        d.get(f'{BASE}/users')
        table = d.find_element('css selector', "table[role='table'][aria-label='Таблица пользователей']")
        assert table.is_displayed()
    finally:
        d.quit()


@pytest.mark.ui
def test_groups_table_visible_selenium():
    _ensure_host_resolves_or_skip()
    d = make_chrome()
    try:
        d.get(f'{BASE}/login')
        d.find_element('css selector', '#login').send_keys(LOGIN)
        d.find_element('css selector', '#password').send_keys(PASSWORD)
        d.find_element('css selector', "button[type=submit]").click()
        time.sleep(0.2)
        d.get(f'{BASE}/groups')
        table = d.find_element('css selector', "table[role='table'][aria-label='Таблица групп']")
        assert table.is_displayed()
    finally:
        d.quit()


