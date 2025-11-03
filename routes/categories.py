"""
Маршруты управления категориями и подкатегориями файлов.

Возможности:
- CRUD категорий и подкатегорий (папки неизменяемы при редактировании)
- Проверки бизнес-правил (запрет удаления/выключения при несоответствии условий)
- API для фронтенда (JSON, корректные коды ошибок для AJAX)
- Ограничение частоты разрушающих операций (rate limiting)
"""

from flask import render_template, request, jsonify, redirect, url_for, flash
from flask_login import login_required, current_user
from modules.logging import get_logger, log_action
from modules.permissions import require_permissions, CATEGORIES_VIEW, CATEGORIES_MANAGE, SUBCATEGORIES_VIEW, SUBCATEGORIES_MANAGE
import time
from functools import wraps
import os
import re
from json import loads, dumps

_log = get_logger(__name__)


def register(app, socketio=None):
    """Регистрация маршрутов управления категориями/подкатегориями."""

    # Socket.IO: support SyncManager.joinRoom('categories')
    try:
        _sock = socketio if socketio else getattr(app, 'socketio', None)
        if _sock:
            from flask_socketio import join_room

            @_sock.on('categories:join')
            def _categories_join(_data=None):
                try:
                    join_room('categories')
                except Exception:
                    pass
    except Exception:
        pass

    # Get rate limiter from app
    rate_limit = app.rate_limiters.get(
        'categories',
        app.rate_limiters.get('default', lambda *args, **kwargs: lambda f: f))

    def _emit_categories_changed(payload: dict) -> None:
        if _log.isEnabledFor(logging.DEBUG):
            _log.debug(f"[categories] emit categories:changed: {payload}")
        _sock = socketio if socketio else getattr(app, 'socketio', None)
        if not _sock:
            _log.error("[categories] emit failed: socketio missing")
            return
        try:
            _sock.emit('categories:changed', payload)
            _sock.emit('categories:changed', payload, namespace='/')
        except Exception as e:
            _log.error(f"[categories] emit failed: {e}")

    def _wants_json_response() -> bool:
        """Определение, ожидает ли клиент JSON‑ответ (AJAX/fetch)."""
        xrw = request.headers.get('X-Requested-With', '').lower()
        if xrw in ('xmlhttprequest', 'fetch'):
            return True
        accept = request.headers.get('Accept', '')
        if 'application/json' in (accept or '').lower():
            return True
        if request.args.get('ajax') == '1':
            return True
        return False

    # Files root resolver with fallback
    def _files_root() -> str:
        """Resolve files root from config, supporting dict and ConfigParser."""
        cfg = getattr(app, '_sql', None)
        conf = getattr(cfg, 'config', None)
        if conf:
            try:
                files = conf['files']
                base = str(files.get('root') or '').strip()
                if base:
                    return base if os.path.isabs(base) else os.path.abspath(base)
            except Exception:
                pass
            try:
                base = str(conf.get('files', 'root', fallback='')).strip()
                if base:
                    return base if os.path.isabs(base) else os.path.abspath(base)
            except Exception:
                pass
        return os.path.join(app.root_path, 'files')

    # Startup directory initialization removed to avoid root-owned folders.

    # --- Permissions helpers (shared with registrators pattern) ---
    def enforce_admin_access_permissions(perms: dict) -> dict:
        """Ensure admin group/users always have access; cascade group->user."""
        try:
            admin_group_name = app.config.get('admin', {}).get('group', 'Программисты')
            groups = app._sql.execute_query(
                f"SELECT id, name FROM {app._sql.config['db']['prefix']}_group ORDER BY name;",
                []) or []
            users = app._sql.execute_query(
                f"SELECT id, login, permission, gid FROM {app._sql.config['db']['prefix']}_user ORDER BY login;",
                []) or []

            if not isinstance(perms, dict):
                perms = {}
            if 'group' not in perms:
                perms['group'] = {}
            if 'user' not in perms:
                perms['user'] = {}
            if 'group_by_id' not in perms:
                perms['group_by_id'] = {}

            # Force admin group
            for group_id, group_name in groups:
                try:
                    if str(group_name).lower() == str(admin_group_name).lower():
                        perms['group'][str(group_id)] = 1
                        # Force full matrix for categories: view/edit/delete = all
                        gb = perms['group_by_id'].get(str(group_id), {}) if isinstance(perms['group_by_id'].get(str(group_id)), dict) else {}
                        for action in ('view', 'edit', 'delete'):
                            gb[f'{action}_own'] = 0
                            gb[f'{action}_group'] = 0
                            gb[f'{action}_all'] = 1
                        perms['group_by_id'][str(group_id)] = gb
                except Exception:
                    continue

            # Force admin/full-access users
            for user_id, login, permission, gid in users:
                try:
                    force = False
                    if str(login).lower() == 'admin':
                        force = True
                    if permission:
                        perm_str = str(permission).strip()
                        if (
                            perm_str == 'aef,a,abcdflm,ab,ab,ab,abcd'
                            or perm_str == 'aef,a,abcdflm,ab,ab,ab'
                            or 'z' in perm_str
                            or 'полный доступ' in perm_str
                            or 'full access' in perm_str
                        ):
                            force = True
                    if force:
                        perms['user'][str(user_id)] = 1
                except Exception:
                    continue

            # Cascade group -> user
            perms = apply_group_cascade_permissions(perms, groups, users)
            return perms
        except Exception:
            return perms

    def apply_group_cascade_permissions(perms: dict, groups, users) -> dict:
        try:
            for user_id, login, permission, gid in users:
                uid = str(user_id)
                gid_s = str(gid)
                if gid_s in perms.get('group', {}) and perms['group'][gid_s] == 1:
                    perms['user'][uid] = 1
                elif gid_s in perms.get('group', {}) and perms['group'][gid_s] == 0:
                    if uid not in perms.get('user', {}):
                        perms['user'][uid] = 0
            return perms
        except Exception:
            return perms

    # --- Effective permissions computation (server-side) ---
    def _axis_selected(per_user: dict, action: str) -> str:
        """Return one of: 'inherit' (default), 'none', 'own', 'group', 'all'."""
        try:
            if not isinstance(per_user, dict):
                return 'inherit'
            inherit_key = f"{action}_inherit"
            has_axis = any(k.startswith(f"{action}_") for k in per_user.keys())
            if not has_axis:
                return 'inherit'
            if int(per_user.get(inherit_key, 0) or 0) == 1:
                return 'inherit'
            if int(per_user.get(f"{action}_all", 0) or 0) == 1:
                return 'all'
            if int(per_user.get(f"{action}_group", 0) or 0) == 1:
                return 'group'
            if int(per_user.get(f"{action}_own", 0) or 0) == 1:
                return 'own'
            return 'none'
        except Exception:
            return 'inherit'

    def _group_level(per_group: dict, action: str) -> str:
        try:
            if not isinstance(per_group, dict):
                return 'none'
            if int(per_group.get(f"{action}_all", 0) or 0) == 1:
                return 'all'
            if int(per_group.get(f"{action}_group", 0) or 0) == 1:
                return 'group'
            if int(per_group.get(f"{action}_own", 0) or 0) == 1:
                return 'own'
            return 'none'
        except Exception:
            return 'none'

    def compute_effective_permissions(perms: dict, user_id: int, group_id: int) -> dict:
        """Compute effective rights for a (user, group) against provided perms dict.
        Rules:
          - If user axis is 'none' → deny (priority ban over group).
          - If user axis is 'inherit' or any other value → take group level as effective.
        Returns dict: {action: level} with level in {'none','own','group','all'} for actions view/edit/delete.
        """
        try:
            uid = str(user_id)
            gid = str(group_id)
            per_user = (perms or {}).get('user_by_id', {}).get(uid, {}) if isinstance(perms, dict) else {}
            per_group = (perms or {}).get('group_by_id', {}).get(gid, {}) if isinstance(perms, dict) else {}
            result = {}
            for action in ('view', 'edit', 'delete'):
                sel = _axis_selected(per_user, action)
                if sel == 'none':
                    eff = 'none'
                else:
                    eff = _group_level(per_group, action)
                result[action] = eff
            return result
        except Exception:
            return {'view': 'none', 'edit': 'none', 'delete': 'none'}

    # expose for reuse/tests
    globals()['compute_effective_permissions'] = compute_effective_permissions

    @app.route('/categories')
    @login_required
    @require_permissions(CATEGORIES_VIEW)
    def categories_admin():
        """Admin panel for managing categories and subcategories."""
        # Exclude system categories from admin list
        categories = [
            c for c in app._sql.category_all()
            if (getattr(c, 'folder_name', '') or '').lower() not in ('registrators', 'orders')
        ]
        subcategories = app._sql.subcategory_all()

        subcategories_by_category = {}
        for subcat in subcategories:
            if subcat.category_id not in subcategories_by_category:
                subcategories_by_category[subcat.category_id] = []
            subcategories_by_category[subcat.category_id].append(subcat)

        can_cats_manage = current_user.has(CATEGORIES_MANAGE)
        can_subs_manage = current_user.has(SUBCATEGORIES_MANAGE)

        return render_template(
            'categories.j2.html',
            title='Категории — Заявки-Наряды-Файлы',
            categories=categories,
            subcategories_by_category=subcategories_by_category,
            can_cats_manage=can_cats_manage,
            can_subs_manage=can_subs_manage)


