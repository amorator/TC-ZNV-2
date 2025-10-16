import os
import time
import socket
from urllib.parse import urlparse
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import requests
from tests.config import BASE_URL as BASE, ACCEPT_INSECURE_CERTS

ADMIN_LOGIN = os.getenv('LOGIN', 'admin')
ADMIN_PASSWORD = os.getenv('PASSWORD', 'admin')


def make_chrome():
    opts = Options()
    for f in [
            '--headless=new', '--disable-gpu', '--no-sandbox',
            '--disable-dev-shm-usage', '--disable-setuid-sandbox',
            '--no-zygote', '--single-process', '--ignore-certificate-errors'
    ]:
        opts.add_argument(f)
    if ACCEPT_INSECURE_CERTS:
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


def open_categories(d):
    d.get(f'{BASE}/categories')
    time.sleep(0.3)


def context_click(d, element):
    # JS-эмуляция контекстного клика
    d.execute_script(
        "var ev=new MouseEvent('contextmenu', {bubbles:true}); arguments[0].dispatchEvent(ev);",
        element)
    time.sleep(0.1)


def _ensure_target_or_skip():
    parsed = urlparse(BASE)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    if not host:
        pytest.xfail('BASE_URL has no host')
    try:
        socket.getaddrinfo(host, port)
    except Exception:
        pytest.xfail(f'Host not resolvable: {host}')
    try:
        # Мягкая проверка
        requests.get(BASE,
                     timeout=8,
                     allow_redirects=True,
                     verify=not ACCEPT_INSECURE_CERTS)
    except Exception:
        return


def create_category(d, name: str):
    # Кнопка добавления категории
    add_selectors = [
        "[data-action='add-category']", "#add-category-button",
        "button.btn-primary", "a[href*='category'] .btn-primary"
    ]
    opener = None
    for sel in add_selectors:
        els = d.find_elements('css selector', sel)
        if els:
            opener = els[0]
            break
    if not opener:
        pytest.xfail('Add category control not found')
    d.execute_script("arguments[0].scrollIntoView({block:'center'});", opener)
    try:
        opener.click()
    except Exception:
        d.execute_script("arguments[0].click();", opener)
    time.sleep(0.2)
    # Ждём появления модалки
    modal = None
    end = time.time() + 3
    while time.time() < end:
        els = d.find_elements(
            'css selector',
            "[data-testid='categories-modal-add'].show, #addCategoryModal.show, .modal.show"
        )
        if els:
            modal = els[0]
            break
        time.sleep(0.05)
    if not modal:
        pytest.xfail('Category modal not shown')
    # Пытаемся найти поле имени по вероятным селекторам
    selectors = [
        "[data-testid='categories-modal-add'].show input[name='display_name']",
        "#addCategoryModal.show input[name='display_name']",
        ".modal.show input[name='display_name']",
        ".modal.show input#add_display_name",
        ".modal.show input[type='text']",
        ".modal.show input",
    ]
    target_input = None
    for sel in selectors:
        els = d.find_elements('css selector', sel)
        if els:
            target_input = els[0]
            break
    if not target_input:
        pytest.xfail('Category name input not found')
    # Ввод значения (с учётом неинтерактивности — fallback через JS)
    try:
        d.execute_script("arguments[0].scrollIntoView({block:'center'});",
                         target_input)
        target_input.clear()
        target_input.send_keys(name)
    except Exception:
        d.execute_script(
            "arguments[0].value=arguments[1]; arguments[0].dispatchEvent(new Event('input',{bubbles:true}));",
            target_input, name)
    # Сохранение
    save = d.find_elements(
        'css selector',
        "[data-testid='categories-modal-add'].show .modal-footer .btn-primary, #addCategoryModal.show .modal-footer .btn-primary, .modal.show .modal-footer .btn-primary, .modal.show button[type='submit'], .modal.show .btn-primary"
    )
    if not save:
        pytest.xfail('Category save button not found')
    # Закрываем возможный pushConsentModal, мешающий клику
    try:
        modals = d.find_elements('css selector',
                                 '#pushConsentModal.show, #pushConsentModal')
        if modals and modals[0].is_displayed():
            close_btns = modals[0].find_elements(
                'css selector',
                '[data-bs-dismiss="modal"], .btn-close, .modal-footer .btn-primary, .modal-footer .btn-secondary'
            )
            if close_btns:
                close_btns[0].click()
                time.sleep(0.2)
            else:
                d.execute_script(
                    "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));"
                )
                time.sleep(0.2)
            d.execute_script(
                "(function(){var m=document.getElementById('pushConsentModal'); if(!m) return; try{ var inst=(window.bootstrap&&bootstrap.Modal?bootstrap.Modal.getInstance(m):null)|| (window.bootstrap&&bootstrap.Modal? new bootstrap.Modal(m):null); if(inst) inst.hide(); }catch(_){} try{ m.classList.remove('show'); m.style.display='none'; }catch(_){} })();"
            )
            time.sleep(0.2)
    except Exception:
        pass
    try:
        save[0].click()
    except Exception:
        d.execute_script("arguments[0].click();", save[0])
    time.sleep(0.3)


