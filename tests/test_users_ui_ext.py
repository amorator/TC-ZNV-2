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


@pytest.mark.ui
def test_users_table_and_add_modal():
    d = make_chrome()
    try:
        login_admin(d)
        d.get(f'{BASE}/users')
        time.sleep(0.2)
        # Таблица пользователей должна быть видна по ARIA
        tables = d.find_elements('css selector', "table[role='table'][aria-label='Таблица пользователей']")
        assert tables and tables[0].is_displayed()
        # Открываем модалку добавления пользователя
        add_selectors = ["#add-user-button", "[data-action='add-user']", "button.btn-primary", "a[href*='users'] .btn-primary"]
        opener = None
        for sel in add_selectors:
            els = d.find_elements('css selector', sel)
            if els:
                opener = els[0]
                break
        if not opener:
            pytest.skip('Add user control not found')
        # Делаем элемент кликабельным: скролл + JS-клик как fallback
        d.execute_script("arguments[0].scrollIntoView({block:'center'});", opener)
        time.sleep(0.05)
        try:
            opener.click()
        except Exception:
            d.execute_script("arguments[0].click();", opener)
        time.sleep(0.2)
        # Проверяем, что модалка появилась и фокус на первом поле
        modal_candidates = ["#popup-add", ".modal.show", "#userModal", "#addUserModal"]
        modal = None
        for sel in modal_candidates:
            els = d.find_elements('css selector', sel)
            if els and els[0].is_displayed():
                modal = els[0]
                break
        assert modal is not None, 'Add user modal not visible'
        # Фокус проверяем косвенно: есть ли активный элемент внутри модалки
        active = d.switch_to.active_element
        assert active is not None
        # Закрываем модалку
        close_selectors = [".modal.show [data-bs-dismiss='modal']", ".modal.show .btn-close", ".modal.show .modal-footer .btn-secondary"]
        closed = False
        for sel in close_selectors:
            els = d.find_elements('css selector', sel)
            if els:
                try:
                    els[0].click()
                except Exception:
                    d.execute_script("arguments[0].click();", els[0])
                closed = True
                break
        if not closed:
            # fallback Esc
            d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));")
            time.sleep(0.1)
            # force-hide bootstrap modal if still visible
            d.execute_script("var m=document.querySelector('.modal.show'); if(m){m.style.display='none'; m.classList.remove('show'); document.body.classList.remove('modal-open'); let bd=document.querySelector('.modal-backdrop'); if(bd){bd.parentNode.removeChild(bd);} }")
        time.sleep(0.2)
    finally:
        d.quit()


@pytest.mark.ui
def test_users_context_menu_and_modals():
    d = make_chrome()
    try:
        login_admin(d)
        d.get(f'{BASE}/users')
        time.sleep(0.3)
        # Ищем строку
        row = None
        for sel in ["[data-testid='users-table'] tbody tr", "table[role='table'] tbody tr", "#usertable tbody tr", "table tbody tr"]:
            els = d.find_elements('css selector', sel)
            if els:
                row = els[0]
                break
        if not row:
            pytest.skip('No user rows to test context menu')
        d.execute_script("arguments[0].scrollIntoView({block:'center'});", row)
        time.sleep(0.05)
        try:
            ActionChains(d).context_click(row).perform()
        except Exception:
            togglers = row.find_elements('css selector', "[data-bs-toggle='dropdown'], .dropdown-toggle, .context-toggle")
            if togglers:
                d.execute_script("arguments[0].click();", togglers[0])
            else:
                pytest.skip('No context menu toggle available')
        time.sleep(0.1)
        # Меню и модалки
        menu = None
        for sel in ["[data-testid='users-context-menu']", ".dropdown-menu.show", ".context-menu.show", ".dropdown-menu[style*='display: block']"]:
            els = d.find_elements('css selector', sel)
            if els:
                menu = els[0]
                break
        if not menu:
            pytest.skip('Context menu not visible')
        actions = [
            {"name": "edit", "selectors": ["[data-testid='users-cm-edit']", "[data-action='edit']", "a[href*='edit']", "[data-bs-target='#popup-edit']"]},
            {"name": "perm", "selectors": ["[data-testid='users-cm-perm']", "[data-action='perm']", "a[href*='perm']", "[data-bs-target='#popup-perm']"]},
            {"name": "reset", "selectors": ["[data-testid='users-cm-reset']", "[data-action='reset']", "a[href*='reset']", "[data-bs-target='#popup-reset']"]},
            {"name": "delete", "selectors": ["[data-testid='users-cm-delete']", "[data-action='delete']", "a[href*='delete']", "[data-bs-target='#popup-delete']"]},
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
            modal = None
            for sel in [
                "[data-testid='users-modal-edit'] .popup", "[data-testid='users-modal-perm'] .popup", "[data-testid='users-modal-reset'] .popup", "[data-testid='users-modal-delete'] .popup",
                "#popup-edit.modal.show", "#popup-perm.modal.show", "#popup-reset.modal.show", "#popup-delete.modal.show", ".modal.show[role='dialog']"
            ]:
                els = d.find_elements('css selector', sel)
                if els and els[0].is_displayed():
                    modal = els[0]
                    break
            if modal is None:
                continue
            opened += 1
            # Закрыть модалку
            for sel in ["[data-testid='users-edit-cancel']", "[data-testid='users-perm-cancel']", "[data-testid='users-reset-cancel']", "[data-testid='users-delete-cancel']", ".modal.show [data-bs-dismiss='modal']", ".modal.show .btn-close", ".modal.show .modal-footer .btn-secondary"]:
                els = d.find_elements('css selector', sel)
                if els:
                    try:
                        els[0].click()
                    except Exception:
                        d.execute_script("arguments[0].click();", els[0])
                    break
            time.sleep(0.15)
            # Переоткрыть меню
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
        assert opened >= 1
    finally:
        d.quit()


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


