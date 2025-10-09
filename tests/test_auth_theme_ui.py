import os
import time
import pytest
import socket
import requests
from urllib.parse import urlparse
from selenium import webdriver
from selenium.webdriver.chrome.options import Options


BASE = os.getenv('BASE_URL', 'http://localhost:5000')
LOGIN = os.getenv('LOGIN', 'admin')
PASSWORD = os.getenv('PASSWORD', 'admin')


def _ensure_target_or_skip():
    base_url = os.getenv('BASE_URL', 'http://localhost:5000')
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
        '--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
        '--disable-setuid-sandbox','--no-zygote','--single-process','--ignore-certificate-errors'
    ]:
        opts.add_argument(f)
    # Use strict TLS if CERT_FILE provided
    if os.getenv('CERT_FILE'):
        pass
    else:
        opts.set_capability('acceptInsecureCerts', True)
    # Selenium Manager will pick a compatible chromedriver for installed Chromium
    d = webdriver.Chrome(options=opts)
    d.set_page_load_timeout(30)
    d.set_script_timeout(30)
    return d


def _login(d):
    d.get(f'{BASE}/login')
    d.find_element('css selector', '#login').send_keys(LOGIN)
    d.find_element('css selector', '#password').send_keys(PASSWORD)
    d.find_element('css selector', "button[type=submit]").click()
    time.sleep(0.2)


@pytest.mark.ui
def test_login_logout_selenium():
    d = make_chrome()
    try:
        _login(d)
        # Должна открыться главная/файлы/админ — проверяем наличие верхнего меню
        topbar = d.find_elements('css selector', 'nav, .navbar, #topmenu, header')
        assert any(e.is_displayed() for e in topbar)
        # Закрываем возможный оверлей pushConsentModal, чтобы не перехватывал клики
        try:
            modals = d.find_elements('css selector', '#pushConsentModal.show, #pushConsentModal')
            if modals and modals[0].is_displayed():
                # ищем кнопку закрытия
                close_btns = modals[0].find_elements('css selector', '[data-bs-dismiss="modal"], .btn-close, .modal-footer .btn-primary, .modal-footer .btn-secondary')
                if close_btns:
                    close_btns[0].click()
                    time.sleep(0.2)
                else:
                    # как fallback, нажатие Escape
                    d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));")
                    time.sleep(0.2)
                # В любом случае, принудительно скрываем/удаляем модалку через Bootstrap API/JS
                try:
                    d.execute_script("(function(){var m=document.getElementById('pushConsentModal'); if(!m) return; try{ var inst=(window.bootstrap&&bootstrap.Modal?bootstrap.Modal.getInstance(m):null)|| (window.bootstrap&&bootstrap.Modal? new bootstrap.Modal(m):null); if(inst) inst.hide(); }catch(_){} try{ m.classList.remove('show'); m.style.display='none'; }catch(_){} try{ m.remove(); }catch(_){} })();")
                    time.sleep(0.2)
                except Exception:
                    pass
        except Exception:
            pass
        # Логаут через кнопку/ссылку, либо прямой переход
        logout_candidates = [
            "a[href='/logout']",
            "button#logout",
            "[data-action='logout']",
        ]
        clicked = False
        for sel in logout_candidates:
            els = d.find_elements('css selector', sel)
            if els:
                try:
                    els[0].click()
                except Exception:
                    # если всё ещё перекрыто, уходим прямой ссылкой
                    d.get(f'{BASE}/logout')
                clicked = True
                break
        if not clicked:
            d.get(f'{BASE}/logout')
        time.sleep(0.2)
        # После логаута должна быть форма логина
        assert d.find_element('css selector', '#login').is_displayed()
    finally:
        d.quit()


@pytest.mark.ui
def test_theme_toggle_selenium():
    d = make_chrome()
    try:
        _login(d)
        # Закрываем возможный оверлей pushConsentModal, чтобы не перехватывал клики
        try:
            modals = d.find_elements('css selector', '#pushConsentModal.show, #pushConsentModal')
            if modals and modals[0].is_displayed():
                close_btns = modals[0].find_elements('css selector', '[data-bs-dismiss="modal"], .btn-close, .modal-footer .btn-primary, .modal-footer .btn-secondary')
                if close_btns:
                    try:
                        close_btns[0].click()
                    except Exception:
                        d.execute_script("arguments[0].click();", close_btns[0])
                    time.sleep(0.2)
                d.execute_script("(function(){var m=document.getElementById('pushConsentModal'); if(!m) return; try{ var inst=(window.bootstrap&&bootstrap.Modal?bootstrap.Modal.getInstance(m):null)|| (window.bootstrap&&bootstrap.Modal? new bootstrap.Modal(m):null); if(inst) inst.hide(); }catch(_){} try{ m.classList.remove('show'); m.style.display='none'; }catch(_){} try{ var bd=document.querySelector('.modal-backdrop'); if(bd) bd.remove(); }catch(_){} })();")
                time.sleep(0.2)
        except Exception:
            pass
        # Пробуем найти переключатель темы (несколько возможных селекторов)
        toggle_selectors = [
            '#theme-toggle',
            "button[data-bs-theme]",
            "[data-action='toggle-theme']",
            "#toggle-theme",
        ]
        toggle = None
        for sel in toggle_selectors:
            els = d.find_elements('css selector', sel)
            if els:
                toggle = els[0]
                break
        assert toggle is not None, 'Theme toggle control not found'
        # Снимок состояния темы до клика (атрибуты, класс html, иконка)
        def read_theme_state():
            state = {}
            try:
                html = d.find_element('css selector', 'html')
                state['html_attr'] = html.get_attribute('data-bs-theme') or ''
                state['html_class'] = html.get_attribute('class') or ''
            except Exception:
                state['html_attr'] = ''
                state['html_class'] = ''
            try:
                body = d.find_element('css selector', 'body')
                state['body_attr'] = body.get_attribute('data-theme') or ''
            except Exception:
                state['body_attr'] = ''
            try:
                btn = toggle
                ic = btn.find_elements('css selector', 'i')
                state['icon_class'] = (ic[0].get_attribute('class') if ic else '') or ''
            except Exception:
                state['icon_class'] = ''
            return state
        before = read_theme_state()
        # Клик + небольшой поллинг на изменение состояния
        def click_toggle():
            try:
                toggle.click()
            except Exception:
                d.execute_script("arguments[0].click();", toggle)
        click_toggle()
        changed = False
        for _ in range(6):
            time.sleep(0.2)
            after = read_theme_state()
            if after != before:
                changed = True
                break
        # Если с первого раза не изменилось (например, анимация/дебаунс), пробуем ещё раз
        if not changed:
            click_toggle()
            for _ in range(6):
                time.sleep(0.2)
                after = read_theme_state()
                if after != before:
                    changed = True
                    break
        assert changed, f"Theme did not change after toggle: before={before}, after={after}"
    finally:
        d.quit()