# Removed legacy '/admin' fallback redirect.

    @app.route('/categories/add', methods=['POST'])
    @login_required
    @require_permissions(CATEGORIES_MANAGE)
    @rate_limit
    def category_add():
        """Добавить новую категорию."""
        try:
            log_action('CATEGORY_ADD_START', current_user.name,
                       'start add category', (request.remote_addr or ''))
            # Normalize display_name: trim and collapse internal spaces
            raw_display = request.form.get('display_name', '')
            display_name = ' '.join(raw_display.split())
            folder_name = (request.form.get('folder_name', '') or '').strip()
            # Validate folder_name by regex (letters, digits, dash, underscore only)
            # re already imported at top if needed; keep here if local scope required
            if folder_name and not re.fullmatch(r'[A-Za-z0-9_-]+',
                                                folder_name):
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Имя папки может содержать только латинские буквы, цифры, дефис и подчёркивание'
                    }), 400
                flash(
                    'Имя папки может содержать только латинские буквы, цифры, дефис и подчёркивание',
                    'error')
                return redirect(url_for('categories_admin'))
            display_order = int(request.form.get('display_order', 0))
            enabled = 1 if request.form.get('enabled') else 0

            if not display_name or not folder_name:
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Название и имя папки не могут быть пустыми'
                    }), 400
                flash('Название и имя папки не могут быть пустыми', 'error')
                return redirect(url_for('categories_admin'))

            # Case-insensitive uniqueness for display_name
            if app._sql.category_name_exists_ci([display_name]):
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Категория с таким названием уже существует'
                    }), 409
                flash(f'Категория с именем "{display_name}" уже существует',
                      'error')
                return redirect(url_for('categories_admin'))

            # Reserve system folder names and check uniqueness
            reserved = {'orders', 'requests', 'registrators'}
            if folder_name.lower() in reserved:
                if _wants_json_response():
                    return jsonify(
                        {'error': 'Системное имя папки зарезервировано'}), 409
                flash('Системное имя папки зарезервировано', 'error')
                return redirect(url_for('categories_admin'))
            # Check if folder name already exists
            if app._sql.category_exists([folder_name]):
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Категория с таким именем папки уже существует'
                    }), 409
                flash(
                    f'Категория с именем папки "{folder_name}" уже существует',
                    'error')
                return redirect(url_for('categories_admin'))

            new_id = app._sql.category_add(
                [display_name, folder_name, display_order, enabled])
            # Notify clients (files page, categories admin) to refresh
            try:
                _emit_categories_changed({
                    'reason': 'add',
                    'category_id': new_id
                })
            except Exception:
                pass
            # Create directory on disk
            try:
                os.makedirs(os.path.join(_files_root(), 'files', folder_name),
                            exist_ok=True)
            except Exception:
                pass
            if _wants_json_response():
                return jsonify({'success': True})
            flash(f'Категория "{display_name}" успешно добавлена', 'success')
            log_action('CATEGORY_ADD', current_user.name,
                       f'added category {display_name} ({folder_name})',
                       (request.remote_addr or ''))

        except Exception as e:
            _log.error(f"Error adding category: {e}")
            flash(f'Ошибка при добавлении категории: {e}', 'error')
            log_action('CATEGORY_ADD',
                       current_user.name,
                       f'failed add category: {str(e)}',
                       (request.remote_addr or ''),
                       success=False)

        return redirect(url_for('categories_admin'))

    @app.route('/categories/edit/<int:category_id>', methods=['POST'])
    @login_required
    @require_permissions(CATEGORIES_MANAGE)
    @rate_limit
    def category_edit(category_id):
        """Изменить категорию (имя папки неизменно)."""
        try:
            # Более конкретные логи для переключения enabled
            will_toggle = _wants_json_response(
            ) and 'enabled' in request.form and not (
                request.form.get('display_name'))
            if will_toggle:
                desired = 1 if request.form.get('enabled') else 0
                log_action(
                    'CATEGORY_TOGGLE_START', current_user.name,
                    f'category id={category_id} desired_enabled={desired}',
                    (request.remote_addr or ''))
            else:
                log_action('CATEGORY_EDIT_START', current_user.name,
                           f'start edit category id={category_id}',
                           (request.remote_addr or ''))
            # Лёгкий AJAX‑тоггл только enabled без остальных полей
            if _wants_json_response() and 'enabled' in request.form and not (
                    request.form.get('display_name')):
                existing = app._sql.category_by_id([category_id])
                if not existing:
                    return jsonify({'error': 'Категория не найдена'}), 404
                display_name = existing.display_name
                display_order = existing.display_order
                before_enabled = int(getattr(existing, 'enabled', 1))
                enabled = 1 if request.form.get('enabled') else 0
                app._sql.category_edit([
                    display_name, existing.folder_name, display_order, enabled,
                    category_id
                ])
                try:
                    _emit_categories_changed({
                        'reason': 'toggled',
                        'category_id': category_id,
                        'enabled': enabled
                    })
                except Exception:
                    pass
                # Log done with outcome
                try:
                    after = app._sql.category_by_id([category_id])
                    after_enabled = int(getattr(after, 'enabled',
                                                enabled)) if after else enabled
                    log_action(
                        'CATEGORY_TOGGLE_DONE', current_user.name,
                        f'category id={category_id} enabled {before_enabled}->${after_enabled}',
                        (request.remote_addr or ''))
                except Exception:
                    pass
                return jsonify({'success': True})
            # Normalize display_name: trim and collapse internal spaces
            raw_display = request.form.get('display_name', '')
            display_name = ' '.join(raw_display.split())
            display_order = int(request.form.get('display_order', 0))
            enabled = 1 if request.form.get('enabled') else 0
            # Enforce immutability of folder_name
            existing = app._sql.category_by_id([category_id])
            if not existing:
                if _wants_json_response():
                    return jsonify({'error': 'Категория не найдена'}), 404
                flash('Категория не найдена', 'error')
                return redirect(url_for('categories_admin'))

            if not display_name:
                if _wants_json_response():
                    return jsonify({'error':
                                    'Название не может быть пустым'}), 400
                flash('Название не может быть пустым', 'error')
                return redirect(url_for('categories_admin'))

            # Case-insensitive uniqueness for display_name excluding current
            if app._sql.category_name_exists_except_ci(
                [display_name, category_id]):
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Категория с таким названием уже существует'
                    }), 409
                flash(f'Категория с именем "{display_name}" уже существует',
                      'error')
                return redirect(url_for('categories_admin'))

            # Keep original folder_name unchanged
            # For system category 'registrators' deny disabling
            if (existing.folder_name
                    or '').lower() == 'registrators' and enabled == 0:
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Системную категорию "Регистраторы" нельзя отключать'
                    }), 409
                flash('Системную категорию "Регистраторы" нельзя отключать',
                      'error')
                return redirect(url_for('categories_admin'))
            # Разрешаем выключать категорию независимо от статуса подкатегорий
            app._sql.category_edit([
                display_name, existing.folder_name, display_order, enabled,
                category_id
            ])
            try:
                _emit_categories_changed({
                    'reason': 'edit',
                    'category_id': category_id
                })
            except Exception:
                pass
            if _wants_json_response():
                return jsonify({'success': True})
            flash(f'Категория "{display_name}" успешно обновлена', 'success')
            log_action(
                'CATEGORY_EDIT', current_user.name,
                f'edited category id={category_id} name={display_name} enabled={enabled}',
                (request.remote_addr or ''))

        except Exception as e:
            _log.error(f"Error editing category {category_id}: {e}")
            flash(f'Ошибка при обновлении категории: {e}', 'error')
            log_action('CATEGORY_EDIT',
                       current_user.name,
                       f'failed edit category id={category_id}: {str(e)}',
                       (request.remote_addr or ''),
                       success=False)

        return redirect(url_for('categories_admin'))

    @app.route('/categories/delete/<int:category_id>', methods=['POST'])
    @login_required
    @require_permissions(CATEGORIES_MANAGE)
    @rate_limit
    def category_delete(category_id):
        """Удалить категорию (если нет подкатегорий)."""
        try:
            log_action('CATEGORY_DELETE_START', current_user.name,
                       f'start delete category id={category_id}',
                       (request.remote_addr or ''))
            category = app._sql.category_by_id([category_id])
            if not category:
                log_action('CATEGORY_DELETE_BLOCKED',
                           current_user.name,
                           f'category id={category_id} not found',
                           (request.remote_addr or ''),
                           success=False)
                if _wants_json_response():
                    return jsonify({'error': 'Категория не найдена'}), 404
                flash('Категория не найдена', 'error')
                return redirect(url_for('categories_admin'))
            # For system category 'registrators' deny deletion
            if (category.folder_name or '').lower() == 'registrators':
                log_action('CATEGORY_DELETE_BLOCKED',
                           current_user.name,
                           f'system category id={category_id} registrators',
                           (request.remote_addr or ''),
                           success=False)
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Системную категорию "Регистраторы" нельзя удалять'
                    }), 409
                flash('Системную категорию "Регистраторы" нельзя удалять',
                      'error')
                return redirect(url_for('categories_admin'))
            # Prevent deletion if category has subcategories
            sub_cnt = app._sql.subcategory_count_by_category([category_id])
            if sub_cnt > 0:
                log_action(
                    'CATEGORY_DELETE_BLOCKED',
                    current_user.name,
                    f'category id={category_id} has {int(sub_cnt)} subcategories',
                    (request.remote_addr or ''),
                    success=False)
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Нельзя удалить категорию: есть подкатегории'
                    }), 409
                flash(
                    'Нельзя удалить категорию: в ней есть подкатегории. Сначала удалите или перенесите подкатегории.',
                    'error')
                return redirect(url_for('categories_admin'))

            app._sql.category_delete([category_id])
            try:
                _emit_categories_changed({
                    'reason': 'delete',
                    'category_id': category_id
                })
            except Exception:
                pass
            if _wants_json_response():
                log_action('CATEGORY_DELETE_DONE', current_user.name,
                           f'deleted category id={category_id}',
                           (request.remote_addr or ''))
                return jsonify({'success': True})
            flash(f'Категория "{category.display_name}" успешно удалена',
                  'success')
            log_action('CATEGORY_DELETE_DONE', current_user.name,
                       f'deleted category id={category_id}',
                       (request.remote_addr or ''))

        except Exception as e:
            _log.error(f"Error deleting category {category_id}: {e}")
            flash(f'Ошибка при удалении категории: {e}', 'error')
            log_action('CATEGORY_DELETE',
                       current_user.name,
                       f'failed delete category id={category_id}: {str(e)}',
                       (request.remote_addr or ''),
                       success=False)

        return redirect(url_for('categories_admin'))

    @app.route('/subcategories/add', methods=['POST'])
    @login_required
    @require_permissions(SUBCATEGORIES_MANAGE)
    @rate_limit
    def subcategory_add():
        """Добавить новую подкатегорию."""
        try:
            log_action('SUBCATEGORY_ADD_START', current_user.name,
                       'start add subcategory', (request.remote_addr or ''))
            category_id = int(request.form.get('category_id', 0))
            # Normalize display_name and validate folder_name
            raw_display = request.form.get('display_name', '')
            display_name = ' '.join(raw_display.split())
            folder_name = (request.form.get('folder_name', '') or '').strip()
            # re already imported at top if needed; keep here if local scope required
            if folder_name and not re.fullmatch(r'[A-Za-z0-9_-]+',
                                                folder_name):
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Имя папки может содержать только латинские буквы, цифры, дефис и подчёркивание'
                    }), 400
                flash(
                    'Имя папки может содержать только латинские буквы, цифры, дефис и подчёркивание',
                    'error')
                return redirect(url_for('categories_admin'))
            display_order = int(request.form.get('display_order', 0))
            enabled = 1 if request.form.get('enabled') else 0

            if not display_name or not folder_name or not category_id:
                if _wants_json_response():
                    return jsonify(
                        {'error': 'Все поля обязательны для заполнения'}), 400
                flash('Все поля обязательны для заполнения', 'error')
                return redirect(url_for('categories_admin'))

            # Check if subcategory already exists in this category
            if app._sql.subcategory_exists([category_id, folder_name]):
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Подкатегория с таким именем папки уже существует'
                    }), 409
                flash(
                    f'Подкатегория с именем папки "{folder_name}" уже существует в этой категории',
                    'error')
                return redirect(url_for('categories_admin'))

            # Permissions are not provided by the form anymore.
            # Default: no access for all (will be configured later in UI tables)
            # Order: user_view_own, user_view_group, user_view_all,
            #		user_edit_own, user_edit_group, user_edit_all,
            #		user_delete_own, user_delete_group, user_delete_all,
            #		group_view_own, group_view_group, group_view_all,
            #		group_edit_own, group_edit_group, group_edit_all,
            #		group_delete_own, group_delete_group, group_delete_all
            permissions = [0] * 18

            # Insert only core fields; permissions default to 0 in DB schema
            args = [
                category_id, display_name, folder_name, display_order, enabled
            ]
            new_id = app._sql.subcategory_add(args)
            try:
                _emit_categories_changed({
                    'reason': 'sub-add',
                    'subcategory_id': new_id,
                    'category_id': category_id
                })
            except Exception:
                pass
            # Create directory on disk
            try:
                cat = app._sql.category_by_id([category_id])
                os.makedirs(os.path.join(_files_root(), 'files',
                                         cat.folder_name, folder_name),
                            exist_ok=True)
            except Exception:
                pass
            if _wants_json_response():
                return jsonify({'success': True})
            flash(f'Подкатегория "{display_name}" успешно добавлена',
                  'success')
            log_action(
                'SUBCATEGORY_ADD', current_user.name,
                f'added subcategory {display_name} ({folder_name}) for category {category_id}',
                (request.remote_addr or ''))

        except Exception as e:
            _log.error(f"Error adding subcategory: {e}")
            flash(f'Ошибка при добавлении подкатегории: {e}', 'error')
            log_action('SUBCATEGORY_ADD',
                       current_user.name,
                       f'failed add subcategory: {str(e)}',
                       (request.remote_addr or ''),
                       success=False)

        return redirect(url_for('categories_admin'))

    @app.route('/subcategories/edit/<int:subcategory_id>', methods=['POST'])
    @login_required
    @require_permissions(SUBCATEGORIES_MANAGE)
    @rate_limit
    def subcategory_edit(subcategory_id):
        """Изменить подкатегорию (имя папки неизменно)."""
        try:
            # Более конкретные логи для переключения enabled
            will_toggle = _wants_json_response(
            ) and 'enabled' in request.form and not (
                request.form.get('display_name')
                or request.form.get('category_id'))
            if will_toggle:
                desired = 1 if request.form.get('enabled') else 0
                log_action(
                    'SUBCATEGORY_TOGGLE_START', current_user.name,
                    f'subcategory id={subcategory_id} desired_enabled={desired}',
                    (request.remote_addr or ''))
            else:
                log_action('SUBCATEGORY_EDIT_START', current_user.name,
                           f'start edit subcategory id={subcategory_id}',
                           (request.remote_addr or ''))
            # Лёгкий AJAX‑тоггл только enabled без остальных полей
            if _wants_json_response() and 'enabled' in request.form and not (
                    request.form.get('display_name')
                    or request.form.get('category_id')):
                existing = app._sql.subcategory_by_id([subcategory_id])
                if not existing:
                    return jsonify({'error': 'Подкатегория не найдена'}), 404
                category_id = existing.category_id
                display_name = existing.display_name
                folder_name = existing.folder_name
                display_order = existing.display_order
                enabled = 1 if request.form.get('enabled') else 0

                # Права оставляем как есть: извлекаем из объекта, если доступно
                def _extract_perms(perms_dict):
                    vals = []
                    for action in ['view', 'edit', 'delete']:
                        for scope in ['own', 'group', 'all']:
                            vals.append(1 if (
                                perms_dict.get(f'{action}_{scope}') in (
                                    1, True, '1')) else 0)
                    return vals

                try:
                    user_perms = existing.get_user_permissions()
                    group_perms = existing.get_group_permissions()
                except Exception:
                    user_perms = {
                        k: 0
                        for k in [
                            'view_own', 'view_group', 'view_all', 'edit_own',
                            'edit_group', 'edit_all', 'delete_own',
                            'delete_group', 'delete_all'
                        ]
                    }
                    group_perms = dict(user_perms)
                perms = _extract_perms(user_perms) + _extract_perms(
                    group_perms)
                # Include upload flags to satisfy SQL parameter list
                try:
                    user_upload = 1 if int(getattr(existing, 'user_upload',
                                                   0)) == 1 else 0
                except Exception:
                    user_upload = 0
                try:
                    group_upload = 1 if int(
                        getattr(existing, 'group_upload', 0)) == 1 else 0
                except Exception:
                    group_upload = 0
                args = [
                    category_id, display_name, folder_name, display_order,
                    enabled, subcategory_id
                ]
                before_enabled = int(getattr(existing, 'enabled', 1))
                app._sql.subcategory_edit(args)
                try:
                    _emit_categories_changed({
                        'reason': 'sub-toggled',
                        'subcategory_id': subcategory_id,
                        'category_id': category_id,
                        'enabled': enabled
                    })
                except Exception:
                    pass
                # Also emit explicit subcategories channel for clients listening there
                try:
                    _sock = socketio if socketio else getattr(app, 'socketio', None)
                    if _sock:
                        _sock.emit('subcategories:changed', {
                            'reason': 'sub-toggled',
                            'subcategory_id': subcategory_id,
                            'category_id': category_id,
                            'enabled': enabled,
                        })
                except Exception:
                    pass
                try:
                    after = app._sql.subcategory_by_id([subcategory_id])
                    after_enabled = int(getattr(after, 'enabled',
                                                desired)) if after else desired
                    log_action(
                        'SUBCATEGORY_TOGGLE_DONE', current_user.name,
                        f'subcategory id={subcategory_id} enabled {before_enabled}->${after_enabled}',
                        (request.remote_addr or ''))
                except Exception:
                    pass
                return jsonify({'success': True, 'enabled': after_enabled})
            category_id = int(request.form.get('category_id', 0))
            raw_display = request.form.get('display_name', '')
            display_name = ' '.join(raw_display.split())
            display_order = int(request.form.get('display_order', 0))
            enabled = 1 if request.form.get('enabled') else 0
            existing = app._sql.subcategory_by_id([subcategory_id])
            if not existing:
                if _wants_json_response():
                    return jsonify({'error': 'Подкатегория не найдена'}), 404
                flash('Подкатегория не найдена', 'error')
                return redirect(url_for('categories_admin'))

            # Use existing category_id if not provided in request
            if not category_id:
                category_id = existing.category_id

            if not display_name:
                if _wants_json_response():
                    return jsonify(
                        {'error': 'Все поля обязательны для заполнения'}), 400
                flash('Все поля обязательны для заполнения', 'error')
                return redirect(url_for('categories_admin'))

            # Keep original folder_name unchanged
            folder_name = existing.folder_name
            # Get permissions from form
            args = [
                category_id, display_name, folder_name, display_order, enabled,
                subcategory_id
            ]
            app._sql.subcategory_edit(args)
            try:
                _emit_categories_changed({
                    'reason': 'sub-edit',
                    'subcategory_id': subcategory_id,
                    'category_id': category_id
                })
            except Exception:
                pass
            try:
                _sock = socketio if socketio else getattr(app, 'socketio', None)
                if _sock:
                    _sock.emit('subcategories:changed', {
                        'reason': 'sub-edit',
                        'subcategory_id': subcategory_id,
                        'category_id': category_id,
                    })
            except Exception:
                pass
            if _wants_json_response():
                return jsonify({'success': True})
            flash(f'Подкатегория "{display_name}" успешно обновлена',
                  'success')
            log_action(
                'SUBCATEGORY_EDIT', current_user.name,
                f'edited subcategory id={subcategory_id} name={display_name} enabled={enabled}',
                (request.remote_addr or ''))

        except Exception as e:
            _log.error(f"Error editing subcategory {subcategory_id}: {e}")
            flash(f'Ошибка при обновлении подкатегории: {e}', 'error')
            log_action(
                'SUBCATEGORY_EDIT',
                current_user.name,
                f'failed edit subcategory id={subcategory_id}: {str(e)}',
                (request.remote_addr or ''),
                success=False)

        return redirect(url_for('categories_admin'))

    @app.route('/subcategories/delete/<int:subcategory_id>', methods=['POST'])
    @login_required
    @require_permissions(SUBCATEGORIES_MANAGE)
    @rate_limit
    def subcategory_delete(subcategory_id):
        """Удалить подкатегорию (если нет файлов)."""
        try:
            log_action('SUBCATEGORY_DELETE_START', current_user.name,
                       f'start delete subcategory id={subcategory_id}',
                       (request.remote_addr or ''))
            subcategory = app._sql.subcategory_by_id([subcategory_id])
            if not subcategory:
                if _wants_json_response():
                    return jsonify({'error': 'Подкатегория не найдена'}), 404
                flash('Подкатегория не найдена', 'error')
                return redirect(url_for('categories_admin'))
            # Prevent deletion if subcategory has files
            files_cnt = app._sql.files_count_in_subcategory([subcategory_id])
            if files_cnt > 0:
                if _wants_json_response():
                    return jsonify({
                        'error':
                        'Нельзя удалить подкатегорию: в ней есть файлы'
                    }), 409
                flash(
                    'Нельзя удалить подкатегорию: в ней есть файлы. Сначала удалите или перенесите файлы.',
                    'error')
                return redirect(url_for('categories_admin'))

            app._sql.subcategory_delete([subcategory_id])
            try:
                _emit_categories_changed({
                    'reason': 'sub-delete',
                    'subcategory_id': subcategory_id
                })
            except Exception:
                pass
            try:
                _sock = socketio if socketio else getattr(app, 'socketio', None)
                if _sock:
                    _sock.emit('subcategories:changed', {
                        'reason': 'sub-delete',
                        'subcategory_id': subcategory_id,
                    })
            except Exception:
                pass
            if _wants_json_response():
                return jsonify({'success': True})
            flash(f'Подкатегория "{subcategory.display_name}" успешно удалена',
                  'success')
            log_action('SUBCATEGORY_DELETE', current_user.name,
                       f'deleted subcategory id={subcategory_id}',
                       (request.remote_addr or ''))

        except Exception as e:
            _log.error(f"Error deleting subcategory {subcategory_id}: {e}")
            flash(f'Ошибка при удалении подкатегории: {e}', 'error')
            log_action(
                'SUBCATEGORY_DELETE',
                current_user.name,
                f'failed delete subcategory id={subcategory_id}: {str(e)}',
                (request.remote_addr or ''),
                success=False)

        return redirect(url_for('categories_admin'))

    @app.route('/api/categories')
    @login_required
    @require_permissions(CATEGORIES_VIEW)
    def api_categories():
        """API: список категорий (JSON)."""
        # Hide system categories from admin UI consumers
        categories = [
            c for c in app._sql.category_all()
            if (getattr(c, 'folder_name', '') or '').lower() not in ('registrators', 'orders')
        ]
        return jsonify([{
            'id': cat.id,
            'display_name': cat.display_name,
            'folder_name': cat.folder_name,
            'display_order': cat.display_order,
            'enabled': cat.enabled
        } for cat in categories])

    @app.route('/api/category/<int:category_id>/stats')
    @login_required
    @require_permissions(CATEGORIES_VIEW)
    def api_category_stats(category_id):
        """API: статистика по категории (кол-во подкатегорий)."""
        try:
            sub_cnt = app._sql.subcategory_count_by_category([category_id])
            return jsonify({'subcategory_count': int(sub_cnt)})
        except Exception as e:
            _log.error(f"category stats failed: {e}")
            return jsonify({'subcategory_count': 0}), 200

    @app.route('/api/subcategories/<int:category_id>')
    @login_required
    @require_permissions(SUBCATEGORIES_VIEW)
    def api_subcategories(category_id):
        """API: список подкатегорий категории (JSON)."""
        subcategories = app._sql.subcategory_by_category([category_id])
        items = []
        for subcat in subcategories:
            key = f"subcategory_permissions:{subcat.id}"
            try:
                raw = app._sql.setting_get(key)
                stored = loads(raw) if raw else {}
            except Exception:
                stored = {}
            perms = {
                'user': stored.get('user') if isinstance(stored, dict) and isinstance(stored.get('user'), dict) else {},
                'group': stored.get('group') if isinstance(stored, dict) and isinstance(stored.get('group'), dict) else {},
            }
            perms = enforce_admin_access_permissions(perms)
            items.append({
                'id': subcat.id,
                'category_id': subcat.category_id,
                'display_name': subcat.display_name,
                'folder_name': subcat.folder_name,
                'display_order': subcat.display_order,
                'enabled': subcat.enabled,
                'permissions': perms,
            })
        return jsonify(items)

    @app.route('/api/groups')
    @login_required
    @require_permissions(SUBCATEGORIES_VIEW)
    def api_groups():
        """API: список групп с пагинацией и поиском.

		Query params:
		  - page: 1-based page number (default 1)
		  - page_size: items per page (default 5)
		  - q: optional search query (case-insensitive in name/description)
		"""
        try:
            page = max(1, int(request.args.get('page', 1)))
            page_size = max(1, min(100, int(request.args.get('page_size', 5))))
        except Exception:
            page, page_size = 1, 5
        query = (request.args.get('q') or '').strip()
        offset = (page - 1) * page_size
        prefix = app._sql.config['db']['prefix']
        params = []
        where = ''
        if query:
            where = 'WHERE LOWER(name) LIKE LOWER(%s) OR LOWER(COALESCE(description, "")) LIKE LOWER(%s)'
            like = f"%{query}%"
            params.extend([like, like])
        total_row = app._sql.execute_scalar(
            f"SELECT COUNT(1) FROM {prefix}_group {where};", params)
        total = int(total_row[0]) if total_row else 0
        data = app._sql.execute_query(
            f"SELECT id, name, description FROM {prefix}_group {where} ORDER BY name LIMIT %s OFFSET %s;",
            params + [page_size, offset])
        total_pages = max(1, (total + page_size - 1) // page_size)
        return jsonify({
            'items': [{
                'id': d[0],
                'name': d[1],
                'description': d[2]
            } for d in data],
            'page':
            page,
            'page_size':
            page_size,
            'total':
            total,
            'total_pages':
            total_pages
        })

    @app.route('/api/users')
    @login_required
    @require_permissions(SUBCATEGORIES_VIEW)
    def api_users():
        """API: список пользователей с пагинацией и поиском.

		Query params:
		  - page: 1-based page number (default 1)
		  - page_size: items per page (default 5)
		  - q: optional search query (case-insensitive in login/name)
		"""
        try:
            page = max(1, int(request.args.get('page', 1)))
            page_size = max(1, min(100, int(request.args.get('page_size', 5))))
        except Exception:
            page, page_size = 1, 5
        query = (request.args.get('q') or '').strip()
        offset = (page - 1) * page_size
        prefix = app._sql.config['db']['prefix']
        params = []
        where = ''
        if query:
            where = 'WHERE LOWER(login) LIKE LOWER(%s) OR LOWER(name) LIKE LOWER(%s)'
            like = f"%{query}%"
            params.extend([like, like])
        total_row = app._sql.execute_scalar(
            f"SELECT COUNT(1) FROM {prefix}_user {where};", params)
        total = int(total_row[0]) if total_row else 0
        rows = app._sql.execute_query(
            f"SELECT id, login, name, enabled, permission, gid FROM {prefix}_user {where} ORDER BY name LIMIT %s OFFSET %s;",
            params + [page_size, offset])
        total_pages = max(1, (total + page_size - 1) // page_size)
        return jsonify({
            'items': [{
                'id': r[0],
                'login': r[1],
                'name': r[2],
                'enabled': r[3],
                'permission': r[4],
                'gid': r[5],
            } for r in rows],
            'page':
            page,
            'page_size':
            page_size,
            'total':
            total,
            'total_pages':
            total_pages
        })

    @app.route('/api/subcategory/<int:subcategory_id>/permissions')
    @login_required
    @require_permissions(SUBCATEGORIES_VIEW)
    def api_subcategory_permissions(subcategory_id):
        """API: получить права подкатегории (JSON)."""
        try:
            subcategory = app._sql.subcategory_by_id([subcategory_id])
        except Exception:
            subcategory = app._sql.subcategory_basic_by_id([subcategory_id])
        if not subcategory:
            return jsonify({'error': 'Subcategory not found'}), 404
        key = f"subcategory_permissions:{subcategory_id}"
        val = app._sql.setting_get(key)
        try:
            stored = loads(val) if val else {}
        except Exception:
            stored = {}
        perms = {
            'user': stored.get('user') if isinstance(stored, dict) and isinstance(stored.get('user'), dict) else {},
            'group': stored.get('group') if isinstance(stored, dict) and isinstance(stored.get('group'), dict) else {},
            # Optional per-user and per-group matrices for granular overrides
            'user_by_id': stored.get('user_by_id') if isinstance(stored, dict) and isinstance(stored.get('user_by_id'), dict) else {},
            'group_by_id': stored.get('group_by_id') if isinstance(stored, dict) and isinstance(stored.get('group_by_id'), dict) else {},
        }
        perms = enforce_admin_access_permissions(perms)
        return jsonify({'id': subcategory.id, 'display_name': subcategory.display_name, 'permissions': perms})

    @app.route('/api/subcategory/<int:subcategory_id>/stats')
    @login_required
    @require_permissions(SUBCATEGORIES_VIEW)
    def api_subcategory_stats(subcategory_id):
        """API: статистика по подкатегории (кол-во файлов по префиксу пути)."""
        try:
            files_cnt = app._sql.files_count_in_subcategory([subcategory_id])
            return jsonify({'files_count': int(files_cnt)})
        except Exception as e:
            _log.error(f"subcategory stats failed: {e}")
            return jsonify({'files_count': 0}), 200

    @app.route('/api/subcategory/<int:subcategory_id>/permissions',
               methods=['POST'])
    @login_required
    @require_permissions(SUBCATEGORIES_MANAGE)
    def api_update_subcategory_permissions(subcategory_id):
        """API: обновить права подкатегории (JSON)."""
        try:
            data = request.get_json(silent=True) or {}
            incoming = data.get('permissions') or {}
            # Ensure subcategory exists
            sub = app._sql.subcategory_by_id([subcategory_id])
            if not sub:
                return jsonify({'error': 'Subcategory not found'}), 404

            key = f"subcategory_permissions:{subcategory_id}"
            existing_raw = app._sql.setting_get(key)
            try:
                existing = loads(existing_raw) if existing_raw else {}
            except Exception:
                existing = {}
            existing_user = existing.get('user') if isinstance(existing, dict) and isinstance(existing.get('user'), dict) else {}
            existing_group = existing.get('group') if isinstance(existing, dict) and isinstance(existing.get('group'), dict) else {}
            existing_user_by_id = existing.get('user_by_id') if isinstance(existing, dict) and isinstance(existing.get('user_by_id'), dict) else {}
            existing_group_by_id = existing.get('group_by_id') if isinstance(existing, dict) and isinstance(existing.get('group_by_id'), dict) else {}

            # Merge partial payloads (either group, user, or user_by_id).
            final_user = existing_user
            final_group = existing_group
            final_user_by_id = existing_user_by_id
            final_group_by_id = existing_group_by_id
            if isinstance(incoming.get('user'), dict):
                final_user = incoming.get('user')
            if isinstance(incoming.get('group'), dict):
                final_group = incoming.get('group')
            if isinstance(incoming.get('user_by_id'), dict):
                # Shallow merge per-user maps
                upd = incoming.get('user_by_id') or {}
                for uid, matrix in upd.items():
                    try:
                        if not isinstance(matrix, dict):
                            continue
                        base = final_user_by_id.get(str(uid), {}) if isinstance(final_user_by_id.get(str(uid)), dict) else {}
                        base.update({k: 1 if (v in (1, '1', True)) else 0 for k, v in matrix.items()})
                        final_user_by_id[str(uid)] = base
                    except Exception:
                        continue
            if isinstance(incoming.get('group_by_id'), dict):
                # Shallow merge per-group maps
                gupd = incoming.get('group_by_id') or {}
                for gid, gmatrix in gupd.items():
                    try:
                        if not isinstance(gmatrix, dict):
                            continue
                        gbase = final_group_by_id.get(str(gid), {}) if isinstance(final_group_by_id.get(str(gid)), dict) else {}
                        gbase.update({k: 1 if (v in (1, '1', True)) else 0 for k, v in gmatrix.items()})
                        final_group_by_id[str(gid)] = gbase
                    except Exception:
                        continue
            perms = {
                'user': final_user or {},
                'group': final_group or {},
                'user_by_id': final_user_by_id or {},
                'group_by_id': final_group_by_id or {},
            }
            perms = enforce_admin_access_permissions(perms)
            app._sql.setting_set(key, dumps(perms, ensure_ascii=False))

            log_action('SUBCATEGORY_PERMISSIONS_UPDATE', current_user.name,
                       f'updated permissions for subcategory id={subcategory_id}',
                       (request.remote_addr or ''))
            try:
                if socketio:
                    socketio.emit('subcategory_permissions_updated', {'subcategory_id': subcategory_id})
                    # Soft refresh files for clients affected by permission changes
                    try:
                        socketio.emit('files:changed', {
                            'reason': 'subcategory-permissions',
                            'subcategory_id': subcategory_id
                        })
                    except Exception:
                        pass
            except Exception:
                pass
            return jsonify({'status': 'success'})
        except Exception as e:
            _log.error(f"Error updating subcategory permissions: {e}")
            return jsonify({'error': str(e)}), 500
