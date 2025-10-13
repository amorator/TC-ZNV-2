from flask import render_template, request, jsonify, Response
from flask_login import current_user
from modules.permissions import require_permissions, CATEGORIES_VIEW, CATEGORIES_MANAGE
from modules.logging import get_logger
from modules.registrators import Registrator, parse_directory_listing
from datetime import datetime
import time
from functools import wraps

_log = get_logger(__name__)


def register(app, socketio=None):

    def _can_view_registrator(app, rid: int) -> bool:
        try:
            # Admin bypass
            is_auth_attr = getattr(current_user, 'is_authenticated', False)
            is_authenticated = bool(
                is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
            if not is_authenticated:
                return False
            from modules.permissions import ADMIN_ANY
            if hasattr(current_user, 'has') and current_user.has(ADMIN_ANY):
                return True
            import json
            key = f"registrator_permissions:{rid}"
            val = app._sql.setting_get(key)
            data = json.loads(val) if val else {}
            uid = str(getattr(current_user, 'id', 0))
            gid = str(getattr(current_user, 'gid', 0))
            umap = (data.get('user') or {}) if isinstance(data, dict) else {}
            gmap = (data.get('group') or {}) if isinstance(data, dict) else {}
            if uid in umap and int(umap.get(uid) or 0) == 1:
                return True
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

    @app.route('/registrators', methods=['POST'])
    @require_permissions(CATEGORIES_MANAGE)
    def registrators_create():
        try:
            j = request.get_json(silent=True) or {}
            name = (j.get('name') or '').strip()
            url_template = (j.get('url_template') or '').strip()
            # optional display_order; if not provided, append to the end
            try:
                display_order = int(j.get('display_order'))
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
            # Require file placeholder in url_template at minimum
            if ('{file}' not in url_template) and ('<file>'
                                                   not in url_template):
                return jsonify({
                    'status':
                    'error',
                    'message':
                    'В прототипе ссылки должен быть плейсхолдер {file}'
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
            if '{file}' not in url_template:
                return jsonify({
                    'status':
                    'error',
                    'message':
                    'В прототипе ссылки должен быть плейсхолдер {file}'
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
            return jsonify({'status': 'success'})
        except Exception as e:
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
                f"SELECT id, login, permission FROM {app._sql.config['db']['prefix']}_user ORDER BY login;",
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
            for user_id, login, permission in users:
                force_access = False

                # Check for admin user
                if login.lower() == 'admin':
                    force_access = True

                # Check for full access patterns
                if permission:
                    perm_str = str(permission).strip()
                    if (perm_str == 'aef,a,abcdflm,ab,ab,ab,abcd'
                            or perm_str == 'aef,a,abcdflm,ab,ab,ab'
                            or 'z' in perm_str or 'полный доступ' in perm_str
                            or 'full access' in perm_str):
                        force_access = True

                if force_access:
                    perms['user'][str(user_id)] = 1

            return perms
        except Exception as e:
            app.flash_error(e)
            return perms

    @app.route('/registrators/<int:rid>/permissions', methods=['GET'])
    @require_permissions(CATEGORIES_VIEW)
    def registrators_permissions_get(rid):
        try:
            import json
            key = f"registrator_permissions:{rid}"
            val = app._sql.setting_get(key)
            try:
                stored = json.loads(val) if val else {}
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
            import json
            data = request.get_json(silent=True) or {}
            perms = data.get('permissions') or {}
            # Enforce admin access before saving
            perms = enforce_admin_access_permissions(perms)
            key = f"registrator_permissions:{rid}"
            app._sql.setting_set(key, json.dumps(perms, ensure_ascii=False))
            try:
                if socketio:
                    socketio.emit('registrator_permissions_updated',
                                  {'registrator_id': rid},
                                  broadcast=True)
            except Exception:
                pass
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
            r = Registrator(name, url_template, True, rid)
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
                url = r.build_url(date='',
                                  user='',
                                  time_s='',
                                  type_s='',
                                  file_s='')
            elif level == 'user':
                url = r.build_url(date=parts['date'])
            elif level == 'time':
                url = r.build_url(date=parts['date'], user=parts['user'])
            elif level == 'type':
                url = r.build_url(date=parts['date'],
                                  user=parts['user'],
                                  time_s=parts['time'])
            else:
                url = r.build_url(date=parts['date'],
                                  user=parts['user'],
                                  time_s=parts['time'],
                                  type_s=parts['type'])
            entries = parse_directory_listing(url)
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
    @rate_limit(30, 60)
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
            # Enforce max files
            try:
                max_files = int(
                    app._sql.config.get('files',
                                        {}).get('max_files_upload', 10))
            except Exception:
                max_files = 10
            if len(file_names) > max_files:
                file_names = file_names[:max_files]
            # Load registrator
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
            r = Registrator(name, url_template, True, rid)
            # Resolve storage dir
            storage_dir = app._sql._build_storage_dir(cat_id, sub_id)
            import os
            os.makedirs(storage_dir, exist_ok=True)
            import hashlib, urllib.request
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
                    real_base = hashlib.md5(seed.encode('utf-8')).hexdigest()
                    is_audio = fname.lower().endswith(
                        ('.aac', '.m4a', '.mp3', '.wav', '.oga', '.ogg',
                         '.wma', '.opus', '.mka'))
                    target_ext = '.m4a' if is_audio else '.mp4'
                    base_path = os.path.join(storage_dir, real_base)
                    # Download remote file to .webm temp (ffmpeg detects container)
                    try:
                        with urllib.request.urlopen(url,
                                                    timeout=20) as resp, open(
                                                        base_path + '.webm',
                                                        'wb') as out:
                            out.write(resp.read())
                    except Exception:
                        # skip this file on network error
                        continue
                    # Probe size and duration for metadata
                    size_mb = 0.0
                    try:
                        size_bytes = os.path.getsize(base_path + '.webm')
                        size_mb = round(size_bytes / (1024 * 1024), 1)
                    except Exception:
                        pass
                    length_seconds = 0
                    try:
                        import subprocess
                        p = subprocess.Popen([
                            "ffprobe", "-v", "error", "-show_entries",
                            "format=duration", "-of",
                            "default=noprint_wrappers=1:nokey=1",
                            base_path + '.webm'
                        ],
                                             stdout=subprocess.PIPE,
                                             stderr=subprocess.PIPE,
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
            # Soft refresh for clients
            try:
                if socketio:
                    socketio.emit('files:changed', {
                        'reason': 'registrators-import',
                        'ids': created_ids
                    })
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
            return render_template('admin/registrators.j2.html',
                                   title='Регистраторы — Заявки-Наряды-Файлы')
        except Exception as e:
            app.flash_error(e)
            return Response(str(e),
                            status=500,
                            mimetype='text/plain; charset=utf-8')
