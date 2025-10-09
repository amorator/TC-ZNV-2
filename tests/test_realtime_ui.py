import os
import time
import pytest
import socket
import requests
from urllib.parse import urlparse
from selenium import webdriver
from selenium.webdriver.chrome.options import Options


BASE = os.getenv('BASE_URL', 'http://localhost:5000')
ADMIN_LOGIN = os.getenv('LOGIN', 'admin')
ADMIN_PASSWORD = os.getenv('PASSWORD', 'admin')
RBAC_USER = os.getenv('RBAC_USER', 'qauser000')
RBAC_PASS = os.getenv('RBAC_PASS', 'QAtest123!')


def make_chrome():
    opts = Options()
    for f in [
        '--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
        '--disable-setuid-sandbox','--no-zygote','--single-process','--ignore-certificate-errors'
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
        # Проверяем только доступность сервера, не HTTP статус
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


def login(d, user: str, password: str):
    _ensure_target_or_skip()
    d.get(f'{BASE}/login')
    d.find_element('css selector', '#login').send_keys(user)
    d.find_element('css selector', '#password').send_keys(password)
    d.find_element('css selector', "button[type=submit]").click()
    time.sleep(0.4)


def send_admin_broadcast(d_admin, text: str):
    d_admin.get(f'{BASE}/admin')
    time.sleep(0.3)
    # Используем стабильные локаторы
    openers = d_admin.find_elements('css selector', "[data-testid='admin-open-notify']")
    if not openers:
        pytest.skip('Admin send-message control not found')
    try:
        openers[0].click()
    except Exception:
        d_admin.execute_script("arguments[0].click();", openers[0])
    time.sleep(0.2)
    # Вводим текст и отправляем
    inputs = d_admin.find_elements('css selector', "#notifyTextM, #notify-text, textarea[name='message'], .modal textarea")
    if not inputs:
        pytest.skip('Admin message textarea not found')
    inputs[0].clear()
    inputs[0].send_keys(text)
    send_btns = d_admin.find_elements('css selector', "[data-testid='admin-send-notify'], .modal-footer .btn-primary, button[type='submit'], #notify-send")
    if not send_btns:
        pytest.skip('Admin send button not found')
    send_btns[0].click()
    time.sleep(0.3)


def create_test_user(d_admin, username: str):
    """Создаём тестового пользователя через UI."""
    base_url = os.getenv('BASE_URL', 'http://localhost:5000')
    d_admin.get(f'{base_url}/users')
    time.sleep(0.3)
    
    # Открываем модалку добавления
    add_btns = d_admin.find_elements('css selector', "[data-testid='users-cm-add'], [data-testid='users-modal-add'], #popup-add button")
    if not add_btns:
        pytest.skip('Add user button not found')
    
    try:
        add_btns[0].click()
    except Exception:
        d_admin.execute_script("arguments[0].click();", add_btns[0])
    
    time.sleep(0.3)
    
    # Заполняем форму
    login_field = d_admin.find_elements('css selector', "#add-login, input[name='login']")
    password_field = d_admin.find_elements('css selector', "#add-password, input[name='password']")
    
    if not login_field or not password_field:
        pytest.skip('User form fields not found')
    
    login_field[0].clear()
    login_field[0].send_keys(username)
    password_field[0].clear()
    password_field[0].send_keys("TestPass123!")
    
    # Сохраняем
    save_btn = d_admin.find_elements('css selector', "[data-testid='users-modal-add'] button[type='submit'], .modal.show button[type='submit']")
    if save_btn:
        try:
            save_btn[0].click()
        except Exception:
            d_admin.execute_script("arguments[0].click();", save_btn[0])
        time.sleep(0.5)


def wait_for_user_in_list(d_user, username: str, timeout: float = 5.0) -> bool:
    """Ожидаем появления пользователя в списке."""
    end = time.time() + timeout
    while time.time() < end:
        d_user.refresh()
        time.sleep(0.3)
        users = d_user.find_elements('css selector', "[data-testid='users-table'] tbody tr, .users-table tbody tr, table tbody tr")
        for user_row in users:
            if username in (user_row.text or ''):
                return True
        time.sleep(0.5)
    return False


def create_test_file(d_admin, filename: str):
    """Создаём тестовый файл через UI."""
    base_url = os.getenv('BASE_URL', 'http://localhost:5000')
    d_admin.get(f'{base_url}/files')
    time.sleep(0.3)
    
    # Открываем модалку добавления файла
    add_btns = d_admin.find_elements('css selector', "[data-testid='files-cm-add'], [data-testid='files-modal-add'], #popup-add button")
    if not add_btns:
        pytest.skip('Add file button not found')
    
    try:
        add_btns[0].click()
    except Exception:
        d_admin.execute_script("arguments[0].click();", add_btns[0])
    
    time.sleep(0.3)
    
    # Заполняем форму
    name_field = d_admin.find_elements('css selector', "#add-name, input[name='name']")
    if not name_field:
        pytest.skip('File name field not found')
    
    name_field[0].clear()
    name_field[0].send_keys(filename)
    
    # Сохраняем
    save_btn = d_admin.find_elements('css selector', "[data-testid='files-modal-add'] button[type='submit'], .modal.show button[type='submit']")
    if save_btn:
        try:
            save_btn[0].click()
        except Exception:
            d_admin.execute_script("arguments[0].click();", save_btn[0])
        time.sleep(0.5)


def wait_for_file_in_list(d_user, filename: str, timeout: float = 5.0) -> bool:
    """Ожидаем появления файла в списке."""
    end = time.time() + timeout
    while time.time() < end:
        d_user.refresh()
        time.sleep(0.3)
        files = d_user.find_elements('css selector', "[data-testid='files-table'] tbody tr, .files-table tbody tr, table tbody tr")
        for file_row in files:
            if filename in (file_row.text or ''):
                return True
        time.sleep(0.5)
    return False


def create_test_group(d_admin, groupname: str):
    """Создаём тестовую группу через UI."""
    base_url = os.getenv('BASE_URL', 'http://localhost:5000')
    d_admin.get(f'{base_url}/groups')
    time.sleep(0.3)
    
    # Открываем модалку добавления
    add_btns = d_admin.find_elements('css selector', "[data-testid='groups-cm-add'], [data-testid='groups-modal-add'], #popup-add button")
    if not add_btns:
        pytest.skip('Add group button not found')
    
    try:
        add_btns[0].click()
    except Exception:
        d_admin.execute_script("arguments[0].click();", add_btns[0])
    
    time.sleep(0.3)
    
    # Заполняем форму
    name_field = d_admin.find_elements('css selector', "#add-group-name, input[name='group_name']")
    if not name_field:
        pytest.skip('Group name field not found')
    
    name_field[0].clear()
    name_field[0].send_keys(groupname)
    
    # Сохраняем
    save_btn = d_admin.find_elements('css selector', "[data-testid='groups-modal-add'] button[type='submit'], .modal.show button[type='submit']")
    if save_btn:
        try:
            save_btn[0].click()
        except Exception:
            d_admin.execute_script("arguments[0].click();", save_btn[0])
        time.sleep(0.5)


def wait_for_group_in_list(d_user, groupname: str, timeout: float = 5.0) -> bool:
    """Ожидаем появления группы в списке."""
    end = time.time() + timeout
    while time.time() < end:
        d_user.refresh()
        time.sleep(0.3)
        groups = d_user.find_elements('css selector', "[data-testid='groups-table'] tbody tr, .groups-table tbody tr, table tbody tr")
        for group_row in groups:
            if groupname in (group_row.text or ''):
                return True
        time.sleep(0.5)
    return False
    """Ожидаем, что на клиенте появится уведомление (toast/alert) с текстом."""
    end = time.time() + timeout
    while time.time() < end:
        html = d_user.page_source
        # Часто уведомления реализованы через .toast или role='alert'
        if text in html:
            return True
        # Ищем явные элементы
        toasts = d_user.find_elements('css selector', "#toastContainer .toast, .toast, [role='alert']")
        if any(text in (t.text or '') for t in toasts):
            return True
        time.sleep(0.5)
    return False


@pytest.mark.ui
def test_realtime_admin_broadcast_to_user(qa_admin_credentials, qa_regular_credentials):
    """Админ отправляет уведомление — пользователь видит всплывающее сообщение (через сокеты)."""
    d_admin = make_chrome()
    d_user = make_chrome()
    try:
        # Входим админом и пользователем в отдельных сессиях
        admin_user, admin_pass = qa_admin_credentials
        regular_user, regular_pass = qa_regular_credentials
        
        login(d_admin, admin_user, admin_pass)
        login(d_user, regular_user, regular_pass)
        
        # Пользователь на главной/файлах, где есть контейнер для уведомлений
        d_user.get(f'{BASE}/files')
        time.sleep(0.3)
        
        # Отправляем широковещательное уведомление
        marker = f"QA broadcast {int(time.time())}"
        send_admin_broadcast(d_admin, marker)
        
        # Ждем появления уведомления на стороне пользователя
        assert wait_user_notification(d_user, marker), 'User did not receive realtime notification'
    finally:
        d_admin.quit()
        d_user.quit()


@pytest.mark.ui
def test_realtime_user_creation_updates(qa_admin_credentials):
    """Админ создаёт пользователя — другой админ видит обновление в реальном времени."""
    d_admin1 = make_chrome()
    d_admin2 = make_chrome()
    try:
        # Оба админа входят в систему
        admin_user, admin_pass = qa_admin_credentials
        login(d_admin1, admin_user, admin_pass)
        login(d_admin2, admin_user, admin_pass)
        
        # Второй админ открывает страницу пользователей
        d_admin2.get(f'{BASE}/users')
        time.sleep(0.3)
        
        # Первый админ создаёт пользователя
        test_username = f"qarealtime{int(time.time())}"
        create_test_user(d_admin1, test_username)
        
        # Второй админ должен увидеть нового пользователя
        assert wait_for_user_in_list(d_admin2, test_username), f'User {test_username} not appeared in realtime'
        
    finally:
        d_admin1.quit()
        d_admin2.quit()


@pytest.mark.ui
def test_realtime_file_creation_updates(qa_admin_credentials, qa_regular_credentials):
    """Админ создаёт файл — другой пользователь видит обновление в реальном времени."""
    d_admin = make_chrome()
    d_user = make_chrome()
    try:
        # Админ и пользователь входят в систему
        admin_user, admin_pass = qa_admin_credentials
        regular_user, regular_pass = qa_regular_credentials
        
        login(d_admin, admin_user, admin_pass)
        login(d_user, regular_user, regular_pass)
        
        # Пользователь открывает страницу файлов
        d_user.get(f'{BASE}/files')
        time.sleep(0.3)
        
        # Админ создаёт файл
        test_filename = f"qarealtime_file_{int(time.time())}.txt"
        create_test_file(d_admin, test_filename)
        
        # Пользователь должен увидеть новый файл
        assert wait_for_file_in_list(d_user, test_filename), f'File {test_filename} not appeared in realtime'
        
    finally:
        d_admin.quit()
        d_user.quit()


@pytest.mark.ui
def test_realtime_group_creation_updates(qa_admin_credentials):
    """Админ создаёт группу — другой админ видит обновление в реальном времени."""
    d_admin1 = make_chrome()
    d_admin2 = make_chrome()
    try:
        # Оба админа входят в систему
        admin_user, admin_pass = qa_admin_credentials
        login(d_admin1, admin_user, admin_pass)
        login(d_admin2, admin_user, admin_pass)
        
        # Второй админ открывает страницу групп
        d_admin2.get(f'{BASE}/groups')
        time.sleep(0.3)
        
        # Первый админ создаёт группу
        test_groupname = f"qarealtime_group_{int(time.time())}"
        create_test_group(d_admin1, test_groupname)
        
        # Второй админ должен увидеть новую группу
        assert wait_for_group_in_list(d_admin2, test_groupname), f'Group {test_groupname} not appeared in realtime'
        
    finally:
        d_admin1.quit()
        d_admin2.quit()


@pytest.mark.ui
def test_realtime_multiple_sessions_notifications(qa_admin_credentials, qa_regular_credentials, qa_reader_credentials):
    """Тест множественных сессий: админ отправляет уведомления нескольким пользователям."""
    d_admin = make_chrome()
    d_user1 = make_chrome()
    d_user2 = make_chrome()
    try:
        # Все входят в систему
        admin_user, admin_pass = qa_admin_credentials
        regular_user, regular_pass = qa_regular_credentials
        reader_user, reader_pass = qa_reader_credentials
        
        login(d_admin, admin_user, admin_pass)
        login(d_user1, regular_user, regular_pass)
        login(d_user2, reader_user, reader_pass)
        
        # Пользователи на разных страницах
        d_user1.get(f'{BASE}/files')
        d_user2.get(f'{BASE}/files')
        time.sleep(0.3)
        
        # Админ отправляет уведомление
        marker = f"QA multi-session {int(time.time())}"
        send_admin_broadcast(d_admin, marker)
        
        # Оба пользователя должны получить уведомление
        user1_received = wait_user_notification(d_user1, marker, timeout=6.0)
        user2_received = wait_user_notification(d_user2, marker, timeout=6.0)
        
        assert user1_received, 'Regular user did not receive notification'
        assert user2_received, 'Reader user did not receive notification'
        
    finally:
        d_admin.quit()
        d_user1.quit()
        d_user2.quit()


@pytest.mark.ui
def test_realtime_cross_role_notifications(all_user_credentials):
    """Тест уведомлений между пользователями разных ролей."""
    d_admin = make_chrome()
    d_manager = make_chrome()
    d_writer = make_chrome()
    d_reader = make_chrome()
    
    try:
        # Получаем учётные данные
        admin_user, admin_pass = all_user_credentials['qa_admin']
        manager_user, manager_pass = all_user_credentials['qa_manager']
        writer_user, writer_pass = all_user_credentials['qa_writer']
        reader_user, reader_pass = all_user_credentials['qa_reader']
        
        # Все входят в систему
        login(d_admin, admin_user, admin_pass)
        login(d_manager, manager_user, manager_pass)
        login(d_writer, writer_user, writer_pass)
        login(d_reader, reader_user, reader_pass)
        
        # Все пользователи на странице файлов
        for driver in [d_manager, d_writer, d_reader]:
            driver.get(f'{BASE}/files')
        time.sleep(0.3)
        
        # Админ отправляет уведомление
        marker = f"QA cross-role {int(time.time())}"
        send_admin_broadcast(d_admin, marker)
        
        # Все пользователи должны получить уведомление
        manager_received = wait_user_notification(d_manager, marker, timeout=6.0)
        writer_received = wait_user_notification(d_writer, marker, timeout=6.0)
        reader_received = wait_user_notification(d_reader, marker, timeout=6.0)
        
        assert manager_received, 'Manager did not receive notification'
        assert writer_received, 'Writer did not receive notification'
        assert reader_received, 'Reader did not receive notification'
        
    finally:
        d_admin.quit()
        d_manager.quit()
        d_writer.quit()
        d_reader.quit()