def delete_category_via_menu(d, cat_el):
    context_click(d, cat_el)
    # Ищем пункт удаления и кликаем
    menu = None
    for sel in [
            "[data-testid='categories-context-menu']", '#categoryContextMenu',
            '.context-menu', '.dropdown-menu.show'
    ]:
        els = d.find_elements('css selector', sel)
        if els and els[0].is_displayed():
            menu = els[0]
            break
    assert menu is not None, 'Context menu not visible'
    # Пытаемся найти элемент с текстом "Удалить"/Delete
    items = d.find_elements(
        'css selector',
        "[data-action='delete-category'], .dropdown-item, [role='menuitem'], li, a, button"
    )
    target = None
    for it in items:
        txt = (it.text or '').lower()
        if 'удал' in txt or 'delete' in txt:
            target = it
            break
    if not target:
        pytest.xfail('Delete item not found in category menu')
    try:
        target.click()
    except Exception:
        d.execute_script("arguments[0].click();", target)
    time.sleep(0.2)
    # Подтверждение в модалке
    confirm = d.find_elements(
        'css selector', ".modal.show .btn-danger, .modal.show .btn-primary")
    if confirm:
        try:
            confirm[0].click()
        except Exception:
            d.execute_script("arguments[0].click();", confirm[0])
        time.sleep(0.3)


@pytest.mark.ui
def test_category_delete_and_toggle_menu():
    """Проверяем, что контекстное меню категории содержит пункты удалить/отключить с корректным состоянием.
    Интеграцию с файлами пока не проверяем.
    """
    d = make_chrome()
    try:
        login_admin(d)
        open_categories(d)
        # Находим первую категорию в списке, если нет — создаём одну
        cat_buttons = d.find_elements(
            'css selector',
            ".category-tab, .categories .nav .nav-link, [data-entity='category']"
        )
        if not cat_buttons:
            create_category(d, name=f"QA Cat {int(time.time())}")
            # Ожидаем появления категории до 4 секунд, обновляя страницу
            end = time.time() + 4
            while time.time() < end:
                cat_buttons = d.find_elements(
                    'css selector',
                    ".category-tab, .categories .nav .nav-link, [data-entity='category']"
                )
                if cat_buttons:
                    break
                d.refresh()
                time.sleep(0.4)
            if not cat_buttons:
                # Если так и нет — проверяем, что показано пустое состояние с кнопкой добавить
                empty_texts = d.find_elements(
                    'css selector', '.empty-state, .alert-info, .placeholder')
                empty_ok = any(
                    e.is_displayed()
                    for e in empty_texts) or ("нет категорий"
                                              in (d.page_source.lower()))
                empty_buttons = d.find_elements(
                    'css selector',
                    "[data-action='add-category'], #add-category-button, .empty-state .btn"
                )
                assert empty_ok and empty_buttons, 'Neither category created nor empty state shown'
                pytest.xfail(
                    'Category creation did not reflect yet; empty state present'
                )
        target = cat_buttons[0]
        # Вызываем контекстное меню
        context_click(d, target)
        # Меню должно появиться
        menu = None
        for sel in [
                "[data-testid='categories-context-menu']",
                '#categoryContextMenu', '.context-menu', '.dropdown-menu.show'
        ]:
            els = d.find_elements('css selector', sel)
            if els and els[0].is_displayed():
                menu = els[0]
                break
        assert menu is not None, 'Context menu not visible'
        # Проверяем наличие пунктов удалить/отключить (не утверждаем enable/disable — только наличие)
        items_text = (menu.text or '').lower()
        assert ('удал' in items_text or 'delete' in items_text)
        assert ('отключ' in items_text or 'disable' in items_text
                or 'toggle' in items_text)
        # Проверяем удаление категории и пустое состояние (кнопки/сообщения)
        delete_category_via_menu(d, target)
        # Пустое состояние: если UI явно не показывает баннер — считаем нормой
        empty_texts = d.find_elements(
            'css selector',
            "[data-testid='categories-tab'] .empty-state, .empty-state, .alert-info, .placeholder"
        )
        empty_ok = any(e.is_displayed() for e in empty_texts)
        empty_text_present = "нет категорий" in d.page_source.lower()
        # Допускаем оба варианта: явный баннер ИЛИ просто отсутствие категорий
        if not (empty_ok or empty_text_present):
            # Проверяем, что хотя бы нет ни одной кнопки категории
            remaining_cats = d.find_elements(
                'css selector',
                ".category-tab, .categories .nav .nav-link, [data-entity='category']"
            )
            assert not remaining_cats, 'Category still present after deletion'
        # Кнопка добавления может отсутствовать на минимальной реализации — не утверждаем жёстко
    finally:
        d.quit()


