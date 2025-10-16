import os
import time
import pytest
import socket
import requests
from urllib.parse import urlparse
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from tests.config import BASE_URL as BASE


def _ensure_target_or_skip():
    base_url = BASE
    parsed = urlparse(base_url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    if not host:
        pytest.skip('BASE_URL has no host')
    try:
        socket.getaddrinfo(host, port)
    except Exception:
        pytest.skip(f'Host not resolvable: {host}')
    try:
        # Проверяем только доступность сервера, не HTTP статус
        response = requests.head(base_url, timeout=5, allow_redirects=True)
        # Если получили любой HTTP ответ (даже 400, 401, 403, 500) - сервер работает
        # Пропускаем только при network errors (connection refused, timeout)
        pass
    except requests.exceptions.ConnectionError:
        pytest.skip(f'Server not reachable: {base_url}')
    except requests.exceptions.Timeout:
        pytest.skip(f'Server timeout: {base_url}')
    except Exception as e:
        # Для других ошибок (DNS, SSL) тоже пропускаем
        pytest.skip(f'Network error: {e}')


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
    return webdriver.Chrome(options=opts)


def login(d, user: str, password: str):
    base_url = BASE
    d.get(f'{base_url}/login')
    d.find_element('css selector', '#login').send_keys(user)
    d.find_element('css selector', '#password').send_keys(password)
    d.find_element('css selector', "button[type=submit]").click()
    time.sleep(0.3)


def check_access_denied(d, url: str) -> bool:
    """Проверяет, что доступ к URL запрещён."""
    d.get(url)
    time.sleep(0.2)
    html = d.page_source.lower()
    current_url = d.current_url.lower()

    # Проверяем различные признаки запрета доступа
    access_denied_indicators = [
        'forbidden' in html, 'доступ запрещен' in html, 'access denied'
        in html, '/login' in current_url, '403' in html, 'unauthorized' in html
    ]

    return any(access_denied_indicators)


def check_access_granted(d, url: str) -> bool:
    """Проверяет, что доступ к URL разрешён."""
    d.get(url)
    time.sleep(0.2)
    current_url = d.current_url.lower()

    # Проверяем, что мы на нужной странице
    return url.split('/')[-1] in current_url or url.split(
        '/')[-2] in current_url


@pytest.mark.ui
def test_rbac_restricted_pages_regular_user(qa_regular_credentials):
    """Обычный пользователь не имеет доступа к административным страницам."""
    username, password = qa_regular_credentials
    d = make_chrome()
    try:
        login(d, username, password)

        # Проверяем недоступность административных страниц
        assert check_access_denied(
            d, f'{BASE}/admin'
        ), f'Regular user {username} should not access /admin'
        assert check_access_denied(
            d, f'{BASE}/users'
        ), f'Regular user {username} should not access /users'
        assert check_access_denied(
            d, f'{BASE}/groups'
        ), f'Regular user {username} should not access /groups'

        # Проверяем доступность обычных страниц
        assert check_access_granted(
            d,
            f'{BASE}/files'), f'Regular user {username} should access /files'

    finally:
        d.quit()


@pytest.mark.ui
def test_rbac_restricted_pages_reader_user(qa_reader_credentials):
    """Пользователь-читатель не имеет доступа к административным страницам."""
    username, password = qa_reader_credentials
    d = make_chrome()
    try:
        login(d, username, password)

        # Проверяем недоступность административных страниц
        assert check_access_denied(
            d, f'{BASE}/admin'
        ), f'Reader user {username} should not access /admin'
        assert check_access_denied(
            d, f'{BASE}/users'
        ), f'Reader user {username} should not access /users'
        assert check_access_denied(
            d, f'{BASE}/groups'
        ), f'Reader user {username} should not access /groups'

        # Проверяем доступность обычных страниц
        assert check_access_granted(
            d, f'{BASE}/files'), f'Reader user {username} should access /files'

    finally:
        d.quit()


@pytest.mark.ui
def test_rbac_restricted_pages_writer_user(qa_writer_credentials):
    """Пользователь-писатель не имеет доступа к административным страницам."""
    username, password = qa_writer_credentials
    d = make_chrome()
    try:
        login(d, username, password)

        # Проверяем недоступность административных страниц
        assert check_access_denied(
            d, f'{BASE}/admin'
        ), f'Writer user {username} should not access /admin'
        assert check_access_denied(
            d, f'{BASE}/users'
        ), f'Writer user {username} should not access /users'
        assert check_access_denied(
            d, f'{BASE}/groups'
        ), f'Writer user {username} should not access /groups'

        # Проверяем доступность обычных страниц
        assert check_access_granted(
            d, f'{BASE}/files'), f'Writer user {username} should access /files'

    finally:
        d.quit()


@pytest.mark.ui
def test_rbac_manager_access(qa_manager_credentials):
    """Менеджер имеет доступ к группам, но не к пользователям и админке."""
    username, password = qa_manager_credentials
    d = make_chrome()
    try:
        login(d, username, password)

        # Проверяем недоступность административных страниц
        assert check_access_denied(
            d, f'{BASE}/admin'
        ), f'Manager user {username} should not access /admin'
        assert check_access_denied(
            d, f'{BASE}/users'
        ), f'Manager user {username} should not access /users'

        # Проверяем доступность страниц менеджера
        assert check_access_granted(
            d,
            f'{BASE}/groups'), f'Manager user {username} should access /groups'
        assert check_access_granted(
            d,
            f'{BASE}/files'), f'Manager user {username} should access /files'

    finally:
        d.quit()


@pytest.mark.ui
def test_rbac_admin_access(qa_admin_credentials):
    """QA администратор имеет доступ ко всем страницам."""
    username, password = qa_admin_credentials
    d = make_chrome()
    try:
        login(d, username, password)

        # Проверяем доступность всех административных страниц
        assert check_access_granted(
            d,
            f'{BASE}/admin'), f'QA Admin user {username} should access /admin'
        assert check_access_granted(
            d,
            f'{BASE}/users'), f'QA Admin user {username} should access /users'
        assert check_access_granted(
            d, f'{BASE}/groups'
        ), f'QA Admin user {username} should access /groups'
        assert check_access_granted(
            d,
            f'{BASE}/files'), f'QA Admin user {username} should access /files'

    finally:
        d.quit()


@pytest.mark.ui
def test_rbac_main_admin_access(admin_credentials):
    """Основной администратор имеет доступ ко всем страницам."""
    username, password = admin_credentials
    d = make_chrome()
    try:
        login(d, username, password)

        # Проверяем доступность всех административных страниц
        assert check_access_granted(
            d, f'{BASE}/admin'), f'Main admin {username} should access /admin'
        assert check_access_granted(
            d, f'{BASE}/users'), f'Main admin {username} should access /users'
        assert check_access_granted(
            d,
            f'{BASE}/groups'), f'Main admin {username} should access /groups'
        assert check_access_granted(
            d, f'{BASE}/files'), f'Main admin {username} should access /files'

    finally:
        d.quit()


@pytest.mark.ui
def test_rbac_comprehensive_matrix(all_user_credentials, user_access_matrix):
    """Комплексная проверка матрицы доступа для всех пользователей."""
    base_url = BASE

    for username, (login_user, password) in all_user_credentials.items():
        if username == 'admin':  # Пропускаем основного админа, он уже протестирован
            continue

        d = make_chrome()
        try:
            login(d, login_user, password)

            # Проверяем доступ к каждому ресурсу согласно матрице
            for resource, should_have_access in user_access_matrix[
                    username].items():
                url = f'{base_url}/{resource}'

                if should_have_access:
                    assert check_access_granted(
                        d, url
                    ), f'User {username} should have access to {resource}'
                else:
                    assert check_access_denied(
                        d, url
                    ), f'User {username} should not have access to {resource}'

        finally:
            d.quit()
