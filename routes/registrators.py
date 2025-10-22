from flask import render_template, request, jsonify, Response
from flask_login import current_user
from modules.permissions import require_permissions, CATEGORIES_VIEW, CATEGORIES_MANAGE, ADMIN_ANY, FILES_UPLOAD
from modules.logging import get_logger, log_action
from modules.registrators import Registrator, parse_directory_listing
from modules.sync_manager import emit_registrators_changed
from datetime import datetime
from json import loads, dumps
from os import makedirs, path as ospath
from hashlib import md5
from urllib.request import urlopen
from subprocess import Popen, PIPE
import time
from functools import wraps
from flask_socketio import join_room
import re

_log = get_logger(__name__)


def register(app, socketio=None):
    # Socket.IO room join for registrators page
    try:
        if hasattr(app, 'socketio') and app.socketio:

            @app.socketio.on('registrators:join')
            def _registrators_join(_data=None):
                try:
                    join_room('registrators')
                except Exception:
                    pass
    except Exception:
        pass

    def _validate_url_placeholders(url_template: str):
        """Validate placeholders in URL template. Allow only a fixed set, but do not require any.

        Allowed placeholders (both {name} and <name> forms are accepted):
            date, user, time, type, file
        Returns (ok: bool, invalid: list[str])
        """
        try:
            allowed = {"date", "user", "time", "type", "file"}
            # Find {name}
            braces = re.findall(r"\{([^{}\s]+)\}", url_template or "")
            # Find <name>
            angles = re.findall(r"<([^<>\s]+)>", url_template or "")
            used = set([s.strip() for s in (braces + angles) if s.strip()])
            invalid = sorted([p for p in used if p not in allowed])
            return (len(invalid) == 0, invalid)
        except Exception:
            # On regex error, treat as valid to not block UI
            return (True, [])

    def _can_view_registrator(app, rid: int) -> bool:
        try:
            # Admin bypass
            is_auth_attr = getattr(current_user, 'is_authenticated', False)
            is_authenticated = bool(
                is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
            if not is_authenticated:
                return False
            if hasattr(current_user, 'has') and current_user.has(ADMIN_ANY):
                return True
            key = f"registrator_permissions:{rid}"
            val = app._sql.setting_get(key)
            data = loads(val) if val else {}
            uid = str(getattr(current_user, 'id', 0))
            gid = str(getattr(current_user, 'gid', 0))
            umap = (data.get('user') or {}) if isinstance(data, dict) else {}
            gmap = (data.get('group') or {}) if isinstance(data, dict) else {}

            # Check direct user permission
            if uid in umap and int(umap.get(uid) or 0) == 1:
                return True
            # Check group permission (cascade inheritance)
            if gid in gmap and int(gmap.get(gid) or 0) == 1:
                return True
        except Exception:
            pass
        return False

    # Ensure DB table for registrators exists with sane constraints
    try:
        app._sql.execute_non_query(
            f"""
			CREATE TABLE IF NOT EXISTS {app._sql.config['db']['prefix']}_registrator (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				url_template TEXT NOT NULL,
				enabled TINYINT(1) NOT NULL DEFAULT 1,
				display_order INT NOT NULL DEFAULT 0,
				UNIQUE KEY uniq_reg_name (name)
			);
			""", [])
    except Exception:
        pass
    # Simple in-memory rate limiter (IP+endpoint, sliding window)
    _RATE_BUCKET = {}

    def rate_limit(max_calls: int = 60, window_sec: int = 60):

        def decorator(fn):

            @wraps(fn)
            def wrapper(*args, **kwargs):
                try:
                    key = (request.remote_addr or 'unknown', fn.__name__)
                    now = time.time()
                    bucket = _RATE_BUCKET.get(key, [])
                    bucket = [t for t in bucket if now - t < window_sec]
                    if len(bucket) >= max_calls:
                        return jsonify({
                            'error':
                            'Слишком много запросов, попробуйте позже'
                        }), 429
                    bucket.append(now)
                    _RATE_BUCKET[key] = bucket
                except Exception:
                    pass
                return fn(*args, **kwargs)

            return wrapper

        return decorator

    # --- Registrators API ---
    @app.route('/api/registrators', methods=['GET'])
    @require_permissions(CATEGORIES_VIEW)
    def registrators_list():
        try:
            rows = app._sql.execute_query(
                f"SELECT id, name, url_template, enabled, display_order FROM {app._sql.config['db']['prefix']}_registrator ORDER BY display_order, name;",
                [])
            items = [{
                'id': r[0],
                'name': r[1],
                'url_template': r[2],
                'enabled': int(r[3]),
                'display_order': int(r[4] or 0)
            } for r in (rows or []) if r]
            return jsonify({'status': 'success', 'items': items})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/registrators/<int:rid>', methods=['GET'])
    @require_permissions(CATEGORIES_VIEW)
    def registrator_detail(rid):
        """Get individual registrator details."""
        try:
            row = app._sql.execute_scalar(
                f"SELECT id, name, url_template, enabled, display_order FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s LIMIT 1;",
                [rid])
            if not row:
                return jsonify({
                    'status': 'error',
                    'message': 'Registrator not found'
                }), 404

            item = {
                'id': row[0],
                'name': row[1],
                'url_template': row[2],
                'enabled': int(row[3]),
                'display_order': int(row[4] or 0)
            }
            return jsonify({'status': 'success', 'item': item})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/registrators', methods=['POST'])
    @require_permissions(CATEGORIES_MANAGE)
    def registrators_create():
        try:
            j = request.get_json(silent=True) or {}
            name = (j.get('name') or '').strip()
            url_template = (j.get('url_template') or '').strip()
            # optional display_order; if not provided, append to the end
            try:
                val = j.get('display_order')
                display_order = None if val is None else int(val)
            except Exception:
                display_order = None
            enabled = 1 if j.get('enabled') in (1, '1', True, 'true',
                                                'on') else 0
            # Server-side validation
            if not name or not url_template:
                return jsonify({
                    'status': 'error',
                    'message': 'name and url_template required'
                }), 400
            # Validate that only allowed placeholders are used (not required to include any)
            ok, invalid = _validate_url_placeholders(url_template)
            if not ok:
                return jsonify({
                    'status':
                    'error',
                    'message':
                    'Недопустимые плейсхолдеры: ' + ', '.join(invalid) +
                    '. Допустимые: {date}, {user}, {time}, {type}, {file}'
                }), 400
            # Reject duplicates
            try:
                row = app._sql.execute_scalar(
                    f"SELECT id FROM {app._sql.config['db']['prefix']}_registrator WHERE name=%s LIMIT 1;",
                    [name])
                if row:
                    return jsonify({
                        'status':
                        'error',
                        'message':
                        'Регистратор с таким именем уже существует'
                    }), 409
            except Exception:
                pass
            # compute next display_order if not provided
            if display_order is None:
                try:
                    next_do = app._sql.execute_scalar(
                        f"SELECT COALESCE(MAX(display_order), 0) + 1 FROM {app._sql.config['db']['prefix']}_registrator",
                        [])
                    display_order = int(next_do or 1)
                except Exception:
                    display_order = 1
            app._sql.execute_non_query(
                f"INSERT INTO {app._sql.config['db']['prefix']}_registrator (name, url_template, enabled, display_order) VALUES (%s, %s, %s, %s);",
                [name, url_template, enabled, display_order])
            # Log action
            log_action('REGISTRATOR_CREATE', current_user.login,
                       f'created registrator "{name}" enabled={enabled}',
                       request.remote_addr, True)
            # Emit change event for real-time sync
            emit_registrators_changed(socketio,
                                      'added',
                                      id=app._sql.execute_scalar(
                                          f"SELECT LAST_INSERT_ID()", []))
            return jsonify({'status': 'success'})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/registrators/<int:rid>', methods=['PUT'])
    @require_permissions(CATEGORIES_MANAGE)
    def registrators_update(rid):
        try:
            j = request.get_json(silent=True) or {}
            name = (j.get('name') or '').strip()
            url_template = (j.get('url_template') or '').strip()
            incoming_folder = (j.get('local_folder') or '').strip()
            enabled = 1 if j.get('enabled') in (1, '1', True, 'true',
                                                'on') else 0
            _log.info(
                f"[registrators] PUT update id={rid} name='{name}' enabled={enabled}"
            )
            # optional display_order update
            try:
                display_order = j.get('display_order')
                display_order = None if display_order is None else int(
                    display_order)
            except Exception:
                display_order = None
            # Load existing
            row = app._sql.execute_query(
                f"SELECT id, name, url_template, enabled FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s",
                [rid])
            if not row:
                return jsonify({
                    'status': 'error',
                    'message': 'not found'
                }), 404
            # Ignore incoming local_folder; no longer stored
            # Validate
            if not name or not url_template:
                return jsonify({
                    'status': 'error',
                    'message': 'name and url_template required'
                }), 400
            # Validate that only allowed placeholders are used (not required to include any)
            ok, invalid = _validate_url_placeholders(url_template)
            if not ok:
                return jsonify({
                    'status':
                    'error',
                    'message':
                    'Недопустимые плейсхолдеры: ' + ', '.join(invalid) +
                    '. Допустимые: {date}, {user}, {time}, {type}, {file}'
                }), 400
            # Uniqueness (excluding self)
            dup = app._sql.execute_scalar(
                f"SELECT id FROM {app._sql.config['db']['prefix']}_registrator WHERE (name=%s) AND id<>%s LIMIT 1;",
                [name, rid])
            if dup:
                return jsonify({
                    'status': 'error',
                    'message': 'Имя уже занято'
                }), 409
            if display_order is None:
                app._sql.execute_non_query(
                    f"UPDATE {app._sql.config['db']['prefix']}_registrator SET name=%s, url_template=%s, enabled=%s WHERE id=%s;",
                    [name, url_template, enabled, rid])
            else:
                app._sql.execute_non_query(
                    f"UPDATE {app._sql.config['db']['prefix']}_registrator SET name=%s, url_template=%s, enabled=%s, display_order=%s WHERE id=%s;",
                    [name, url_template, enabled, display_order, rid])
            # Log action
            log_action(
                'REGISTRATOR_UPDATE', current_user.login,
                f'updated registrator id={rid} name="{name}" enabled={enabled}',
                request.remote_addr, True)
            # Emit change event for real-time sync
            emit_registrators_changed(socketio, 'updated', id=rid)
            _log.info(f"[registrators] PUT success id={rid}")
            return jsonify({'status': 'success'})
        except Exception as e:
            _log.error(f"[registrators] PUT error id={rid}: {e}")
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/registrators/<int:rid>', methods=['DELETE'])
    @require_permissions(CATEGORIES_MANAGE)
    def registrators_delete(rid):
        try:
            # Resolve local folder
            # No local_folder anymore; allow delete without filesystem check
            row = app._sql.execute_query(
                f"SELECT id FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s",
                [rid])
            if not row:
                return jsonify({
                    'status': 'error',
                    'message': 'not found'
                }), 404
            # Previously we prevented delete if there were downloaded files per local_folder, but local_folder is removed
            app._sql.execute_non_query(
                f"DELETE FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s;",
                [rid])
            # Log action
            log_action('REGISTRATOR_DELETE', current_user.login,
                       f'deleted registrator id={rid}', request.remote_addr,
                       True)
            # Emit change event for real-time sync
            emit_registrators_changed(socketio, 'deleted', id=rid)
            return jsonify({'status': 'success'})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/registrators/<int:rid>/stats', methods=['GET'])
    @require_permissions(CATEGORIES_VIEW)
    def registrators_stats(rid):
        try:
            row = app._sql.execute_query(
                f"SELECT id FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s",
                [rid])
            if not row:
                return jsonify({
                    'status': 'error',
                    'message': 'not found'
                }), 404
            # No local folder — cannot compute files_count; return 0 as neutral value
            return jsonify({'status': 'success', 'files_count': 0})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Registrators permissions via settings storage ---
    def enforce_admin_access_permissions(perms):
        """Enforce admin and full-access users to have access to all registrators."""
        try:
            # Get admin group name
            admin_group_name = app.config.get('admin',
                                              {}).get('group', 'Программисты')

            # Get all groups and users
            groups = app._sql.execute_query(
                f"SELECT id, name FROM {app._sql.config['db']['prefix']}_group ORDER BY name;",
                []) or []

            users = app._sql.execute_query(
                f"SELECT id, login, permission, gid FROM {app._sql.config['db']['prefix']}_user ORDER BY login;",
                []) or []

            # Ensure permissions dict exists
            if not isinstance(perms, dict):
                perms = {}
            if 'group' not in perms:
                perms['group'] = {}
            if 'user' not in perms:
                perms['user'] = {}

            # Force admin group access
            for group_id, group_name in groups:
                if group_name.lower() == admin_group_name.lower():
                    perms['group'][str(group_id)] = 1

            # Force admin and full-access users access
            for user_id, login, permission, gid in users:
                force_access = False
                if login.lower() == 'admin':
                    force_access = True
                if permission:
                    perm_str = str(permission).strip()
                    if (perm_str == 'aef,a,abcdflm,ab,ab,ab,abcd'
                            or perm_str == 'aef,a,abcdflm,ab,ab,ab'
                            or 'z' in perm_str or 'полный доступ' in perm_str
                            or 'full access' in perm_str):
                        force_access = True
                if force_access:
                    perms['user'][str(user_id)] = 1

            # Apply cascade inheritance from groups to users
            perms = apply_group_cascade_permissions(perms, groups, users)

            return perms
        except Exception as e:
            app.flash_error(e)
            return perms

    def apply_group_cascade_permissions(perms, groups, users):
        """Apply cascade inheritance from groups to users for registrator permissions."""
        try:
            # Create group ID to name mapping
            group_map = {str(gid): name for gid, name in groups}

            # Create user ID to group ID mapping
            user_group_map = {
                str(uid): str(gid)
                for uid, login, permission, gid in users
            }

            # Apply cascade inheritance
            for user_id, login, permission, gid in users:
                user_id_str = str(user_id)
                gid_str = str(gid)

                # Check if user's group has permission
                if gid_str in perms.get('group',
                                        {}) and perms['group'][gid_str] == 1:
                    # User inherits permission from group
                    perms['user'][user_id_str] = 1
                # If group permission is removed, user permission is also removed
                elif gid_str in perms.get('group',
                                          {}) and perms['group'][gid_str] == 0:
                    # Only remove if user doesn't have explicit permission
                    if user_id_str not in perms.get('user', {}):
                        perms['user'][user_id_str] = 0

            return perms
        except Exception as e:
            app.flash_error(e)
            return perms

    # expose for tests
    globals(
    )['enforce_admin_access_permissions'] = enforce_admin_access_permissions

    @app.route('/registrators/<int:rid>/permissions', methods=['GET'])
    @require_permissions(CATEGORIES_VIEW)
    def registrators_permissions_get(rid):
        try:
            key = f"registrator_permissions:{rid}"
            val = app._sql.setting_get(key)
            try:
                stored = loads(val) if val else {}
            except Exception:
                stored = {}
            # Simplified view-only permissions: maps of id->0/1
            perms = {
                'user': stored.get('user') if isinstance(stored, dict)
                and isinstance(stored.get('user'), dict) else {},
                'group': stored.get('group') if isinstance(stored, dict)
                and isinstance(stored.get('group'), dict) else {},
            }
            # Enforce admin access
            perms = enforce_admin_access_permissions(perms)
            return jsonify({'status': 'success', 'permissions': perms})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/registrators/<int:rid>/permissions', methods=['POST'])
    @require_permissions(CATEGORIES_MANAGE)
    def registrators_permissions_set(rid):
        try:
            data = request.get_json(silent=True) or {}
            incoming = data.get('permissions') or {}
            # Load existing stored permissions to avoid overwriting missing sections
            key = f"registrator_permissions:{rid}"
            existing_raw = app._sql.setting_get(key)
            try:
                existing = loads(existing_raw) if existing_raw else {}
            except Exception:
                existing = {}

            existing_user = existing.get('user') if isinstance(
                existing, dict) and isinstance(existing.get('user'),
                                               dict) else {}
            existing_group = existing.get('group') if isinstance(
                existing, dict) and isinstance(existing.get('group'),
                                               dict) else {}

            final_user = incoming.get('user') if isinstance(
                incoming.get('user'), dict) else existing_user
            final_group = incoming.get('group') if isinstance(
                incoming.get('group'), dict) else existing_group

            perms = {
                'user': final_user or {},
                'group': final_group or {},
            }
            # Enforce admin access before saving
            perms = enforce_admin_access_permissions(perms)
            app._sql.setting_set(key, dumps(perms, ensure_ascii=False))
            # Log action
            log_action('REGISTRATOR_PERMISSIONS_UPDATE', current_user.login,
                       f'updated permissions for registrator id={rid}',
                       request.remote_addr, True)
            # Emit both specific and general change events for real-time sync
            if socketio:
                socketio.emit('registrator_permissions_updated',
                              {'registrator_id': rid})
                emit_registrators_changed(socketio,
                                          'permissions_updated',
                                          id=rid)
            return jsonify({'status': 'success'})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/registrators/<int:rid>/browse', methods=['GET'])
    @require_permissions(CATEGORIES_VIEW)
    def registrators_browse(rid):
        """Browse remote structure progressively: ?level=date|user|time|type and ?parent=..."""
        try:
            rows = app._sql.execute_query(
                f"SELECT id, name, url_template, enabled FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s;",
                [rid])
            if not rows:
                return jsonify({
                    'status': 'error',
                    'message': 'not found'
                }), 404
            name, url_template, enabled = rows[0][1], rows[0][2], int(
                rows[0][3])
            if not enabled:
                return jsonify({'status': 'error', 'message': 'disabled'}), 400
            level = (request.args.get('level') or 'date').strip()
            parent = (request.args.get('parent') or '').strip()
            r = Registrator(name, url_template, "", True, rid)
            parts = {
                'date': '',
                'user': '',
                'time': '',
                'type': '',
                'file': ''
            }
            try:
                if parent:
                    pp = parent.split('/')
                    keys = ['date', 'user', 'time', 'type']
                    for i in range(min(len(pp), len(keys))):
                        parts[keys[i]] = pp[i]
            except Exception:
                pass
            if level == 'date':
                url = r.base_url()
            elif level == 'user':
                url = r.build_partial_url(date=parts['date'])
            elif level == 'time':
                url = r.build_partial_url(date=parts['date'],
                                          user=parts['user'])
            elif level == 'type':
                url = r.build_partial_url(date=parts['date'],
                                          user=parts['user'],
                                          time=parts['time'])
            else:
                url = r.build_partial_url(date=parts['date'],
                                          user=parts['user'],
                                          time=parts['time'],
                                          type=parts['type'])
            entries = parse_directory_listing(url)

            # Sort entries in reverse order for date and time levels
            if level in ['date', 'time']:
                entries.sort(reverse=True)

            return jsonify({
                'status': 'success',
                'entries': entries,
                'url': url
            })
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Registrators import selected files ---
    @app.route('/registrators/<int:rid>/import', methods=['POST'])
    @require_permissions(CATEGORIES_MANAGE)
    @rate_limit()
    def registrators_import(rid):
        """Download selected remote files, convert, and store locally under registrators/<sub>.

		Payload JSON:
		{
		  "category_id": int,
		  "subcategory_id": int,
		  "base_parts": {"date": "YYYY-MM-DD", "user": "...", "time": "HH-MM-SS", "type": "VIDEO"},
		  "files": ["filename1.MOV", ...]
		}
		Limits number of files by config files.max_files_upload (default 10).
		"""
        try:
            j = request.get_json(silent=True) or {}
            cat_id = int(j.get('category_id') or 0)
            sub_id = int(j.get('subcategory_id') or 0)
            base_parts = j.get('base_parts') or {}
            file_names = list(j.get('files') or [])
            if not cat_id or not sub_id or not file_names:
                return jsonify({
                    'status':
                    'error',
                    'message':
                    'category_id, subcategory_id, files required'
                }), 400

            # Validate user has access to the specific category and subcategory
            try:
                # Check if category exists and user has access
                cat_row = app._sql.execute_scalar(
                    f"SELECT id FROM {app._sql.config['db']['prefix']}_category WHERE id=%s;",
                    [cat_id])
                if not cat_row:
                    return jsonify({
                        'status': 'error',
                        'message': 'Category not found'
                    }), 404

                # Check if subcategory exists and belongs to the category
                sub_row = app._sql.execute_scalar(
                    f"SELECT id FROM {app._sql.config['db']['prefix']}_subcategory WHERE id=%s AND category_id=%s;",
                    [sub_id, cat_id])
                if not sub_row:
                    return jsonify({
                        'status':
                        'error',
                        'message':
                        'Subcategory not found or does not belong to category'
                    }), 404
            except Exception as e:
                return jsonify({
                    'status': 'error',
                    'message': 'Error validating category access'
                }), 500
            # Enforce max files
            try:
                max_files = int(
                    app._sql.config.get('files',
                                        {}).get('max_files_upload', 10))
            except Exception:
                max_files = 10
            if len(file_names) > max_files:
                file_names = file_names[:max_files]
            # Load registrator and validate user has access
            row = app._sql.execute_scalar(
                f"SELECT name, url_template, enabled FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s LIMIT 1;",
                [rid])
            if not row:
                return jsonify({
                    'status': 'error',
                    'message': 'registrator not found'
                }), 404
            name, url_template, enabled = row[0], row[1], int(row[2] or 0)
            if not enabled:
                return jsonify({
                    'status': 'error',
                    'message': 'registrator disabled'
                }), 400

            # Check if user has permission to use this specific registrator
            try:
                # Get registrator permissions for this user
                perm_key = f"registrator_permissions:{rid}"
                perm_data = app._sql.setting_get(perm_key)
                if perm_data:
                    try:
                        perms = loads(perm_data)
                        user_perms = perms.get('user', {})
                        group_perms = perms.get('group', {})

                        # Check if user has direct permission
                        user_id = str(current_user.id)
                        has_user_permission = user_perms.get(user_id) == 1

                        # Check if user's group has permission
                        has_group_permission = False
                        if current_user.gid:
                            group_id = str(current_user.gid)
                            has_group_permission = group_perms.get(
                                group_id) == 1

                        if not (has_user_permission or has_group_permission):
                            return jsonify({
                                'status':
                                'error',
                                'message':
                                'No permission to use this registrator'
                            }), 403
                    except Exception:
                        # If permission data is corrupted, deny access
                        return jsonify({
                            'status':
                            'error',
                            'message':
                            'Invalid registrator permissions'
                        }), 403
            except Exception:
                # If we can't check permissions, deny access for security
                return jsonify({
                    'status':
                    'error',
                    'message':
                    'Cannot verify registrator permissions'
                }), 403
            r = Registrator(name, url_template, "", True, rid)
            # Resolve storage dir
            storage_dir = app._sql._build_storage_dir(cat_id, sub_id)
            makedirs(storage_dir, exist_ok=True)
            created_ids = []
            for fname in file_names:
                try:
                    url = r.build_url(date=str(base_parts.get('date') or ''),
                                      user=str(base_parts.get('user') or ''),
                                      time_s=str(base_parts.get('time') or ''),
                                      type_s=str(base_parts.get('type') or ''),
                                      file_s=str(fname or ''))
                    # Generate internal name (unique, collision-resistant)
                    seed = f"{rid}:{cat_id}:{sub_id}:{fname}:{time.time()}"
                    real_base = md5(seed.encode('utf-8')).hexdigest()
                    is_audio = fname.lower().endswith(
                        ('.aac', '.m4a', '.mp3', '.wav', '.oga', '.ogg',
                         '.wma', '.opus', '.mka'))
                    target_ext = '.m4a' if is_audio else '.mp4'
                    base_path = ospath.join(storage_dir, real_base)
                    # Download remote file to .webm temp (ffmpeg detects container)
                    try:
                        with urlopen(url, timeout=20) as resp, open(
                                base_path + '.webm', 'wb') as out:
                            out.write(resp.read())
                    except Exception:
                        # skip this file on network error
                        continue
                    # Probe size and duration for metadata
                    size_mb = 0.0
                    try:
                        size_bytes = ospath.getsize(base_path + '.webm')
                        size_mb = round(size_bytes / (1024 * 1024), 1)
                    except Exception:
                        pass
                    length_seconds = 0
                    try:
                        p = Popen([
                            "ffprobe", "-v", "error", "-show_entries",
                            "format=duration", "-of",
                            "default=noprint_wrappers=1:nokey=1",
                            base_path + '.webm'
                        ],
                                  stdout=PIPE,
                                  stderr=PIPE,
                                  universal_newlines=True)
                        sout, _ = p.communicate(timeout=10)
                        length_seconds = int(float((sout or '0').strip()) or 0)
                    except Exception:
                        pass
                    # Create DB record via new schema with non-editable description marker
                    owner = f"{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})"
                    desc = f"Регистратор — {name}"
                    file_id = app._sql.file_add2([
                        fname, real_base + target_ext, cat_id, sub_id, owner,
                        desc,
                        datetime.utcnow().strftime('%Y-%m-%d %H:%M'), 0, 0,
                        size_mb, None
                    ])
                    # Update probed metadata if available
                    try:
                        if length_seconds or size_mb:
                            app._sql.file_update_metadata(
                                [length_seconds, size_mb, file_id])
                            if socketio:
                                try:
                                    socketio.emit(
                                        'files:changed', {
                                            'reason': 'metadata',
                                            'id': file_id,
                                            'meta': {
                                                'length': length_seconds,
                                                'size': size_mb
                                            }
                                        })
                                except Exception:
                                    pass
                    except Exception:
                        pass
                    created_ids.append(file_id)
                    # Schedule conversion
                    try:
                        app.media_service.convert_async(
                            base_path + '.webm', base_path + target_ext,
                            ('file', file_id))
                    except Exception:
                        pass
                except Exception:
                    continue
            # Soft refresh for clients (emit to files room and broadcast registrators change)
            try:
                if socketio:
                    from modules.sync_manager import SyncManager, emit_registrators_changed
                    sm = SyncManager(socketio)
                    sm.emit_to_room('files:changed', {
                        'reason': 'registrators-import',
                        'ids': created_ids
                    },
                                    'files',
                                    reason='registrators-import')
                    try:
                        emit_registrators_changed(socketio,
                                                  'import',
                                                  ids=created_ids)
                    except Exception:
                        pass
            except Exception:
                pass
            # Log the import action
            try:
                cat = app._sql.category_by_id([cat_id])
                sub = app._sql.subcategory_by_id([sub_id])
                cat_name = cat.name if cat else f"cat_id={cat_id}"
                sub_name = sub.name if sub else f"sub_id={sub_id}"
                log_action(
                    'REGISTRATOR_IMPORT', current_user.name,
                    f'imported {len(created_ids)} files from registrator {name} to {cat_name}/{sub_name}',
                    (request.remote_addr or ''))
            except Exception:
                pass

            return jsonify({
                'status': 'success',
                'created': len(created_ids),
                'ids': created_ids
            })
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Registrators UI page ---
    @app.route('/registrators', methods=['GET'], endpoint='registrators_page')
    @require_permissions(CATEGORIES_VIEW)
    def admin_registrators_page():
        try:
            return render_template('registrators.j2.html',
                                   title='Регистраторы — Заявки-Наряды-Файлы')
        except Exception as e:
            app.flash_error(e)
            return Response(str(e),
                            status=500,
                            mimetype='text/plain; charset=utf-8')

    @app.route('/registrators/<int:rid>/download', methods=['GET'])
    @require_permissions(FILES_UPLOAD)
    def registrators_download(rid):
        """Download file from registrator via server (bypass CORS/proxy issues)."""
        try:
            url = request.args.get('url')
            if not url:
                return jsonify({
                    'status': 'error',
                    'message': 'URL parameter required'
                }), 400

            # Get registrator info from database
            try:
                row = app._sql.execute_scalar(
                    f"SELECT name, url_template FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s LIMIT 1;",
                    [rid])
                if not row:
                    return jsonify({
                        'status': 'error',
                        'message': 'Registrator not found'
                    }), 404

                name, url_template = row
                r = Registrator(name, url_template, "", True, rid)
            except Exception as e:
                return jsonify({
                    'status': 'error',
                    'message': f'Database error: {str(e)}'
                }), 500

            # Download file from registrator
            import requests
            _log.info(f"Attempting to download from registrator: {url}")

            # Try different approaches
            headers = {
                'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive'
            }

            response = requests.get(url,
                                    timeout=30,
                                    stream=True,
                                    verify=False,
                                    headers=headers)
            _log.info(f"Download response status: {response.status_code}")
            _log.info(f"Response headers: {dict(response.headers)}")

            if response.status_code != 200:
                _log.error(
                    f"Download failed with status {response.status_code}: {response.text[:500]}"
                )
                return jsonify({
                    'status':
                    'error',
                    'message':
                    f'Download failed with status {response.status_code}'
                }), response.status_code

            response.raise_for_status()

            # Return file as stream
            def generate():
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk

            return Response(generate(),
                            mimetype='application/octet-stream',
                            headers={
                                'Content-Disposition':
                                f'attachment; filename="{url.split("/")[-1]}"',
                                'Content-Length':
                                str(response.headers.get('content-length', 0))
                            })

        except requests.exceptions.RequestException as e:
            _log.error(f"Download failed for URL {url}: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Download failed: {str(e)}'
            }), 500
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': f'Server error: {str(e)}'
            }), 500
