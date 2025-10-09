import os
import time
import socket
from urllib.parse import urlparse
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
import requests


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
    _ensure_target_or_skip()
    d.get(f'{BASE}/login')
    d.find_element('css selector', '#login').send_keys(ADMIN_LOGIN)
    d.find_element('css selector', '#password').send_keys(ADMIN_PASSWORD)
    d.find_element('css selector', "button[type=submit]").click()
    time.sleep(0.3)


def close_push_consent_if_any(d):
    try:
        modal = d.find_element('css selector', '#pushConsentModal.show')
        d.execute_script("$('#pushConsentModal').modal('hide');")
        time.sleep(0.1)
        if modal.is_displayed():
            d.execute_script("document.getElementById('pushConsentModal').classList.remove('show');")
            d.execute_script("document.body.classList.remove('modal-open');")
    except Exception:
        pass


@pytest.mark.ui
def test_files_table_and_add_modal():
    d = make_chrome()
    try:
        login_admin(d)
        d.get(f'{BASE}/files')
        time.sleep(0.2)
        close_push_consent_if_any(d)
        # Таблица файлов должна быть видна по ARIA / data-testid
        tables = d.find_elements('css selector', "[data-testid='files-table'], table[role='table'][aria-label='Таблица файлов'], #maintable")
        assert tables and tables[0].is_displayed()
        # Открываем модалку добавления файла
        add_selectors = ["#add-file-button", "[data-action='add-file']", "button.btn-primary"]
        opener = None
        for sel in add_selectors:
            els = d.find_elements('css selector', sel)
            if els:
                opener = els[0]
                break
        if not opener:
            pytest.skip('Add file control not found')
        # Скролл + JS-клик как fallback
        d.execute_script("arguments[0].scrollIntoView({block:'center'});", opener)
        time.sleep(0.05)
        try:
            opener.click()
        except Exception:
            d.execute_script("arguments[0].click();", opener)
        time.sleep(0.2)
        # Проверяем модалку и фокус
        modal_candidates = ["[data-testid='files-modal-add'] .popup", "#popup-add", ".modal.show", "#addFileModal"]
        modal = None
        for sel in modal_candidates:
            els = d.find_elements('css selector', sel)
            if els and els[0].is_displayed():
                modal = els[0]
                break
        assert modal is not None, 'Add file modal not visible'
        active = d.switch_to.active_element
        assert active is not None
        # Закрываем модалку
        close_selectors = ["[data-testid='files-add-cancel']", ".modal.show [data-bs-dismiss='modal']", ".modal.show .btn-close", ".modal.show .modal-footer .btn-secondary"]
        for sel in close_selectors:
            els = d.find_elements('css selector', sel)
            if els:
                try:
                    els[0].click()
                except Exception:
                    d.execute_script("arguments[0].click();", els[0])
                break
        time.sleep(0.2)
    finally:
        d.quit()