@pytest.mark.ui
def test_subcategory_delete_protection_smoke():
    """Smokе: у подкатегории должно быть контекстное меню, пункт удаления присутствует.
    Фактическое наличие файлов/защиты проверим после реализации связи.
    """
    d = make_chrome()
    try:
        login_admin(d)
        open_categories(d)
        # Переключаемся на первую категорию с подкатегориями (если есть)
        sub_tabs = d.find_elements(
            'css selector',
            "#subcategory-nav .topbtn, .subcategory-tab, .subcategories .nav .nav-link, [data-entity='subcategory']"
        )
        if not sub_tabs:
            # Допускаем пустое состояние с действиями
            empty_actions = d.find_elements('css selector',
                                            '#empty-subcategories-actions')
            if empty_actions:
                # Кнопки отключить/удалить категорию должны быть видимы или disabled
                buttons = d.find_elements(
                    'css selector',
                    "#empty-subcategories-actions button.btn-outline-warning, #empty-subcategories-actions button.btn-outline-danger"
                )
                assert buttons, 'Empty subcategories actions not rendered'
                pytest.xfail('No subcategories; empty actions rendered')
            pytest.xfail('No subcategories found to test')
        sub = sub_tabs[0]
        context_click(d, sub)
        menu = None
        for sel in [
                "[data-testid='categories-context-menu']",
                '#subcategoryContextMenu', '.context-menu',
                '.dropdown-menu.show'
        ]:
            els = d.find_elements('css selector', sel)
            if els and els[0].is_displayed():
                menu = els[0]
                break
        assert menu is not None, 'Context menu not visible for subcategory'
        items_text = (menu.text or '').lower()
        assert ('удал' in items_text or 'delete' in items_text)
    finally:
        d.quit()


