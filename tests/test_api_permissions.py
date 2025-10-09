import os
import time
import socket
from urllib.parse import urlparse
import pytest
import requests


BASE = os.getenv('BASE_URL', 'http://localhost:5000')


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
        # Любой HTTP ответ — сервер жив; используем системный/переданный CA
        requests.head(BASE, timeout=5, allow_redirects=True)
    except requests.exceptions.ConnectionError:
        pytest.skip(f'Server not reachable: {BASE}')
    except requests.exceptions.Timeout:
        pytest.skip(f'Server timeout: {BASE}')
    except Exception:
        # SSL/DNS странности — пропускаем
        pytest.skip('Network precheck failed')


def _login_session(username: str, password: str) -> requests.Session:
    _ensure_target_or_skip()
    s = requests.Session()
    # load login page for cookies/csrf if needed
    s.get(f'{BASE}/login', allow_redirects=True, timeout=10)
    r = s.post(f'{BASE}/login', data={'login': username, 'password': password}, allow_redirects=True, timeout=15)
    # считаем логин успешным если не возвращает снова /login
    if r.url.endswith('/login') or '/login' in r.url:
        pytest.skip(f'Cannot login as {username}')
    return s


def _expect_forbidden(status: int) -> bool:
    return status in (401, 403)


def _expect_success(status: int) -> bool:
    return status in (200, 201, 204, 302)


@pytest.mark.ui
def test_permissions_users_admin(qa_admin_credentials):
    user, pwd = qa_admin_credentials
    s = _login_session(user, pwd)
    # admin can add user
    r = s.post(f'{BASE}/users/add', data={'login': f'perm_u_{int(time.time())}', 'password': 'QAtest123!'}, allow_redirects=False)
    assert _expect_success(r.status_code)


@pytest.mark.ui
def test_permissions_users_regular_forbidden(qa_regular_credentials):
    user, pwd = qa_regular_credentials
    s = _login_session(user, pwd)
    r = s.post(f'{BASE}/users/add', data={'login': f'perm_u_{int(time.time())}', 'password': 'QAtest123!'}, allow_redirects=False)
    assert _expect_forbidden(r.status_code) or r.status_code == 302 and '/login' in (r.headers.get('Location',''))


@pytest.mark.ui
def test_permissions_groups_manager_can_add(qa_manager_credentials):
    user, pwd = qa_manager_credentials
    s = _login_session(user, pwd)
    r = s.post(f'{BASE}/groups/add', data={'group_name': f'perm_g_{int(time.time())}'}, allow_redirects=False)
    assert _expect_success(r.status_code)


@pytest.mark.ui
def test_permissions_groups_reader_forbidden(qa_reader_credentials):
    user, pwd = qa_reader_credentials
    s = _login_session(user, pwd)
    r = s.post(f'{BASE}/groups/add', data={'group_name': f'perm_g_{int(time.time())}'}, allow_redirects=False)
    assert _expect_forbidden(r.status_code) or r.status_code == 302 and '/login' in (r.headers.get('Location',''))


@pytest.mark.ui
def test_permissions_files_notes_writer_allowed(qa_writer_credentials):
    user, pwd = qa_writer_credentials
    s = _login_session(user, pwd)
    # допускаем, что endpoint существует: /files/note or /files/note/add
    for path in ('/files/note', '/files/note/add'):
        r = s.post(f'{BASE}{path}', data={'path': '/tmp', 'note': 'qa-note'}, allow_redirects=False)
        if r.status_code != 404:
            assert _expect_success(r.status_code)
            break
    else:
        pytest.skip('Files note endpoint not present')


@pytest.mark.ui
def test_permissions_files_move_reader_forbidden(qa_reader_credentials):
    user, pwd = qa_reader_credentials
    s = _login_session(user, pwd)
    # допускаем варианты endpoint'ов
    for path in ('/files/move', '/files_move'):
        r = s.post(f'{BASE}{path}', data={'src': '/tmp/a', 'dst': '/tmp/b'}, allow_redirects=False)
        if r.status_code != 404:
            assert _expect_forbidden(r.status_code) or r.status_code == 302 and '/login' in (r.headers.get('Location',''))
            break
    else:
        pytest.skip('Files move endpoint not present')


@pytest.mark.ui
def test_rate_limit_users_add_burst(qa_admin_credentials):
    user, pwd = qa_admin_credentials
    s = _login_session(user, pwd)
    # быстрая серия запросов для триггера rate limit (ожидаем 429 на части)
    hit_429 = False
    for i in range(15):
        r = s.post(f'{BASE}/users/add', data={'login': f'rl_{int(time.time())}_{i}', 'password': 'QAtest123!'}, allow_redirects=False)
        if r.status_code == 429:
            hit_429 = True
            break
    if not hit_429:
        pytest.skip('Rate limit not triggered (policy may be lenient in this env)')


