"""User management routes: list, add, edit, reset, toggle, delete.

All routes enforce permissions via `require_permissions`. Admin user (`login == 'admin'`)
is protected from modifications except password reset.
"""

from flask import render_template, url_for, request, redirect, jsonify, make_response
from flask_login import login_user, logout_user, current_user
from modules.logging import get_logger, log_action
from modules.sync_manager import emit_users_changed
from modules.permissions import require_permissions, USERS_VIEW_PAGE, USERS_MANAGE
from flask_socketio import join_room
import time
from functools import wraps

_log = get_logger(__name__)


def register(app):
    # Get rate limiter from app
    # Socket.IO room join for users page
    if hasattr(app, 'socketio') and app.socketio:

        @app.socketio.on('users:join')
        def _users_join(_data=None):
            try:
                join_room('users')
            except Exception as e:
                _log.error(f"[users] Error joining users room: {e}")

    rate_limit = app.rate_limiters.get(
        'users',
        app.rate_limiters.get('default', lambda *args, **kwargs: lambda f: f))

    @app.route('/users', methods=['GET'])
    @require_permissions(USERS_VIEW_PAGE)
    def users():
        """Render users page with list and groups (server-paginated)."""
        # Support both ConfigParser and dict-like config
        from configparser import ConfigParser
        cfg = getattr(app._sql, 'config', {})
        if isinstance(cfg, ConfigParser):
            min_password_length = int(
                cfg.get('web', 'min_password_length', fallback='1'))
        else:
            min_password_length = int(
                str(cfg.get('web', {}).get('min_password_length', '1')))
        # Server-side pagination parameters
        try:
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 10))
            if page < 1:
                page = 1
            if page_size < 1:
                page_size = 10
        except Exception:
            page, page_size = 1, 10

        users_all = app._sql.user_all() or []
        # Sort by first three columns alphabetically: Login, Name, Group
        try:
            group_map = app._sql.group_all() or {}

            def sort_key(u):
                login = (getattr(u, 'login', '') or '').upper()
                name = (getattr(u, 'name', '') or '').upper()
                groupname = (group_map.get(getattr(u, 'gid', None))
                             or '').upper()
                return (login, name, groupname)

            users_all.sort(key=sort_key)
        except Exception:
            pass
        total = len(users_all)
        start = (page - 1) * page_size
        end = start + page_size
        users_slice = users_all[start:end]

        # Build pager HTML with explicit page params
        try:
            total_pages = max(1, (total + page_size - 1) // page_size)
            def page_item(p, label=None, active=False, disabled=False):
                lab = label if label is not None else str(p)
                cls = "page-item{}{}".format(" active" if active else "", " disabled" if disabled else "")
                href = url_for('users', page=p, page_size=page_size)
                return f'<li class="{cls}"><a class="page-link" href="{href}" data-page="{p}">{lab}</a></li>'
            parts = []
            parts.append('<ul class="pagination mb-0">')
            parts.append(page_item(1, '⏮', False, page <= 1))
            parts.append(page_item(max(1, page - 1), '‹', False, page <= 1))
            start_p = max(1, page - 3)
            end_p = min(total_pages, page + 3)
            for p in range(start_p, end_p + 1):
                parts.append(page_item(p, str(p), p == page, False))
            parts.append(page_item(min(total_pages, page + 1), '›', False, page >= total_pages))
            parts.append(page_item(total_pages, '⏭', False, page >= total_pages))
            parts.append('</ul>')
            pager_html = ''.join(parts)
        except Exception:
            pager_html = ''

        return render_template('users.j2.html',
                               title='Пользователи — Заявки-Наряды-Файлы',
                               id=4,
                               users=users_slice,
                               groups=app._sql.group_all(),
                               min_password_length=min_password_length,
                               pager_html=pager_html,
                               page=page,
                               page_size=page_size,
                               total=total)

    @app.route('/users/page')
    @require_permissions(USERS_VIEW_PAGE)
    def users_page():
        """Return a page of users rows as HTML (tbody content) with pagination meta."""
        try:
            # If a direct browser navigation lands here (e.g., after login redirect),
            # serve the full page instead of JSON snippet.
            accept = (request.headers.get('Accept') or '')
            is_ajax = (
                request.headers.get('X-Requested-With') == 'XMLHttpRequest')
            if ('text/html' in accept) and (not is_ajax):
                return redirect(url_for('users'))
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 10))
            if page < 1: page = 1
            if page_size < 1: page_size = 10
            users = app._sql.user_all() or []
            # Sort by first three columns alphabetically: Login, Name, Group
            try:
                group_map = app._sql.group_all() or {}

                def sort_key(u):
                    login = (getattr(u, 'login', '') or '').upper()
                    name = (getattr(u, 'name', '') or '').upper()
                    groupname = (group_map.get(getattr(u, 'gid', None))
                                 or '').upper()
                    return (login, name, groupname)

                users.sort(key=sort_key)
            except Exception:
                pass
            total = len(users)
            start = (page - 1) * page_size
            end = start + page_size
            users_slice = users[start:end]
            html = render_template('components/users_rows.j2.html',
                                   users=users_slice,
                                   groups=app._sql.group_all())
            # Build server-side pagination HTML with explicit page params
            try:
                total_pages = max(1, (total + page_size - 1) // page_size)
                def page_item(p, label=None, active=False, disabled=False):
                    lab = label if label is not None else str(p)
                    cls = "page-item{}{}".format(" active" if active else "", " disabled" if disabled else "")
                    href = url_for('users', page=p, page_size=page_size)
                    return f'<li class="{cls}"><a class="page-link" href="{href}" data-page="{p}">{lab}</a></li>'
                parts = []
                parts.append('<ul class="pagination mb-0">')
                parts.append(page_item(1, '⏮', False, page <= 1))
                parts.append(page_item(max(1, page - 1), '‹', False, page <= 1))
                start_p = max(1, page - 3)
                end_p = min(total_pages, page + 3)
                for p in range(start_p, end_p + 1):
                    parts.append(page_item(p, str(p), p == page, False))
                parts.append(page_item(min(total_pages, page + 1), '›', False, page >= total_pages))
                parts.append(page_item(total_pages, '⏭', False, page >= total_pages))
                parts.append('</ul>')
                pager_html = ''.join(parts)
            except Exception:
                pager_html = ''
            resp = make_response(
                jsonify({
                    'html': html,
                    'total': total,
                    'page': page,
                    'page_size': page_size,
                    'pager_html': pager_html
                }))
            resp.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp
        except Exception as e:
            return jsonify({'error': str(e)}), 400

    @app.route('/users/search')
    @require_permissions(USERS_VIEW_PAGE)
    def users_search():
        """Global search across users; server-paginated."""
        try:
            q = (request.args.get('q') or '').strip()
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 10))
            if page < 1: page = 1
            if page_size < 1: page_size = 10
            users = app._sql.user_all() or []
            # Sort by first three columns alphabetically: Login, Name, Group
            try:
                group_map = app._sql.group_all() or {}

                def sort_key(u):
                    login = (getattr(u, 'login', '') or '').upper()
                    name = (getattr(u, 'name', '') or '').upper()
                    groupname = (group_map.get(getattr(u, 'gid', None))
                                 or '').upper()
                    return (login, name, groupname)

                users.sort(key=sort_key)
            except Exception:
                pass
            if q:
                # Search only by first three columns: Login, Name, Group
                q_up = q.upper()
                group_map_cached = app._sql.group_all() or {}

                def row_text_first_three(u):
                    login = getattr(u, 'login', '') or ''
                    name = getattr(u, 'name', '') or ''
                    groupname = (group_map_cached.get(getattr(u, 'gid', None))
                                 or '')
                    return (f"{login}\n{name}\n{groupname}").upper()

                users = [u for u in users if q_up in row_text_first_three(u)]
            total = len(users)
            start = (page - 1) * page_size
            end = start + page_size
            users_slice = users[start:end]
            html = render_template('components/users_rows.j2.html',
                                   users=users_slice,
                                   groups=app._sql.group_all())
            resp = make_response(
                jsonify({
                    'html': html,
                    'total': total,
                    'page': page,
                    'page_size': page_size
                }))
            resp.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp
        except Exception as e:
            return jsonify({'error': str(e)}), 400

    # Helper: resolve group field (id or name) to numeric gid
    def _resolve_gid(raw_group_value: str) -> int:
        """Resolve group form value (id or name) to an existing numeric gid.

        Fallback strategy:
        - If input empty or invalid, pick the first existing group id (sorted ascending)
        - If numeric provided but not present in DB, also fallback to first existing
        - If name provided, case-insensitive match against existing; if no match, fallback
        This avoids FK errors when group 2 doesn't exist.
        """
        try:
            group_map = app._sql.group_all() or {}
            existing_ids = sorted([int(gid) for gid in group_map.keys()]) if group_map else []
            default_gid = existing_ids[0] if existing_ids else 1

            gv = (raw_group_value or '').strip()
            if gv == '':
                return default_gid
            # Try parse as int id first
            try:
                gid_int = int(gv)
                return gid_int if gid_int in existing_ids else default_gid
            except Exception:
                pass
            # Fallback: lookup by case-insensitive name
            for gid, gname in group_map.items():
                try:
                    if str(gname).strip().lower() == gv.lower():
                        return int(gid)
                except Exception:
                    continue
            # If not found, fallback to first existing id
            return default_gid
        except Exception:
            return 1

    @app.route('/users/add', methods=['POST'])
    @require_permissions(USERS_MANAGE)
    @rate_limit
    def users_add():
        """Create a new user. Login uniqueness is case-insensitive.

		Blocks creating `admin` account via UI.
		"""
        # Block creating admin user via UI
        if (request.form.get('login') or '').strip().lower() == 'admin':
            app.flash_error(
                'Невозможно создать или переименовать пользователя admin через интерфейс'
            )
            # Preserve page in redirect when available
            try:
                page = request.args.get('page', type=int)
                page_size = request.args.get('page_size', type=int)
                if page or page_size:
                    return redirect(url_for('users', page=page, page_size=page_size))
            except Exception:
                pass
            return redirect(url_for('users'))
        ok = True
        error_message = ''
        try:
            # Server-side validation with trimming (fallback to existing when missing)
            name = (request.form.get('name') or '').strip()
            login = (request.form.get('login') or '').strip()
            if (not name) and user and getattr(user, 'name', None):
                name = str(user.name).strip()
            if (not login) and user and getattr(user, 'login', None):
                login = str(user.login).strip()
            password = request.form.get('password') or ''

            # Validate required fields
            if not name:
                raise Exception('Имя не может быть пустым')
            if not login:
                raise Exception('Логин не может быть пустым')
            if not password:
                raise Exception('Пароль не может быть пустым')

            # Get minimum password length from config
            # Read min password length from config (ConfigParser or dict)
            cfg = getattr(app._sql, 'config', {})
            try:
                from configparser import ConfigParser
            except Exception:
                ConfigParser = None
            if ConfigParser and isinstance(cfg, ConfigParser):
                min_password_length = int(
                    cfg.get('web', 'min_password_length', fallback='1'))
            else:
                try:
                    min_password_length = int(
                        str(
                            cfg.get('web', {}).get('min_password_length',
                                                   '1')))
                except Exception:
                    min_password_length = 1
            if len(password) < min_password_length:
                raise Exception(
                    f'Пароль должен быть не менее {min_password_length} символов'
                )

            # Case-insensitive uniqueness check (login or name)
            if app._sql.user_exists(login, name):
                raise Exception('Пользователь уже существует!')

            # Use permission string as provided
            perm_value = (request.form.get('permission') or '').strip()
            gid_value = _resolve_gid(request.form.get('group'))
            app._sql.user_add([
                login, name,
                app.hash(password), gid_value,
                int(request.form.get('enabled') != None), perm_value
            ])
            log_action('USER_CREATE', current_user.name,
                       f'created user {name} ({login})', request.remote_addr)
        except Exception as e:
            ok = False
            error_message = str(e)
            app.flash_error(e)
            log_action('USER_CREATE',
                       current_user.name,
                       f'failed to create user {name}: {str(e)}',
                       request.remote_addr,
                       success=False)
        finally:
            # notify sockets for soft refresh (via sync manager)
            try:
                origin = (request.headers.get('X-Client-Id') or '').strip()
                emit_users_changed(app.socketio,
                                   'created',
                                   originClientId=origin)
            except Exception:
                pass
            # Return JSON for AJAX/fetch requests, redirect for traditional forms
            xrq = (request.headers.get('X-Requested-With') or '').lower()
            is_ajax = xrq in ('xmlhttprequest', 'fetch') or \
                (request.headers.get('Content-Type') == 'application/json')
            if is_ajax:
                if ok:
                    return {
                        'status': 'success',
                        'message': 'User created successfully'
                    }, 200
                else:
                    return {
                        'status': 'error',
                        'message': error_message or 'Failed to create user'
                    }, 400
            try:
                page = request.args.get('page', type=int)
                page_size = request.args.get('page_size', type=int)
                if page or page_size:
                    return redirect(url_for('users', page=page, page_size=page_size))
            except Exception:
                pass
            return redirect(url_for('users'))

    @app.route('/users/edit/<id>', methods=['POST'])
    @require_permissions(USERS_MANAGE)
    @rate_limit
    def users_edit(id):
        """Edit user fields and permissions (except admin restrictions)."""
        # Disallow editing admin except password reset
        user = app._sql.user_by_id([id])
        if user and user.login and user.login.strip().lower() == 'admin':
            app.flash_error('Разрешено только изменение пароля администратора')
            try:
                page = request.args.get('page', type=int)
                page_size = request.args.get('page_size', type=int)
                if page or page_size:
                    return redirect(url_for('users', page=page, page_size=page_size))
            except Exception:
                pass
            return redirect(url_for('users'))
        ok = True
        error_message = ''
        try:
            # Server-side validation with trimming
            name = (request.form.get('name') or '').strip()
            login = (request.form.get('login') or '').strip()
            # Preserve existing permission if not provided by form (permissions edited in separate modal)
            incoming_perm = (request.form.get('permission') or '').strip()
            permission_value = incoming_perm if incoming_perm != '' else (
                user.permission if user
                and getattr(user, 'permission', None) is not None else '')
            # Normalize permission to string for DB layer
            if isinstance(permission_value, list):
                try:
                    permission_value = ','.join(permission_value)
                except Exception:
                    permission_value = ''

            # Normalize only if 'z' is present anywhere in the legacy string
            try:
                parts = (permission_value or '').split(',')
                while len(parts) < 4:
                    parts.append('')
                is_z = any(('z' in (seg or '')) for seg in parts)
                if is_z:
                    # Use 7-segment full-access string including extended Orders rights (status change, edit approved)
                    permission_value = 'aef,abcdefghlmn,abcdflm,ab,ab,ab,abcd'
            except Exception:
                pass

            # Validate required fields (after fallback)
            if not name:
                raise Exception('Имя не может быть пустым')
            if not login:
                raise Exception('Логин не может быть пустым')

            # Case-insensitive uniqueness: only when login or name actually changed
            try:
                orig_login = (user.login or '').strip() if user else ''
                orig_name = (user.name or '').strip() if user else ''
                changed_login = (login.strip().lower() != orig_login.strip().lower())
                changed_name = (name.strip().lower() != orig_name.strip().lower())
            except Exception:
                changed_login = True
                changed_name = True
            if changed_login or changed_name:
                if app._sql.user_exists(login, name, id):
                    raise Exception('Имя или логин занято другим пользователем!')

            # Resolve group: keep existing when field is missing or empty
            raw_group = request.form.get('group')
            if (raw_group is None) or (str(raw_group).strip() == ''):
                gid_value = int(user.gid) if user and getattr(user, 'gid', None) is not None else _resolve_gid(None)
            else:
                gid_value = _resolve_gid(raw_group)
            app._sql.user_edit([
                login, name, gid_value,
                int(request.form.get('enabled') != None), permission_value, id
            ])
            log_action('USER_EDIT', current_user.name,
                       f'edited user {name} ({login})', request.remote_addr)
        except Exception as e:
            ok = False
            error_message = str(e)
            app.flash_error(e)
            log_action('USER_EDIT',
                       current_user.name,
                       f'failed to edit user {name}: {str(e)}',
                       request.remote_addr,
                       success=False)
        finally:
            try:
                origin = (request.headers.get('X-Client-Id') or '').strip()
                emit_users_changed(app.socketio,
                                   'edited',
                                   id=id,
                                   originClientId=origin)
            except Exception:
                pass
            # Return JSON for AJAX/fetch requests, redirect for traditional forms
            xrq = (request.headers.get('X-Requested-With') or '').lower()
            is_ajax = xrq in ('xmlhttprequest', 'fetch') or \
                (request.headers.get('Content-Type') == 'application/json')
            if is_ajax:
                if ok:
                    return {
                        'status': 'success',
                        'message': 'User updated successfully'
                    }, 200
                else:
                    return {
                        'status': 'error',
                        'message': error_message or 'Failed to update user'
                    }, 400
            try:
                page = request.args.get('page', type=int)
                page_size = request.args.get('page_size', type=int)
                if page or page_size:
                    return redirect(url_for('users', page=page, page_size=page_size))
            except Exception:
                pass
            return redirect(url_for('users'))

    @app.route('/users/reset/<id>', methods=['POST'])
    @require_permissions(USERS_MANAGE)
    @rate_limit
    def users_reset(id):
        """Reset user password."""
        ok = True
        error_message = ''
        try:
            # Server-side validation with trimming
            password = (request.form.get('password') or '').strip()

            # Validate required fields
            if not password:
                raise Exception('Пароль не может быть пустым')

            # Get minimum password length from config
            # Read min password length from config (ConfigParser or dict)
            cfg = getattr(app._sql, 'config', {})
            try:
                from configparser import ConfigParser
            except Exception:
                ConfigParser = None
            if ConfigParser and isinstance(cfg, ConfigParser):
                min_password_length = int(
                    cfg.get('web', 'min_password_length', fallback='1'))
            else:
                try:
                    min_password_length = int(
                        str(
                            cfg.get('web', {}).get('min_password_length',
                                                   '1')))
                except Exception:
                    min_password_length = 1
            if len(password) < min_password_length:
                raise Exception(
                    f'Пароль должен быть не менее {min_password_length} символов'
                )

            user = app._sql.user_by_id([id])
            app._sql.user_reset([app.hash(password), id])
            log_action(
                'USER_RESET', current_user.name,
                f'reset password for {user.name if user else "id="+str(id)}',
                request.remote_addr)
        except Exception as e:
            ok = False
            error_message = str(e)
            app.flash_error(e)
            log_action('USER_RESET',
                       current_user.name,
                       f'failed to reset password for id={id}: {str(e)}',
                       request.remote_addr,
                       success=False)
        finally:
            try:
                origin = (request.headers.get('X-Client-Id') or '').strip()
                emit_users_changed(app.socketio,
                                   'reset',
                                   id=id,
                                   originClientId=origin)
            except Exception:
                pass
            # Return JSON for AJAX/fetch requests, redirect for traditional forms
            xrq = (request.headers.get('X-Requested-With') or '').lower()
            is_ajax = xrq in ('xmlhttprequest', 'fetch') or \
                (request.headers.get('Content-Type') == 'application/json')
            if is_ajax:
                if ok:
                    return {
                        'status': 'success',
                        'message': 'Password reset successfully'
                    }, 200
                else:
                    return {
                        'status': 'error',
                        'message': error_message or 'Failed to reset password'
                    }, 400
            return redirect(url_for('users'))

    @app.route('/users/toggle/<id>', methods=['POST'])
    @require_permissions(USERS_MANAGE)
    @rate_limit
    def users_toggle(id):
        """Toggle user active flag; admin cannot be disabled."""
        ok = True
        error_message = ''
        try:
            _log.debug(f"[users] toggle-entry id={id} origin={(request.headers.get('X-Client-Id') or '').strip()}")
            u = app._sql.user_by_id([id])
            if u and u.login and u.login.strip().lower() == 'admin':
                app.flash_error('Нельзя отключать администратора')
                log_action('USER_TOGGLE',
                           current_user.name,
                           'attempted to disable admin (blocked)',
                           request.remote_addr,
                           success=False)
                return redirect(url_for('users'))

            # Get enabled value from POST data
            enabled_value = request.form.get('enabled', '0')
            new_enabled = 1 if enabled_value == '1' else 0
            old_enabled = 1 if u and u.is_enabled() else 0

            app._sql.user_toggle([new_enabled, id])
            log_action(
                'USER_TOGGLE', current_user.name,
                f'toggled {u.name if u else "id="+str(id)} enabled {old_enabled}->{new_enabled}',
                request.remote_addr)
        except Exception as e:
            ok = False
            error_message = str(e)
            app.flash_error(e)
            log_action('USER_TOGGLE',
                       current_user.name,
                       f'failed to toggle id={id}: {str(e)}',
                       request.remote_addr,
                       success=False)
        finally:
            try:
                origin = (request.headers.get('X-Client-Id') or '').strip()
                # Emit general users:changed event
                emit_users_changed(app.socketio,
                                   'toggled',
                                   id=id,
                                   originClientId=origin)

                # Emit specific users:toggle event for toggle synchronization
                if app.socketio:
                    from modules.sync_manager import SyncManager
                    sync_manager = SyncManager(app.socketio)
                    toggle_data = {
                        'userId': id,
                        'enabled': new_enabled,
                        'clientId': origin
                    }
                    sync_manager.emit_to_room('users:toggle', toggle_data,
                                              'users', 'toggled')
                    _log.debug(f"[users] emit users:toggle: {toggle_data}")

                _log.debug(f"[users] toggle-exit id={id} origin={origin}")
            except Exception:
                pass
            # Return JSON for AJAX/fetch requests, redirect for traditional forms
            xrq = (request.headers.get('X-Requested-With') or '').lower()
            is_ajax = xrq in ('xmlhttprequest', 'fetch') or \
                (request.headers.get('Content-Type') == 'application/json')
            if is_ajax:
                if ok:
                    return {
                        'status': 'success',
                        'message': 'User status toggled successfully'
                    }, 200
                else:
                    return {
                        'status': 'error',
                        'message': error_message or 'Failed to toggle user'
                    }, 400
            return redirect(url_for('users'))

    @app.route('/users/delete/<id>', methods=['POST'])
    @require_permissions(USERS_MANAGE)
    @rate_limit
    def users_delete(id):
        """Delete a user; admin deletion is forbidden."""
        ok = True
        error_message = ''
        try:
            user = app._sql.user_by_id([id])
            if user and user.login and user.login.strip().lower() == 'admin':
                app.flash_error('Нельзя удалить администратора')
                return redirect(url_for('users'))
            app._sql.user_delete([id])
            log_action('USER_DELETE', current_user.name,
                       f'deleted user {user.name} ({user.login})',
                       request.remote_addr)
        except Exception as e:
            ok = False
            error_message = str(e)
            app.flash_error(e)
            log_action('USER_DELETE',
                       current_user.name,
                       f'failed to delete user: {str(e)}',
                       request.remote_addr,
                       success=False)
        finally:
            try:
                origin = (request.headers.get('X-Client-Id') or '').strip()
                emit_users_changed(app.socketio,
                                   'deleted',
                                   id=id,
                                   originClientId=origin)
            except Exception:
                pass
            # Return JSON for AJAX/fetch requests, redirect for traditional forms
            xrq = (request.headers.get('X-Requested-With') or '').lower()
            is_ajax = xrq in ('xmlhttprequest', 'fetch') or \
                (request.headers.get('Content-Type') == 'application/json')
            if is_ajax:
                if ok:
                    return {
                        'status': 'success',
                        'message': 'User deleted successfully'
                    }, 200
                else:
                    return {
                        'status': 'error',
                        'message': error_message or 'Failed to delete user'
                    }, 400
            return redirect(url_for('users'))