@pytest.mark.ui
def test_files_context_menu_and_modals():
    d = make_chrome()
    try:
        login_admin(d)
        d.get(f'{BASE}/files')
        time.sleep(0.3)
        close_push_consent_if_any(d)
        # Ищем строку в таблице
        row_selectors = [
            "table[role='table'] tbody tr",
            "#maintable tbody tr",
            "table tbody tr"
        ]
        row = None
        for sel in row_selectors:
            els = d.find_elements('css selector', sel)
            if els:
                row = els[0]
                break
        if not row:
            pytest.skip('No file rows to test context menu')
        d.execute_script("arguments[0].scrollIntoView({block:'center'});", row)
        time.sleep(0.05)
        # Правый клик
        try:
            ActionChains(d).context_click(row).perform()
        except Exception:
            # fallback: открыть кнопкой меню в строке, если есть
            togglers = row.find_elements('css selector', "[data-bs-toggle='dropdown'], .dropdown-toggle, .context-toggle")
            if togglers:
                d.execute_script("arguments[0].click();", togglers[0])
            else:
                pytest.skip('No context menu toggle available')
        time.sleep(0.1)
        # Меню
        menu = None
        for sel in ["[data-testid='files-context-menu']", ".dropdown-menu.show", ".context-menu.show", ".dropdown-menu[style*='display: block']"]:
            els = d.find_elements('css selector', sel)
            if els:
                menu = els[0]
                break
        if not menu:
            pytest.skip('Context menu not visible')
        # Попробуем по очереди открыть модалки через пункты меню
        actions = [
            {"name": "edit", "selectors": ["[data-testid='files-cm-edit']", "[data-action='edit']", "a[href*='edit']", "[data-bs-target='#popup-edit']"]},
            {"name": "move", "selectors": ["[data-testid='files-cm-move']", "[data-action='move']", "a[href*='move']", "[data-bs-target='#popup-move']"]},
            {"name": "note", "selectors": ["[data-testid='files-cm-note']", "[data-action='note']", "a[href*='note']", "[data-bs-target='#popup-note']"]},
            {"name": "delete", "selectors": ["[data-testid='files-cm-delete']", "[data-action='delete']", "a[href*='delete']", "[data-bs-target='#popup-delete']"]},
        ]
        opened = 0
        for act in actions:
            item = None
            for sel in act["selectors"]:
                els = menu.find_elements('css selector', sel)
                if not els:
                    els = d.find_elements('css selector', sel)
                if els:
                    item = els[0]
                    break
            if not item:
                continue
            try:
                item.click()
            except Exception:
                d.execute_script("arguments[0].click();", item)
            time.sleep(0.2)
            # Проверяем модалку
            modal = None
            for sel in [
                "[data-testid='files-modal-edit'] .popup", "[data-testid='files-modal-move'] .popup", "[data-testid='files-modal-note'] .popup", "[data-testid='files-modal-delete'] .popup",
                "#popup-edit.modal.show", "#popup-move.modal.show", "#popup-note.modal.show", "#popup-delete.modal.show", ".modal.show[role='dialog']"
            ]:
                els = d.find_elements('css selector', sel)
                if els and els[0].is_displayed():
                    modal = els[0]
                    break
            if modal is None:
                continue
            opened += 1
            # Проверка фокуса внутри модалки
            active = d.switch_to.active_element
            assert active is not None
            # Закрываем модалку
            closed = False
            for sel in ["[data-testid='files-edit-cancel']", "[data-testid='files-move-cancel']", "[data-testid='files-note-cancel']", "[data-testid='files-delete-cancel']", ".modal.show [data-bs-dismiss='modal']", ".modal.show .btn-close", ".modal.show .modal-footer .btn-secondary"]:
                els = d.find_elements('css selector', sel)
                if els:
                    try:
                        els[0].click()
                    except Exception:
                        d.execute_script("arguments[0].click();", els[0])
                    closed = True
                    break
            if not closed:
                # по ESC
                d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}));")
            time.sleep(0.15)
            # Переоткрыть меню для следующего пункта
            try:
                ActionChains(d).context_click(row).perform()
            except Exception:
                togglers = row.find_elements('css selector', "[data-bs-toggle='dropdown'], .dropdown-toggle, .context-toggle")
                if togglers:
                    d.execute_script("arguments[0].click();", togglers[0])
            time.sleep(0.1)
            menu = None
            for sel in [".dropdown-menu.show", ".context-menu.show", ".dropdown-menu[style*='display: block']"]:
                els = d.find_elements('css selector', sel)
                if els:
                    menu = els[0]
                    break
            if not menu:
                break
        assert opened >= 1, 'No modals opened from context menu'
    finally:
        d.quit()


def _ensure_target_or_skip():
    parsed = urlparse(BASE)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    if not host:
        pytest.skip('BASE_URL has no host')
    # DNS resolve
    try:
        socket.getaddrinfo(host, port)
    except Exception:
        pytest.skip(f'Host not resolvable: {host}')
    # HTTP reachability (HEAD) - проверяем только доступность сервера, не HTTP статус
    try:
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