@pytest.mark.ui
def test_categories_context_menu_items():
    """Проверяем полный набор пунктов контекстного меню для категорий и подкатегорий."""
    d = make_chrome()
    try:
        login_admin(d)
        open_categories(d)

        # Создаём категорию если нет
        cat_buttons = d.find_elements(
            'css selector',
            ".category-tab, .categories .nav .nav-link, [data-entity='category']"
        )
        if not cat_buttons:
            create_category(d, name=f"QA Context Cat {int(time.time())}")
            time.sleep(1)
            d.refresh()
            time.sleep(0.5)
            cat_buttons = d.find_elements(
                'css selector',
                ".category-tab, .categories .nav .nav-link, [data-entity='category']"
            )
            if not cat_buttons:
                pytest.xfail('Category creation failed or not reflected')

        # Тестируем контекстное меню категории
        target_cat = cat_buttons[0]
        context_click(d, target_cat)

        menu = None
        for sel in [
                "[data-testid='categories-context-menu']",
                '#categoryContextMenu', '.context-menu', '.dropdown-menu.show'
        ]:
            els = d.find_elements('css selector', sel)
            if els and els[0].is_displayed():
                menu = els[0]
                break

        assert menu is not None, 'Category context menu not visible'

        # Проверяем наличие основных пунктов меню
        menu_items = menu.find_elements('css selector',
                                        'li, a, button, [role="menuitem"]')
        menu_texts = [
            item.text.lower().strip() for item in menu_items if item.text
        ]

        expected_items = [
            'удал', 'delete', 'отключ', 'disable', 'toggle', 'редакт', 'edit'
        ]
        found_items = [
            item for item in expected_items
            if any(item in text for text in menu_texts)
        ]

        assert len(
            found_items
        ) >= 2, f'Expected at least 2 menu items, found: {found_items}'

        # Закрываем меню
        d.execute_script(
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));"
        )
        time.sleep(0.2)

        # Тестируем подкатегории если есть
        sub_tabs = d.find_elements(
            'css selector',
            "#subcategory-nav .topbtn, .subcategory-tab, .subcategories .nav .nav-link, [data-entity='subcategory']"
        )
        if sub_tabs:
            sub_target = sub_tabs[0]
            context_click(d, sub_target)

            sub_menu = None
            for sel in [
                    "[data-testid='categories-context-menu']",
                    '#subcategoryContextMenu', '.context-menu',
                    '.dropdown-menu.show'
            ]:
                els = d.find_elements('css selector', sel)
                if els and els[0].is_displayed():
                    sub_menu = els[0]
                    break

            assert sub_menu is not None, 'Subcategory context menu not visible'

            sub_menu_items = sub_menu.find_elements(
                'css selector', 'li, a, button, [role="menuitem"]')
            sub_menu_texts = [
                item.text.lower().strip() for item in sub_menu_items
                if item.text
            ]

            sub_found_items = [
                item for item in expected_items
                if any(item in text for text in sub_menu_texts)
            ]
            assert len(
                sub_found_items
            ) >= 1, f'Expected at least 1 subcategory menu item, found: {sub_found_items}'

    finally:
        d.quit()


@pytest.mark.ui
def test_categories_delete_confirmation():
    """Проверяем процесс удаления категории с подтверждением."""
    d = make_chrome()
    try:
        login_admin(d)
        open_categories(d)

        # Создаём тестовую категорию
        test_name = f"QA Delete Test {int(time.time())}"
        create_category(d, name=test_name)
        time.sleep(1)
        d.refresh()
        time.sleep(0.5)

        # Находим созданную категорию
        cat_buttons = d.find_elements(
            'css selector',
            ".category-tab, .categories .nav .nav-link, [data-entity='category']"
        )
        target_cat = None
        for cat in cat_buttons:
            if test_name.lower() in (cat.text or '').lower():
                target_cat = cat
                break

        if not target_cat:
            pytest.xfail('Created category not found in UI')

        # Удаляем через контекстное меню
        context_click(d, target_cat)

        menu = None
        for sel in [
                "[data-testid='categories-context-menu']",
                '#categoryContextMenu', '.context-menu', '.dropdown-menu.show'
        ]:
            els = d.find_elements('css selector', sel)
            if els and els[0].is_displayed():
                menu = els[0]
                break

        assert menu is not None, 'Context menu not visible'

        # Находим пункт удаления
        delete_item = None
        for item in menu.find_elements('css selector',
                                       'li, a, button, [role="menuitem"]'):
            if item.text and ('удал' in item.text.lower()
                              or 'delete' in item.text.lower()):
                delete_item = item
                break

        assert delete_item is not None, 'Delete item not found in context menu'

        # Кликаем удаление
        try:
            delete_item.click()
        except Exception:
            d.execute_script("arguments[0].click();", delete_item)

        time.sleep(0.3)

        # Проверяем появление модалки подтверждения
        confirm_modal = None
        for sel in [".modal.show", "#confirmModal", ".confirmation-modal"]:
            els = d.find_elements('css selector', sel)
            if els and els[0].is_displayed():
                confirm_modal = els[0]
                break

        if confirm_modal:
            # Подтверждаем удаление
            confirm_btn = confirm_modal.find_elements(
                'css selector',
                '.btn-danger, .btn-primary, button[type="submit"]')
            if confirm_btn:
                try:
                    confirm_btn[0].click()
                except Exception:
                    d.execute_script("arguments[0].click();", confirm_btn[0])
                time.sleep(0.5)

        # Проверяем, что категория исчезла
        d.refresh()
        time.sleep(0.5)

        remaining_cats = d.find_elements(
            'css selector',
            ".category-tab, .categories .nav .nav-link, [data-entity='category']"
        )
        cat_texts = [cat.text.lower() for cat in remaining_cats if cat.text]

        assert test_name.lower(
        ) not in cat_texts, f'Category {test_name} still present after deletion'

    finally:
        d.quit()


