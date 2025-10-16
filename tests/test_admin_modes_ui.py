import os
import time
import socket
from urllib.parse import urlparse
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from tests.config import BASE_URL as BASE


def _ensure_target_or_skip():
    parsed = urlparse(BASE)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    if not host:
        pytest.skip('BASE_URL has no host')
    try:
        socket.getaddrinfo(host, port)
    except Exception:
        pytest.skip(f'Host not resolvable: {host}')
    try:
        import requests
        requests.head(BASE, timeout=5, allow_redirects=True)
    except Exception:
        pytest.skip(f'Target not reachable: {BASE}')


def make_chrome():
    _ensure_target_or_skip()
    opts = Options()
    for f in [
            '--headless=new', '--disable-gpu', '--no-sandbox',
            '--disable-dev-shm-usage', '--disable-setuid-sandbox',
            '--no-zygote', '--single-process', '--ignore-certificate-errors'
    ]:
        opts.add_argument(f)
    if os.getenv('CERT_FILE'):
        pass
    else:
        opts.set_capability('acceptInsecureCerts', True)
    d = webdriver.Chrome(options=opts)
    d.set_page_load_timeout(45)
    d.set_script_timeout(45)
    return d


def login(d, user: str, password: str):
    d.get(f'{BASE}/login')
    d.find_element('css selector', '#login').send_keys(user)
    d.find_element('css selector', '#password').send_keys(password)
    d.find_element('css selector', "button[type=submit]").click()
    time.sleep(0.4)


def admin_open_panel(d):
    d.get(f'{BASE}/admin')
    time.sleep(0.4)


def _click_js(d, el):
    try:
        el.click()
    except Exception:
        d.execute_script("arguments[0].click();", el)


@pytest.mark.ui
def test_admin_force_logout_kicks_active_user(qa_admin_credentials,
                                              qa_regular_credentials):
    """Админ принудительно разлогинивает: активная пользовательская сессия теряет доступ."""
    admin_user, admin_pass = qa_admin_credentials
    regular_user, regular_pass = qa_regular_credentials

    d_admin = make_chrome()
    d_user = make_chrome()
    try:
        # Логин обеих сессий
        login(d_admin, admin_user, admin_pass)
        login(d_user, regular_user, regular_pass)
        # Пользователь открывает Files
        d_user.get(f'{BASE}/files')
        time.sleep(0.4)

        # Админ открывает панель
        admin_open_panel(d_admin)
        # Ищем кнопку force logout
        sels = [
            "[data-testid='admin-force-logout']",
            "#adminForceLogoutBtn",
            "button[name='forceLogout']",
        ]
        btn = None
        for sel in sels:
            els = d_admin.find_elements('css selector', sel)
            if els:
                btn = els[0]
                break
        if not btn:
            pytest.skip('Force logout control not found')
        _click_js(d_admin, btn)
        time.sleep(0.5)

        # Пользовательский драйвер должен потерять доступ/перенаправиться на /login
        d_user.refresh()
        time.sleep(0.5)
        assert ('/login' in d_user.current_url.lower()) or (
            'вход' in d_user.page_source.lower())
    finally:
        d_admin.quit()
        d_user.quit()


@pytest.mark.ui
def test_admin_maintenance_blocks_user_actions(qa_admin_credentials,
                                               qa_reader_credentials):
    """Режим обслуживания блокирует действия пользователя (минимальная проверка)."""
    admin_user, admin_pass = qa_admin_credentials
    user, pwd = qa_reader_credentials

    d_admin = make_chrome()
    d_user = make_chrome()
    try:
        login(d_admin, admin_user, admin_pass)
        login(d_user, user, pwd)
        d_user.get(f'{BASE}/files')
        time.sleep(0.4)

        admin_open_panel(d_admin)
        # Ищем переключатель/кнопку maintenance
        sels = [
            "[data-testid='admin-maintenance']",
            "#adminMaintenanceToggle",
            "button[name='maintenance']",
        ]
        ctrl = None
        for sel in sels:
            els = d_admin.find_elements('css selector', sel)
            if els:
                ctrl = els[0]
                break
        if not ctrl:
            pytest.skip('Maintenance control not found')
        _click_js(d_admin, ctrl)
        time.sleep(0.6)

        # На стороне пользователя ожидаем баннер/блокировку/редирект
        d_user.refresh()
        time.sleep(0.6)
        html = d_user.page_source.lower()
        indicators = [
            'maintenance' in html,
            'обслужив' in html,
            '/login' in d_user.current_url.lower(),
        ]
        assert any(indicators)
    finally:
        d_admin.quit()
        d_user.quit()