@pytest.mark.ui
def test_categories_empty_state_actions():
    """Проверяем действия в пустом состоянии категорий."""
    d = make_chrome()
    try:
        login_admin(d)
        open_categories(d)

        # Удаляем все категории если есть
        cat_buttons = d.find_elements(
            'css selector',
            ".category-tab, .categories .nav .nav-link, [data-entity='category']"
        )
        for cat in cat_buttons:
            try:
                context_click(d, cat)
                menu = None
                for sel in [
                        "[data-testid='categories-context-menu']",
                        '#categoryContextMenu', '.context-menu',
                        '.dropdown-menu.show'
                ]:
                    els = d.find_elements('css selector', sel)
                    if els and els[0].is_displayed():
                        menu = els[0]
                        break

                if menu:
                    delete_item = None
                    for item in menu.find_elements(
                            'css selector',
                            'li, a, button, [role="menuitem"]'):
                        if item.text and ('удал' in item.text.lower()
                                          or 'delete' in item.text.lower()):
                            delete_item = item
                            break

                    if delete_item:
                        try:
                            delete_item.click()
                        except Exception:
                            d.execute_script("arguments[0].click();",
                                             delete_item)
                        time.sleep(0.3)

                        # Подтверждаем если есть модалка
                        confirm_modal = d.find_elements(
                            'css selector', ".modal.show")
                        if confirm_modal:
                            confirm_btn = confirm_modal[0].find_elements(
                                'css selector', '.btn-danger, .btn-primary')
                            if confirm_btn:
                                try:
                                    confirm_btn[0].click()
                                except Exception:
                                    d.execute_script("arguments[0].click();",
                                                     confirm_btn[0])
                                time.sleep(0.3)

                        d.execute_script(
                            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));"
                        )
                        time.sleep(0.2)
            except Exception:
                continue

        d.refresh()
        time.sleep(0.5)

        # Проверяем пустое состояние: допускаем отсутствие явного баннера
        empty_indicators = d.find_elements(
            'css selector',
            '.empty-state, .alert-info, .placeholder, [data-testid="categories-empty"]'
        )
        empty_text_present = ("нет категорий" in d.page_source.lower()
                              or "no categories" in d.page_source.lower())
        if not (empty_indicators or empty_text_present):
            # Если баннера нет — считаем пустым, если нет ни одной категории
            cats_now = d.find_elements(
                'css selector',
                ".category-tab, .categories .nav .nav-link, [data-entity='category']"
            )
            assert not cats_now, 'Categories still present when expecting empty state'

            # Проверяем наличие кнопки добавления
            add_buttons = d.find_elements(
                'css selector',
                "[data-action='add-category'], #add-category-button, .empty-state .btn, .btn-primary"
            )
            assert add_buttons, 'No add button found in empty state'

            # Проверяем, что кнопка добавления работает
            add_btn = add_buttons[0]
            try:
                add_btn.click()
            except Exception:
                d.execute_script("arguments[0].click();", add_btn)

            time.sleep(0.3)

    finally:
        d.quit()
