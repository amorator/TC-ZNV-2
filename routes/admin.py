"""Admin routes: system maintenance, logs, backups, push notifications."""

import os
import time
from datetime import datetime as dt, datetime
from functools import wraps
from io import BytesIO
from os import path, listdir, stat
from zipfile import ZipFile, ZIP_DEFLATED

from flask import render_template, request, jsonify, Response, abort, send_file, make_response
from flask_login import current_user, login_required
from flask_socketio import join_room, emit

from modules.logging import get_logger, log_action
from modules.permissions import require_permissions, ADMIN_VIEW_PAGE, ADMIN_MANAGE
from modules.registrators import Registrator, parse_directory_listing
from modules.sync_manager import emit_admin_changed
from modules.middleware import is_real_page

_log = get_logger(__name__)


def register(app, socketio=None):
    # Socket.IO room join for admin page
    try:
        if socketio:

            @socketio.on('admin:join')
            def _admin_join(_data=None):
                try:
                    join_room('admin')
                except Exception:
                    pass
    except Exception:
        pass
    # Get rate limiter from app
    rate_limit = app.rate_limiters.get(
        'admin',
        app.rate_limiters.get('default', lambda *args, **kwargs: lambda f: f))

    # --- One-time background backfill of session beacons after startup ---
    def _backfill_session_beacons(limit: int = 5000) -> dict:
        stats = {'processed': 0, 'created': 0, 'errors': 0}
        try:
            rc = getattr(app, 'redis_client', None)
            if not rc:
                return stats
            try:
                from datetime import timedelta as _td
                lifetime_s = 1800
                cfg_life = app.config.get('PERMANENT_SESSION_LIFETIME')
                if isinstance(cfg_life, _td):
                    lifetime_s = int(cfg_life.total_seconds())
                else:
                    try:
                        lifetime_s = int(cfg_life or 1800)
                    except Exception:
                        lifetime_s = 1800
            except Exception:
                try:
                    lifetime_s = int(app._sql.config.get('web', 'session_lifetime', fallback='1800'))
                except Exception:
                    lifetime_s = 1800

            sess_prefix = app.config.get('SESSION_KEY_PREFIX', 'znf:session:') or 'znf:session:'
            # Collect up to limit session store keys
            keys = []
            try:
                if hasattr(rc, 'scan_iter'):
                    for k in rc.scan_iter(match=f'{sess_prefix}*', count=500):
                        keys.append(k)
                        if len(keys) >= limit:
                            break
                else:
                    keys = rc.keys(f'{sess_prefix}*') or []
                    if len(keys) > limit:
                        keys = keys[:limit]
            except Exception:
                keys = []
            if not keys:
                return stats
            # Pipeline read TTLs and create beacons if missing
            pipe = rc.pipeline()
            key_infos = []
            for skey in keys:
                try:
                    kstr = skey.decode('utf-8', errors='ignore') if isinstance(skey, bytes) else str(skey)
                    if not kstr.startswith(sess_prefix):
                        continue
                    sid = kstr[len(sess_prefix):]
                    if not sid:
                        continue
                    stats['processed'] += 1
                    ttl_store = rc.ttl(kstr)
                    # Prepare meta and beacon keys
                    meta_key = f'sessions:cookie:{sid}'
                    ttl_key = f'sessions:cookie:ttl:{sid}'
                    key_infos.append((sid, meta_key, ttl_key, ttl_store))
                except Exception:
                    stats['errors'] += 1
                    continue
            # second stage: write missing meta/beacons
            for sid, meta_key, ttl_key, ttl_store in key_infos:
                try:
                    # Compute effective ttl for beacon
                    ttl_eff = ttl_store if isinstance(ttl_store, int) and ttl_store >= 0 else lifetime_s
                    # Ensure meta hash exists (best-effort, minimal fields)
                    try:
                        if not rc.exists(meta_key):
                            rc.hset(meta_key, mapping={
                                'sid': sid,
                                'user_id': '',
                                'user': '',
                                'ip': '',
                                'ua': '',
                                'created_at': '0',
                                'last_seen': '0',
                            })
                            rc.expire(meta_key, ttl_eff)
                    except Exception:
                        pass
                    # Ensure TTL beacon exists
                    if not rc.exists(ttl_key):
                        rc.set(ttl_key, '1', ex=max(1, int(ttl_eff)))
                        rc.sadd('sessions:cookie:index', sid)
                        stats['created'] += 1
                except Exception:
                    stats['errors'] += 1
                    continue
        except Exception:
            stats['errors'] += 1
        return stats

    # Fire and forget one-time backfill shortly after startup
    try:
        import threading, time as _t
        def _delayed_backfill():
            try:
                _t.sleep(2)
            except Exception:
                pass
            try:
                _backfill_session_beacons(limit=5000)
            except Exception:
                pass
        threading.Thread(target=_delayed_backfill, daemon=True).start()
    except Exception:
        pass

    @app.route('/admin/sessions/backfill', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    def admin_sessions_backfill():
        try:
            stats = _backfill_session_beacons(limit=5000)
            return jsonify({'status': 'success', 'stats': stats})
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/admin', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin():
        """Administration page: active users table and actions log panel."""
        try:
            # Provide plain id/name dicts for client-side JSON consumption
            groups = []
            try:
                rows = app._sql.execute_query(
                    f"SELECT id, name FROM {app._sql.config['db']['prefix']}_group ORDER BY name;",
                    [])
                groups = [{
                    'id': r[0],
                    'name': r[1]
                } for r in (rows or []) if r]
            except Exception:
                # Fallback to group_all() if available and map objects to dict
                try:
                    objs = app._sql.group_all()
                    groups = [{
                        'id': getattr(o, 'id', None),
                        'name': getattr(o, 'name', '')
                    } for o in (objs or [])]
                except Exception:
                    groups = []
        except Exception:
            groups = []

        return render_template('admin.j2.html',
                               title='Администрирование — Заявки-Наряды-Файлы',
                               groups=groups)

    @app.route('/admin/export/users-dokuwiki', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_export_users_dokuwiki():
        """Export users to a Dokuwiki-formatted table (text/plain)."""
        try:
            # Load users and groups
            users = app._sql.user_all() or []
            group_rows = app._sql.execute_query(
                f"SELECT id, name FROM {app._sql.config['db']['prefix']}_group ORDER BY id;"
            ) or []
            gid_to_name = {int(r[0]): str(r[1] or '') for r in group_rows}

            # Prepare rows
            title = '=== Хренузеры (сайта) ==='
            headers = [
                'Логин', 'Пароль (хэш)', 'ФИО', 'Группа',
                'Права', 'Права на категории', 'Права на регистраторы', 'Описание'
            ]

            def split_permissions(perm_str: str):
                parts = (perm_str or '').split(',')
                # Ensure at least 7 slots (1-requests,2-orders,3-files,4-users,5-groups,6-admin,7-categories)
                if len(parts) < 7:
                    parts += [''] * (7 - len(parts))
                return parts

            rows = []
            for u in users:
                login = str(getattr(u, 'login', '') or '')
                pwd = str(getattr(u, 'password', '') or '')
                fio = str(getattr(u, 'name', '') or '')
                gname = gid_to_name.get(getattr(u, 'gid', None), '')
                perm = str(getattr(u, 'permission', '') or '')
                parts = split_permissions(perm)
                cat_perm = parts[6] if len(parts) >= 7 else ''
                # Registrators page uses categories permissions in this app
                reg_perm = cat_perm
                desc = ''
                rows.append([login, pwd, fio, gname, perm, cat_perm, reg_perm, desc])

            # Compute column widths
            cols = len(headers)
            widths = [len(h) for h in headers]
            for r in rows:
                for i in range(cols):
                    widths[i] = max(widths[i], len(str(r[i] or '')))

            def fmt_header(cells):
                parts = []
                for i, c in enumerate(cells):
                    s = str(c)
                    parts.append(' ^ ' + s + ' ' * (widths[i] - len(s)) + ' ')
                return ''.join(parts) + '|'  # closing as in example

            def fmt_row(cells):
                parts = []
                for i, c in enumerate(cells):
                    s = str(c or '')
                    parts.append(' | ' + s + ' ' * (widths[i] - len(s)) + ' ')
                return ''.join(parts) + '|' 

            lines = [title, '', fmt_header(headers)]
            for r in rows:
                lines.append(fmt_row(r))
            text = '\n'.join(lines) + '\n'

            from datetime import datetime as _dt
            ts = _dt.now().strftime('%Y%m%d-%H%M%S')
            resp = make_response(text)
            resp.headers['Content-Type'] = 'text/plain; charset=utf-8'
            resp.headers['Content-Disposition'] = f'attachment; filename="znf-users-{ts}.txt"'
            return resp
        except Exception as e:
            return make_response(f"export error: {e}", 500)

    @app.route('/admin/export/db-sql', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_export_db_sql():
        """Export entire database SQL dump as attachment (mysqldump if available)."""
        try:
            import shutil
            import subprocess
            from datetime import datetime as _dt
            cfg = app._sql.config
            db = cfg['db']
            host = db.get('host', '127.0.0.1')
            port = str(db.get('port', '3306'))
            user = db.get('user')
            password = db.get('password')
            name = db.get('name')
            ts = _dt.now().strftime('%Y%m%d-%H%M%S')
            filename = f"znf-{ts}.sql"
            # Prefer mysqldump
            mysqldump_path = shutil.which('mysqldump')
            if mysqldump_path:
                env = dict(**os.environ)
                # Use MYSQL_PWD to avoid showing password in args
                if password:
                    env['MYSQL_PWD'] = str(password)
                cmd = [
                    mysqldump_path,
                    f"-h{host}",
                    f"-P{port}",
                    f"-u{user}",
                    '--routines', '--events', '--triggers', '--single-transaction', '--quick', '--hex-blob',
                    name,
                ]
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)

                def generate():
                    try:
                        for chunk in iter(lambda: proc.stdout.read(8192), b''):
                            if not chunk:
                                break
                            yield chunk
                    finally:
                        try:
                            proc.stdout.close()
                        except Exception:
                            pass
                        try:
                            # drain stderr to avoid zombies
                            proc.stderr.read()
                            proc.stderr.close()
                        except Exception:
                            pass
                resp = app.response_class(generate(), mimetype='application/sql')
                resp.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
                return resp
            # Fallback: simple SQL export by tables (schema+data) is not implemented
            return make_response('mysqldump not available on server', 500)
        except Exception as e:
            try:
                app.logger.error(f"DB export error: {e}")
            except Exception:
                pass
            return make_response(f"db export error: {e}", 500)

    # --- Unified notification queue helpers (Redis-backed) ---
    def _queue_broadcast_notification(payload: dict) -> None:
        try:
            rc = getattr(app, 'redis_client', None)
            if not rc:
                return
            import json as _json
            rc.lpush('notifications:broadcast', _json.dumps(payload, ensure_ascii=False))
            rc.ltrim('notifications:broadcast', 0, 199)
        except Exception:
            pass

    def _queue_user_notification(user_id: int, payload: dict) -> None:
        try:
            rc = getattr(app, 'redis_client', None)
            if not rc:
                return
            import json as _json
            key = f'notifications:user:{int(user_id)}'
            rc.lpush(key, _json.dumps(payload, ensure_ascii=False))
            rc.ltrim(key, 0, 99)
        except Exception:
            pass

    def _queue_group_notification(group_id: int, payload: dict) -> None:
        try:
            rc = getattr(app, 'redis_client', None)
            if not rc:
                return
            import json as _json
            key = f'notifications:group:{int(group_id)}'
            # Expand group into user notifications for reliability
            rows = app._sql.execute_query(
                f"SELECT id FROM {app._sql.config['db']['prefix']}_user WHERE gid=%s AND enabled=1;",
                [group_id]) or []
            for r in rows:
                try:
                    _queue_user_notification(int(r[0]), payload)
                except Exception:
                    continue
        except Exception:
            pass

    def _emit_notification_to_user_ids(user_ids, payload):
        sent = 0
        try:
            if not socketio or not user_ids:
                return 0
            # Fallback to in-memory presence store: sid -> info{ user_id }
            try:
                presence = getattr(app, '_presence', {}) or {}
                uid_set = set()
                for u in user_ids:
                    try:
                        uid_set.add(int(u))
                    except Exception:
                        continue
                for psid, info in list(presence.items()):
                    try:
                        uid = int(info.get('user_id') or -1)
                    except Exception:
                        uid = -1
                    if uid in uid_set:
                        try:
                            socketio.emit('notification', payload, room=psid)
                            sent += 1
                        except Exception:
                            continue
            except Exception:
                pass
            return sent
        except Exception:
            return sent

    # --- Feedback endpoint: save to logs/problems.txt and notify admins ---
    @app.route('/api/feedback', methods=['POST'])
    @login_required
    def api_feedback_submit():
        try:
            data = request.get_json(silent=True) or {}
            message = str((data.get('message') or '').strip())
            if not message:
                return jsonify({ 'ok': False, 'error': 'empty' }), 400
            # Resolve user identity
            try:
                user_login = str(getattr(current_user, 'login', '') or '')
            except Exception:
                user_login = ''
            try:
                user_name = str(getattr(current_user, 'name', '') or '')
            except Exception:
                user_name = ''
            try:
                user_gid = int(getattr(current_user, 'gid', 0) or 0)
            except Exception:
                user_gid = 0
            # Resolve group name
            group_name = ''
            try:
                prefix = app._sql.config['db']['prefix']
                row = app._sql.execute_query(
                    f"SELECT name FROM {prefix}_group WHERE id=%s LIMIT 1;",
                    [user_gid]
                ) or []
                group_name = str(row[0][0] or '') if row and row[0] else ''
            except Exception:
                group_name = ''
            # Append to logs/_problems.txt
            try:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                # routes/ -> project root assumed two levels up; but we know logs lives at /usr/share/znf/logs
                problems_path = os.path.join('/usr/share/znf', 'logs', '_problems.txt')
                os.makedirs(os.path.dirname(problems_path), exist_ok=True)
                ts = dt.now().strftime('%Y-%m-%d %H:%M:%S')
                line = f"{ts} login={user_login} user={user_name} group={group_name} ip={(request.remote_addr or '')} msg={message}\n"
                with open(problems_path, 'a', encoding='utf-8') as f:
                    f.write(line)
            except Exception:
                pass
            # Notify admins: queue per-user and emit to admin room
            try:
                # Resolve admin group id from config name
                admin_gid = None
                try:
                    cfg = getattr(app._sql, 'config', {})
                    from configparser import ConfigParser
                    aname = 'Программисты'
                    if isinstance(cfg, ConfigParser):
                        aname = cfg.get('admin', 'group', fallback=aname) or aname
                    elif isinstance(cfg, dict):
                        admin = cfg.get('admin') if hasattr(cfg, 'get') else None
                        if isinstance(admin, dict) and 'group' in admin:
                            aname = admin.get('group') or aname
                        elif 'group' in cfg:
                            aname = cfg.get('group') or aname
                    name_norm = (aname or '').strip().lower()
                    rows = app._sql.execute_query(
                        f"SELECT id,name FROM {app._sql.config['db']['prefix']}_group"
                    ) or []
                    for gid, gname in rows:
                        if str(gname).strip().lower() == name_norm:
                            admin_gid = int(gid)
                            break
                except Exception:
                    admin_gid = None
                payload = {
                    'title': 'Сообщение о новой ошибке',
                    'text': f"{dt.now().strftime('%Y-%m-%d %H:%M:%S')} {user_login} {user_name}",
                    'body': f"{dt.now().strftime('%Y-%m-%d %H:%M:%S')} {user_login} {user_name}",
                    'type': 'problem',
                    'icon': '/static/icons/notification_menu.png',
                }
                # Queue per-user delivery for admin group
                if admin_gid is not None:
                    _queue_group_notification(admin_gid, payload)
                # Also emit to admin room for online admins
                try:
                    if socketio:
                        socketio.emit('admin:notification', payload, room='admin')
                except Exception:
                    pass
            except Exception:
                pass
            return jsonify({ 'ok': True })
        except Exception:
            return jsonify({ 'ok': False, 'error': 'server' }), 500

    @app.route('/api/pool-status', methods=['GET'])
    @login_required
    @require_permissions(ADMIN_VIEW_PAGE)
    def pool_status():
        """API endpoint to check database connection pool status."""
        try:
            status = app._sql.get_pool_status()
            return jsonify({'status': 'success', 'pool_status': status})
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # Push subscriptions maintenance endpoints removed (deprecated)

    # --- Обслуживание таблицы файлов (ручной запуск, с блокировкой на 30 мин) ---
    @app.route('/admin/files_maintain', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    def admin_files_maintain():
        """Ручное обслуживание таблицы файлов: обновление размеров, длин, существования.
        
        Ограничение: не чаще 1 раза в 30 минут (глобальная блокировка).
        """
        try:
            # Resolve DB table prefix safely
            def _get_db_prefix():
                try:
                    cfg = getattr(app._sql, 'config', {})
                    if isinstance(cfg, dict):
                        db = cfg.get('db') or {}
                        return (db.get('prefix') or '').strip()
                    try:
                        return (app._sql.config.get(
                            'db', 'prefix', fallback='') or '').strip()
                    except Exception:
                        return ''
                except Exception:
                    return ''

            db_prefix = _get_db_prefix()
            if not db_prefix:
                return jsonify({
                    'status': 'error',
                    'message': 'DB prefix is not configured'
                }), 500

            # Проверяем блокировку в Redis (30 минут)
            from datetime import datetime, timedelta
            now = datetime.utcnow()
            redis_key = 'files_maintenance_lock'

            if hasattr(app, 'redis_client') and app.redis_client:
                try:
                    last_run_str = app.redis_client.get(redis_key)
                    if last_run_str:
                        # Handle both bytes and string responses from Redis
                        if isinstance(last_run_str, bytes):
                            last_run_str = last_run_str.decode('utf-8')
                        last_run = datetime.fromisoformat(last_run_str)
                        if (now - last_run) < timedelta(minutes=30):
                            remaining_minutes = 30 - (
                                now - last_run).total_seconds() / 60
                            return jsonify({
                                'status':
                                'error',
                                'message':
                                f'Операция уже выполнялась недавно (ограничение 30 минут). Осталось: {remaining_minutes:.1f}мин'
                            }), 429
                except Exception as e:
                    print(f"Redis check error: {e}")

            # Проверяем блокировку в памяти (fallback)
            last_run = getattr(app, '_last_files_maintain', None)
            if last_run and (now - last_run) < timedelta(minutes=30):
                return jsonify({
                    'status':
                    'error',
                    'message':
                    'Операция уже выполнялась недавно (ограничение 30 минут). Повторите позже.'
                }), 429

            # Устанавливаем блокировку в Redis и памяти
            if hasattr(app, 'redis_client') and app.redis_client:
                try:
                    app.redis_client.set(redis_key, now.isoformat(), ex=30 * 60)  # 30 минут TTL
                except Exception as e:
                    print(f"Redis set error: {e}")
            app._last_files_maintain = now

            # Получаем конфигурацию путей к файлам
            try:
                files_root = app._sql.config['files']['root']
                categories_root = os.path.join(files_root, 'files')
            except Exception:
                files_root = '/var/www/files'
                categories_root = os.path.join(files_root, 'files')

            updated_count = 0
            created_count = 0
            errors_count = 0

            # 1. Обновляем существующие записи в БД
            try:
                files_query = f"""
                    SELECT id, file_name, category_id, subcategory_id 
                    FROM {db_prefix}_file 
                """
                files_rows = app._sql.execute_query(files_query, [])

                for row in files_rows or []:
                    file_id, file_name, category_id, subcategory_id = row
                    try:
                        # Строим путь по category_id и subcategory_id
                        # Получаем названия категорий по ID
                        try:
                            cat_name = None
                            sub_name = None
                            if category_id:
                                cat_query = f"SELECT folder_name FROM {db_prefix}_file_category WHERE id = %s"
                                cat_result = app._sql.execute_query(
                                    cat_query, [category_id])
                                if cat_result:
                                    cat_name = cat_result[0][0]
                            if subcategory_id:
                                sub_query = f"SELECT folder_name FROM {db_prefix}_file_subcategory WHERE id = %s"
                                sub_result = app._sql.execute_query(
                                    sub_query, [subcategory_id])
                                if sub_result:
                                    sub_name = sub_result[0][0]

                            if cat_name and sub_name:
                                full_path = os.path.join(
                                    categories_root, cat_name, sub_name,
                                    file_name)
                            else:
                                full_path = os.path.join(
                                    files_root, file_name)
                        except Exception:
                            full_path = os.path.join(files_root, file_name)

                        if os.path.exists(full_path):
                            stat_info = os.stat(full_path)
                            file_size = stat_info.st_size
                            file_mtime = datetime.fromtimestamp(
                                stat_info.st_mtime)

                            # Определяем тип файла и длину
                            file_type = "Не опознан"
                            duration = 0

                            if file_name.lower().endswith(
                                ('.mp4', '.avi', '.mkv', '.mov', '.wmv',
                                 '.flv', '.webm')):
                                file_type = "Видео"
                                # Определяем длительность видео через ffprobe
                                try:
                                    import subprocess, json
                                    p = subprocess.Popen([
                                        "ffprobe", "-v", "error", "-show_entries",
                                        "format=duration", "-of",
                                        "default=noprint_wrappers=1:nokey=1", full_path
                                    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
                                    sout, _ = p.communicate(timeout=8)
                                    duration = int(float((sout or '0').strip()) or 0)
                                except Exception:
                                    try:
                                        p = subprocess.Popen([
                                            "ffprobe", "-v", "error", "-select_streams", "v:0",
                                            "-show_entries", "stream=duration", "-of",
                                            "default=noprint_wrappers=1:nokey=1", full_path
                                        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
                                        sout, _ = p.communicate(timeout=8)
                                        duration = int(float((sout or '0').strip()) or 0)
                                    except Exception:
                                        duration = 0
                            elif file_name.lower().endswith(
                                ('.mp3', '.wav', '.flac', '.aac', '.ogg',
                                 '.m4a')):
                                file_type = "Аудио"
                                # Определяем длительность аудио через ffprobe
                                try:
                                    import subprocess
                                    p = subprocess.Popen([
                                        "ffprobe", "-v", "error", "-show_entries",
                                        "format=duration", "-of",
                                        "default=noprint_wrappers=1:nokey=1", full_path
                                    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
                                    sout, _ = p.communicate(timeout=8)
                                    duration = int(float((sout or '0').strip()) or 0)
                                except Exception:
                                    duration = 0

                            # Обновляем запись в БД
                            update_query = f"""
                                UPDATE {db_prefix}_file 
                                SET size_mb = %s, length_seconds = %s, file_exists = 1, updated_at = %s
                                WHERE id = %s
                            """
                            app._sql.execute_non_query(update_query, [
                                (file_size / (1024 * 1024)), duration, file_mtime, file_id
                            ])
                            updated_count += 1
                        else:
                            # Файл не существует - только помечаем как отсутствующий (без изменения description)
                            update_query = f"""
                                UPDATE {db_prefix}_file 
                                SET file_exists = 0
                                WHERE id = %s
                            """
                            app._sql.execute_non_query(update_query, [file_id])
                            updated_count += 1

                    except Exception as e:
                        print(f"Error updating file {file_id}: {e}")
                        errors_count += 1

            except Exception as e:
                print(f"Error updating existing files: {e}")
                errors_count += 1

            # 2. Сканируем папки категорий и создаем записи для новых файлов
            try:
                if os.path.exists(categories_root):
                    for category_name in os.listdir(categories_root):
                        category_path = os.path.join(categories_root,
                                                     category_name)
                        if not os.path.isdir(category_path):
                            continue

                        for subcategory_name in os.listdir(category_path):
                            subcategory_path = os.path.join(
                                category_path, subcategory_name)
                            if not os.path.isdir(subcategory_path):
                                continue

                            for filename in os.listdir(subcategory_path):
                                file_path = os.path.join(
                                    subcategory_path, filename)
                                if not os.path.isfile(file_path):
                                    continue

                                try:
                                    # Получаем ID категории и подкатегории для проверки
                                    cat_id = None
                                    sub_id = None
                                    try:
                                        if category_name:
                                            cat_query = f"SELECT id FROM {db_prefix}_file_category WHERE folder_name = %s"
                                            cat_result = app._sql.execute_query(
                                                cat_query, [category_name])
                                            if cat_result:
                                                cat_id = cat_result[0][0]
                                        if subcategory_name:
                                            sub_query = f"SELECT id FROM {db_prefix}_file_subcategory WHERE folder_name = %s"
                                            sub_result = app._sql.execute_query(
                                                sub_query, [subcategory_name])
                                            if sub_result:
                                                sub_id = sub_result[0][0]
                                    except Exception:
                                        pass

                                    # Проверяем, есть ли уже запись в БД
                                    check_query = f"""
                                        SELECT id FROM {db_prefix}_file 
                                        WHERE file_name = %s AND category_id = %s AND subcategory_id = %s
                                    """
                                    existing = app._sql.execute_query(
                                        check_query,
                                        [filename, cat_id, sub_id])

                                    if not existing:
                                        # Создаем новую запись
                                        stat_info = os.stat(file_path)
                                        file_size = stat_info.st_size
                                        file_mtime = datetime.fromtimestamp(
                                            stat_info.st_mtime)
                                        file_ctime = datetime.fromtimestamp(
                                            stat_info.st_ctime)

                                        # Определяем тип файла
                                        file_type = "Не опознан"
                                        if filename.lower().endswith(
                                            ('.mp4', '.avi', '.mkv', '.mov',
                                             '.wmv', '.flv', '.webm')):
                                            file_type = "Видео"
                                        elif filename.lower().endswith(
                                            ('.mp3', '.wav', '.flac', '.aac',
                                             '.ogg', '.m4a')):
                                            file_type = "Аудио"

                                        # Получаем информацию о текущем пользователе
                                        admin_name = getattr(
                                            current_user, 'name',
                                            None) or 'admin'
                                        admin_id = getattr(
                                            current_user, 'id', None)

                                        # Если admin_id не найден, ищем пользователя admin по логину
                                        if not admin_id:
                                            try:
                                                admin_user = app._sql.execute_query(
                                                    f"SELECT id FROM {db_prefix}_user WHERE login = 'admin' LIMIT 1",
                                                    [])
                                                if admin_user:
                                                    admin_id = admin_user[0][0]
                                                else:
                                                    admin_id = 1  # Fallback к ID 1
                                            except Exception:
                                                admin_id = 1  # Fallback к ID 1

                                        # cat_id и sub_id уже получены выше

                                        # Создаем запись в БД
                                        insert_query = f"""
                                            INSERT INTO {db_prefix}_file 
                                            (display_name, file_name, owner_id, description, created_at, ready, 
                                             length_seconds, size_mb, category_id, subcategory_id, file_exists, note)
                                            VALUES (%s, %s, %s, %s, %s, 1, %s, %s, %s, %s, 1, %s)
                                        """
                                        app._sql.execute_non_query(
                                            insert_query, [
                                                filename, filename, admin_id,
                                                file_type, now, 0, file_size /
                                                (1024 * 1024), cat_id, sub_id,
                                                "Загружен из файловой системы"
                                            ])
                                        created_count += 1

                                except Exception as e:
                                    print(
                                        f"Error creating file record for {filename}: {e}"
                                    )
                                    errors_count += 1

            except Exception as e:
                print(f"Error scanning categories: {e}")
                errors_count += 1

            # Отправляем событие синхронизации
            try:
                emit_admin_changed(
                    socketio,
                    'maintenance',
                    action='files_maintain_completed',
                    updated=updated_count,
                    created=created_count,
                    errors=errors_count,
                    seconds_left=30 * 60,  # 30 минут
                    timestamp=now.isoformat(),
                )
            except Exception:
                pass

            # Отправляем события синхронизации через SyncManager
            try:
                if socketio:
                    from modules.sync_manager import SyncManager
                    sync_manager = SyncManager(socketio)

                    # Отправляем событие завершения обслуживания файлов
                    maintenance_data = {
                        'updated':
                        updated_count,
                        'created':
                        created_count,
                        'errors':
                        errors_count,
                        'timestamp':
                        now.isoformat(),
                        'originClientId': (request.headers.get('X-Client-Id')
                                           or '').strip()
                    }

                    # Отправляем в комнату files для пользователей на странице файлов
                    sync_manager.emit_to_room('files:maintenance_completed',
                                              maintenance_data, 'files',
                                              'maintenance_completed')

                    # Отправляем общее событие изменения файлов для всех комнат
                    sync_manager.emit_to_room('files:changed',
                                              maintenance_data, 'files',
                                              'maintenance_completed')

                    # Также отправляем в другие комнаты для уведомления
                    common_rooms = [
                        'admin', 'users', 'groups', 'categories',
                        'registrators', 'index'
                    ]
                    for room in common_rooms:
                        try:
                            sync_manager.emit_to_room(
                                'files:maintenance_completed',
                                maintenance_data, room,
                                'maintenance_completed')
                        except Exception as e:
                            print(
                                f"Failed to send files:maintenance_completed to room {room}: {e}"
                            )

            except Exception as e:
                print(f"Failed to send files sync events: {e}")

            # Логируем действие
            try:
                log_action(
                    'ADMIN_FILES_MAINTAIN', current_user.name,
                    f'updated={updated_count} created={created_count} errors={errors_count}',
                    (request.remote_addr or ''))
            except Exception:
                pass

            return jsonify({
                'status': 'success',
                'updated': updated_count,
                'created': created_count,
                'errors': errors_count,
                'seconds_left': 30 * 60
            })

        except Exception as e:
            try:
                _log.error("/admin/files_maintain failed", exc_info=True)
            except Exception:
                pass
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Logs table server-side pagination & search (HTML tbody fragment) ---
    @app.route('/admin/logs/page', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_logs_page():
        """Return paginated logs table rows as HTML fragment and meta."""
        try:
            # os used from top-level imports
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 20))
            if page < 1: page = 1
            if page_size < 1: page_size = 20
            logs_dir = os.path.join(app.root_path, 'logs')
            items = []
            if os.path.isdir(logs_dir):
                for name in os.listdir(logs_dir):
                    if name.startswith('.'): continue
                    full = os.path.join(logs_dir, name)
                    if not os.path.isfile(full): continue
                    st = os.stat(full)
                    items.append({
                        'name': name,
                        'size': int(st.st_size),
                        'mtime': int(st.st_mtime)
                    })
            items.sort(key=lambda x: x.get('mtime', 0), reverse=True)
            total = len(items)
            start = (page - 1) * page_size
            end = start + page_size
            slice_items = items[start:end]
            # Render minimal rows HTML to match admin logs table structure
            html_rows = []
            for it in slice_items:
                size_kb = f"{round(it['size']/1024, 1)} KB" if it[
                    'size'] < 1024 * 1024 else f"{round(it['size']/1024/1024, 1)} MB"
                html_rows.append(
                    f"<tr class=\"table__body_row logs-row\" data-name=\"{it['name']}\"><td class=\"table__body_item\">{it['name']}</td><td class=\"table__body_item text-end\">{size_kb}</td></tr>"
                )
            html = ''.join(html_rows)
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

    @app.route('/admin/logs/search', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_logs_search():
        """Search logs by filename; returns HTML rows and meta."""
        try:
            # os used from top-level imports
            q = (request.args.get('q') or '').strip()
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 50))
            if page < 1: page = 1
            if page_size < 1: page_size = 50
            logs_dir = os.path.join(app.root_path, 'logs')
            items = []
            if os.path.isdir(logs_dir):
                for name in os.listdir(logs_dir):
                    if name.startswith('.'): continue
                    if q and (q.lower() not in name.lower()): continue
                    full = os.path.join(logs_dir, name)
                    if not os.path.isfile(full): continue
                    st = os.stat(full)
                    items.append({
                        'name': name,
                        'size': int(st.st_size),
                        'mtime': int(st.st_mtime)
                    })
            items.sort(key=lambda x: x.get('mtime', 0), reverse=True)
            total = len(items)
            start = (page - 1) * page_size
            end = start + page_size
            slice_items = items[start:end]
            html_rows = []
            for it in slice_items:
                size_kb = f"{round(it['size']/1024, 1)} KB" if it[
                    'size'] < 1024 * 1024 else f"{round(it['size']/1024/1024, 1)} MB"
                html_rows.append(
                    f"<tr class=\"table__body_row logs-row\" data-name=\"{it['name']}\"><td class=\"table__body_item\">{it['name']}</td><td class=\"table__body_item text-end\">{size_kb}</td></tr>"
                )
            html = ''.join(html_rows)
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

    # --- Redis-optimized presence endpoint ---
    @app.route('/admin/presence/redis', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_presence_redis():
        """Return JSON with currently connected users from Redis cache."""
        try:
            if not hasattr(app, 'redis_client') or not app.redis_client:
                return jsonify({
                    'status': 'error',
                    'message': 'Redis not available'
                }), 503

            # Get presence data from Redis
            presence_data = app.redis_client.hgetall('presence:users')

            # Filter active users (last 30 seconds)
            active_users = []
            cutoff_time = int(
                datetime.utcnow().timestamp() * 1000) - 30000  # 30 seconds ago

            for key, value in presence_data.items():
                try:
                    import json
                    user_data = json.loads(value)
                    last_seen = user_data.get('lastSeen', 0)

                    # Only include users active in last 30 seconds
                    if last_seen > cutoff_time:
                        active_users.append({
                            'user':
                            user_data.get('user', 'Неизвестно'),
                            'ip':
                            user_data.get('ip', 'Неизвестно'),
                            'ua':
                            user_data.get('ua', 'Неизвестно'),
                            'page':
                            user_data.get('page', 'Неизвестно'),
                            'lastSeen':
                            last_seen
                        })
                except Exception:
                    continue

            return jsonify({
                'status':
                'success',
                'items':
                active_users,
                'source':
                'redis',
                'timestamp':
                int(datetime.utcnow().timestamp() * 1000),
                'count':
                len(active_users)
            })
        except Exception as e:
            _log.error(f"Redis presence error: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Redis-optimized sessions endpoint ---
    @app.route('/admin/sessions/redis', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_sessions_redis():
        """Return JSON with active sessions from Redis cache."""
        try:
            if not hasattr(app, 'redis_client') or not app.redis_client:
                return jsonify({
                    'status': 'error',
                    'message': 'Redis not available'
                }), 503

            # Get sessions data from Redis
            sessions_data = app.redis_client.hgetall('sessions:active')

            sessions = []
            for key, value in sessions_data.items():
                try:
                    import json
                    session_data = json.loads(value)
                    sessions.append({
                        'sid':
                        session_data.get('sid', key),
                        'session_id':
                        session_data.get('sid', key),
                        'user':
                        session_data.get('user', 'Неизвестно'),
                        'ip':
                        session_data.get('ip', 'Неизвестно'),
                        'ua':
                        session_data.get('ua', 'Неизвестно'),
                        'last_activity':
                        session_data.get('last_activity', 0)
                    })
                except Exception:
                    continue

            return jsonify({
                'status':
                'success',
                'items':
                sessions,
                'source':
                'redis',
                'timestamp':
                int(datetime.utcnow().timestamp() * 1000),
                'count':
                len(sessions)
            })
        except Exception as e:
            _log.error(f"Redis sessions error: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Redis heartbeat endpoint ---
    @app.route('/api/heartbeat', methods=['POST'])
    def api_heartbeat():
        """Update user heartbeat in Redis for admin panel optimization."""
        try:
            # Only for authenticated users
            is_auth_attr = getattr(current_user, 'is_authenticated', False)
            try:
                is_authenticated = bool(
                    is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
            except Exception:
                is_authenticated = False
            if not is_authenticated:
                return jsonify({
                    'status': 'error',
                    'message': 'Unauthorized'
                }), 401

            if not hasattr(app, 'redis_client') or not app.redis_client:
                return jsonify({
                    'status': 'error',
                    'message': 'Redis not available'
                }), 503

            data = request.get_json(silent=True) or {}
            user = getattr(current_user, 'name', None) or 'unknown'
            uid = getattr(current_user, 'id', None)
            ip = request.headers.get(
                'X-Forwarded-For',
                '').split(',')[0].strip() or request.remote_addr
            page = data.get('page', '')
            ua = request.headers.get('User-Agent', '')

            # Only update presence for real pages, not API endpoints or background requests
            # Prepare default user_data to avoid UnboundLocalError in emit
            user_data = {
                'user': user,
                'ip': ip,
                'ua': ua,
                'page': page,
                'lastSeen': int(datetime.utcnow().timestamp() * 1000)
            }
            if page and is_real_page(page):
                user_key = f"{user}|{ip}"
                import json
                # Update full payload when page is real and provided
                app.redis_client.hset('presence:users', user_key, json.dumps(user_data))
                # Increase TTL to 300 seconds to reduce flapping
                app.redis_client.expire('presence:users', 300)
            else:
                # Only bump lastSeen if an entry already exists; do not overwrite page
                try:
                    user_key = f"{user}|{ip}"
                    raw = app.redis_client.hget('presence:users', user_key)
                    if raw:
                        import json
                        try:
                            obj = json.loads(raw)
                        except Exception:
                            obj = {}
                        obj['lastSeen'] = user_data.get('lastSeen')
                        app.redis_client.hset('presence:users', user_key, json.dumps(obj))
                        app.redis_client.expire('presence:users', 300)
                except Exception:
                    pass

            # Send real-time update to admin room
            if socketio:
                socketio.emit('admin:presence:update', {
                    'type': 'user_activity',
                    'user': user,
                    'ip': ip,
                    'ua': ua,
                    'page': page,
                    'lastSeen': user_data.get('lastSeen')
                },
                              room='admin')

            return jsonify({'status': 'success'})
        except Exception as e:
            _log.error(f"Heartbeat error: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Presence: list active sessions ---
    @app.route('/admin/presence', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_presence():
        """Return JSON with currently connected users.

        Uses a short-lived Redis snapshot to avoid inconsistent views and flapping.
        """
        try:
            # Serve recent cached snapshot if available (<=2s)
            if hasattr(app, 'redis_client') and app.redis_client:
                rc = app.redis_client
                try:
                    import json as _json, time as _time
                    ts_key = 'presence:view:ts'
                    snap_key = 'presence:view:snapshot'
                    ts_v = rc.get(ts_key)
                    if ts_v is not None:
                        try:
                            ts_v = int(ts_v)
                        except Exception:
                            ts_v = 0
                        if int(_time.time()) - int(ts_v or 0) <= 2:
                            snap = rc.get(snap_key)
                            if snap:
                                try:
                                    payload = _json.loads(snap)
                                    if isinstance(payload, dict) and 'items' in payload:
                                        return jsonify(payload)
                                except Exception:
                                    pass
                except Exception:
                    pass

                # Build fresh snapshot from multiple sources
                now_ms = int(datetime.utcnow().timestamp() * 1000)
                rows = []
                # Source 1: Redis hash presence:users
                try:
                    pmap = rc.hgetall('presence:users') or {}
                    for _, v in pmap.items():
                        try:
                            import json
                            obj = json.loads(v)
                            if not isinstance(obj, dict):
                                continue
                            rows.append({
                                'user': obj.get('user'),
                                'ip': obj.get('ip'),
                                'ua': obj.get('ua'),
                                'page': obj.get('page'),
                                'updated_at': int(obj.get('lastSeen') or 0),
                            })
                        except Exception:
                            continue
                except Exception:
                    pass
                # Source 2: in-memory socket presence
                try:
                    presence = getattr(app, '_presence', {}) or {}
                    for _, info in presence.items():
                        try:
                            rows.append({
                                'user': info.get('user'),
                                'ip': info.get('ip'),
                                'ua': info.get('ua'),
                                'page': info.get('page'),
                                'updated_at': int(info.get('updated_at') or 0),
                            })
                        except Exception:
                            continue
                except Exception:
                    pass
                # Source 3: in-memory heartbeat buffer
                try:
                    presence_hb = getattr(app, '_presence_hb', {}) or {}
                    for _, info in presence_hb.items():
                        try:
                            rows.append({
                                'user': info.get('user'),
                                'ip': info.get('ip'),
                                'ua': info.get('ua'),
                                'page': info.get('page'),
                                'updated_at': int(info.get('updated_at') or 0),
                            })
                        except Exception:
                            continue
                except Exception:
                    pass
                # Deduplicate by user+ip+ua(short)
                unique = {}
                for r in rows:
                    user = (r.get('user') or '').strip()
                    ip = (r.get('ip') or '').strip()
                    ua = (r.get('ua') or '').strip()[:64]
                    if not user or not ip:
                        continue
                    key = f"{user}:{ip}:{ua}"
                    prev = unique.get(key)
                    if (not prev) or int(r.get('updated_at') or 0) >= int(prev.get('updated_at') or 0):
                        unique[key] = r
                items_now = list(unique.values())
                # Grace period: include items from previous snapshot seen within last 15s
                try:
                    import json as _json
                    prev_snap_raw = rc.get('presence:view:snapshot')
                    if prev_snap_raw:
                        prev = _json.loads(prev_snap_raw)
                        prev_items = prev.get('items') if isinstance(prev, dict) else []
                        idx = { f"{(r.get('user') or '').strip()}:{(r.get('ip') or '').strip()}:{((r.get('ua') or '').strip()[:64])}": True for r in items_now }
                        for r in (prev_items or []):
                            try:
                                user = (r.get('user') or '').strip()
                                ip = (r.get('ip') or '').strip()
                                ua = (r.get('ua') or '').strip()[:64]
                                key = f"{user}:{ip}:{ua}"
                                if key in idx:
                                    continue
                                ts = int(r.get('updated_at') or 0)
                                if ts and (now_ms - ts) <= (15 * 1000):
                                    items_now.append(r)
                            except Exception:
                                continue
                except Exception:
                    pass
                # Sort and store snapshot
                items_now.sort(key=lambda r: r.get('updated_at') or 0, reverse=True)
                payload = {'status': 'success', 'items': items_now}
                try:
                    import json as _json, time as _time
                    rc.set('presence:view:snapshot', _json.dumps(payload, ensure_ascii=False), ex=5)
                    rc.set('presence:view:ts', int(_time.time()), ex=5)
                except Exception:
                    pass
                return jsonify(payload)

            # Fallback (no Redis): combine in-memory sources with grace
            presence = getattr(app, '_presence', {}) or {}
            presence_hb = getattr(app, '_presence_hb', {}) or {}
            now_ts = int(datetime.utcnow().timestamp())
            rows = []
            for _, info in presence.items():
                try:
                    rows.append({
                        'user': info.get('user'), 'ip': info.get('ip'), 'ua': info.get('ua'), 'page': info.get('page'), 'updated_at': int(info.get('updated_at') or 0)
                    })
                except Exception:
                    pass
            for _, info in presence_hb.items():
                try:
                    rows.append({
                        'user': info.get('user'), 'ip': info.get('ip'), 'ua': info.get('ua'), 'page': info.get('page'), 'updated_at': int(info.get('updated_at') or 0)
                    })
                except Exception:
                    pass
            # Deduplicate
            unique = {}
            for r in rows:
                key = f"{(r.get('user') or '').strip()}:{(r.get('ip') or '').strip()}:{((r.get('ua') or '').strip()[:64])}"
                prev = unique.get(key)
                if (not prev) or int(r.get('updated_at') or 0) >= int(prev.get('updated_at') or 0):
                    unique[key] = r
            items = list(unique.values())
            items.sort(key=lambda r: r.get('updated_at') or 0, reverse=True)
            return jsonify({'status': 'success', 'items': items})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Active sessions (HTTP sessions not yet expired) ---
    @app.route('/admin/sessions', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_sessions():
        """Return JSON with active sessions tracked via middleware (best-effort)."""
        try:
            debug_flag = (request.args.get('debug') or '').strip() in ('1','true','yes')
            dbg = {'index_count': 0, 'ttl_union_count': 0, 'items_count': 0}
            # Try Redis (cookie sessions with TTL) first if available
            if hasattr(app, 'redis_client') and app.redis_client:
                try:
                    rc = app.redis_client
                    # Serve recent cached snapshot to avoid inconsistent scans
                    try:
                        import json as _json
                        import time as _time
                        ts_key = 'sessions:view:ts'
                        snap_key = 'sessions:view:snapshot'
                        ts_v = rc.get(ts_key)
                        if ts_v is not None:
                            try:
                                ts_v = int(ts_v)
                            except Exception:
                                ts_v = 0
                            now_s = int(_time.time())
                            if now_s - int(ts_v or 0) <= 2:  # 2 seconds cache
                                snap = rc.get(snap_key)
                                if snap:
                                    try:
                                        payload = _json.loads(snap)
                                        if isinstance(payload, dict) and 'items' in payload:
                                            if debug_flag:
                                                payload['debug'] = {'cached': True}
                                            return jsonify(payload)
                                    except Exception:
                                        pass
                    except Exception:
                        pass
                    sids_raw = rc.smembers('sessions:cookie:index') or set()
                    # Normalize to a mutable set of decoded strings
                    sids = set()
                    try:
                        for _sid in sids_raw:
                            if isinstance(_sid, bytes):
                                sids.add(_sid.decode('utf-8', errors='ignore'))
                            else:
                                sids.add(str(_sid))
                    except Exception:
                        # Fallback: ensure it's at least a set
                        try:
                            sids = set(sids_raw)
                        except Exception:
                            sids = set()
                    dbg['index_count'] = len(sids)
                    # Always union with TTL beacons to include inactive-but-unexpired sessions
                    try:
                        if hasattr(rc, 'scan_iter'):
                            for key in rc.scan_iter(match='sessions:cookie:ttl:*', count=200):
                                try:
                                    # key format: sessions:cookie:ttl:{sid}
                                    if isinstance(key, bytes):
                                        key_str = key.decode('utf-8', errors='ignore')
                                    else:
                                        key_str = str(key)
                                    sid = key_str.split(':', 3)[-1]
                                    if sid:
                                        sids.add(sid)
                                except Exception:
                                    continue
                        else:
                            # Fallback to KEYS if scan_iter is unavailable
                            keys = rc.keys('sessions:cookie:ttl:*') or []
                            for key in keys:
                                try:
                                    key_str = key.decode('utf-8', errors='ignore') if isinstance(key, bytes) else str(key)
                                    sid = key_str.split(':', 3)[-1]
                                    if sid:
                                        sids.add(sid)
                                except Exception:
                                    continue
                    except Exception:
                        pass
                    dbg['ttl_union_count'] = len(sids)

                    # Union with Flask-Session storage keys (survive app restarts)
                    try:
                        sess_prefix = app.config.get('SESSION_KEY_PREFIX', 'znf:session:') or 'znf:session:'
                        patt = f"{sess_prefix}*"
                        if hasattr(rc, 'scan_iter'):
                            for skey in rc.scan_iter(match=patt, count=200):
                                try:
                                    kstr = skey.decode('utf-8', errors='ignore') if isinstance(skey, bytes) else str(skey)
                                    # sid is suffix after prefix
                                    if kstr.startswith(sess_prefix):
                                        sid = kstr[len(sess_prefix):]
                                        if sid:
                                            sids.add(sid)
                                except Exception:
                                    continue
                        else:
                            keys = rc.keys(patt) or []
                            for skey in keys:
                                try:
                                    kstr = skey.decode('utf-8', errors='ignore') if isinstance(skey, bytes) else str(skey)
                                    if kstr.startswith(sess_prefix):
                                        sid = kstr[len(sess_prefix):]
                                        if sid:
                                            sids.add(sid)
                                except Exception:
                                    continue
                    except Exception:
                        pass
                    import time as _time
                    items = []
                    # Fetch meta and TTLs in a single pipeline for reliability/performance
                    sids_list = []
                    for sid in sids:
                        if isinstance(sid, bytes):
                            try:
                                sid = sid.decode('utf-8', errors='ignore')
                            except Exception:
                                sid = str(sid)
                        sids_list.append(sid)

                    try:
                        pipe = rc.pipeline()
                        sess_prefix = app.config.get('SESSION_KEY_PREFIX', 'znf:session:') or 'znf:session:'
                        for sid in sids_list:
                            pipe.hgetall(f'sessions:cookie:{sid}')
                            pipe.ttl(f'sessions:cookie:ttl:{sid}')
                            pipe.ttl(f'{sess_prefix}{sid}')
                        bulk = pipe.execute() if sids_list else []
                    except Exception:
                        bulk = []

                    # Build items from pipeline results (triples per sid)
                    for idx, sid in enumerate(sids_list):
                        try:
                            base = idx * 3
                            meta = (bulk[base] if base < len(bulk) else {}) or {}
                            ttl_cookie = bulk[base + 1] if (base + 1) < len(bulk) else -1
                            ttl_store = bulk[base + 2] if (base + 2) < len(bulk) else -1
                            # Normalize types
                            def _ival(v, d=0):
                                try:
                                    if isinstance(v, bytes):
                                        v = v.decode('utf-8', errors='ignore')
                                    return int(v)
                                except Exception:
                                    return d
                            def _sval(v, d=''):
                                try:
                                    if isinstance(v, bytes):
                                        return v.decode('utf-8', errors='ignore')
                                    return str(v)
                                except Exception:
                                    return d
                            item = {
                                'sid': sid,
                                'session_id': sid,
                                'user_id': _sval(meta.get('user_id')) or None,
                                'user': _sval(meta.get('user'), 'Неизвестно'),
                                'ip': _sval(meta.get('ip'), 'Неизвестно'),
                                'ua': _sval(meta.get('ua'), 'Неизвестно'),
                                'created_at': _ival(meta.get('created_at')), 
                                'last_seen': _ival(meta.get('last_seen')),
                                'last_activity': _ival(meta.get('last_seen')),
                                'ttl_seconds': ttl_cookie if isinstance(ttl_cookie, int) and ttl_cookie >= 0 else (ttl_store if isinstance(ttl_store, int) else -1),
                            }
                            # If TTL unknown/negative, estimate from created_at/last_seen and configured lifetime
                            try:
                                if not isinstance(item['ttl_seconds'], int) or item['ttl_seconds'] < 0:
                                    # Resolve lifetime
                                    lifetime_s = 1800
                                    try:
                                        from datetime import timedelta as _td
                                        cfg_life = app.config.get('PERMANENT_SESSION_LIFETIME')
                                        if isinstance(cfg_life, _td):
                                            lifetime_s = int(cfg_life.total_seconds())
                                        else:
                                            lifetime_s = int(cfg_life or 1800)
                                    except Exception:
                                        try:
                                            lifetime_s = int(app._sql.config.get('web', 'session_lifetime', fallback='1800'))
                                        except Exception:
                                            lifetime_s = 1800
                                    now_s = int(_time.time())
                                    if item['created_at']:
                                        eta = (int(item['created_at']) + int(lifetime_s)) - now_s
                                    else:
                                        # Fallback: estimate from last_seen when created_at is missing
                                        ls = int(item.get('last_seen') or 0)
                                        eta = (ls + int(lifetime_s)) - now_s if ls else -1
                                    if eta < 0:
                                        eta = 0
                                    item['ttl_seconds'] = int(eta)
                            except Exception:
                                pass
                            # If last_seen is missing/zero, try legacy store sessions:active
                            if not item['last_seen']:
                                try:
                                    sa = rc.hget('sessions:active', sid)
                                    if sa:
                                        import json as _json
                                        sd = _json.loads(sa)
                                        la = sd.get('last_activity') or sd.get('last_seen') or 0
                                        try:
                                            la = int(la)
                                        except Exception:
                                            la = 0
                                        if la:
                                            item['last_seen'] = la
                                            item['last_activity'] = la
                                except Exception:
                                    pass
                            items.append(item)
                        except Exception:
                            continue
                    # Always union with legacy hash for backward compatibility
                    try:
                        sessions_data = rc.hgetall('sessions:active') or {}
                        # Avoid duplicates by sid
                        present = { (it.get('sid') or it.get('session_id')) for it in items }
                        for key, value in sessions_data.items():
                            try:
                                import json
                                session_data = json.loads(value)
                                sid_legacy = session_data.get('sid', key)
                                if sid_legacy in present:
                                    continue
                                items.append({
                                    'sid': sid_legacy,
                                    'session_id': sid_legacy,
                                    'user_id': session_data.get('user_id'),
                                    'user': session_data.get('user', 'Неизвестно'),
                                    'ip': session_data.get('ip', 'Неизвестно'),
                                    'ua': session_data.get('ua', 'Неизвестно'),
                                    'created_at': int(session_data.get('created_at', 0)),
                                    'last_seen': int(session_data.get('last_activity', 0)),
                                    'ttl_seconds': -1,
                                })
                            except Exception:
                                continue
                    except Exception:
                        pass
                    # Always union with Flask-Session store keys (survive restarts)
                    try:
                        sess_prefix = app.config.get('SESSION_KEY_PREFIX', 'znf:session:') or 'znf:session:'
                        keys = []
                        if hasattr(rc, 'scan_iter'):
                            keys = [k for k in rc.scan_iter(match=f'{sess_prefix}*', count=200)]
                        else:
                            keys = rc.keys(f'{sess_prefix}*') or []
                        present = { (it.get('sid') or it.get('session_id')) for it in items }
                        for skey in keys:
                            try:
                                kstr = skey.decode('utf-8', errors='ignore') if isinstance(skey, bytes) else str(skey)
                                if not kstr.startswith(sess_prefix):
                                    continue
                                sid2 = kstr[len(sess_prefix):]
                                if not sid2 or sid2 in present:
                                    continue
                                ttl_s = rc.ttl(kstr)
                                # Approximate created_at from ttl if lifetime known
                                lifetime_s = 1800
                                try:
                                    from datetime import timedelta as _td
                                    cfg_life = app.config.get('PERMANENT_SESSION_LIFETIME')
                                    if isinstance(cfg_life, _td):
                                        lifetime_s = int(cfg_life.total_seconds())
                                    else:
                                        lifetime_s = int(cfg_life or 1800)
                                except Exception:
                                    try:
                                        lifetime_s = int(app._sql.config.get('web', 'session_lifetime', fallback='1800'))
                                    except Exception:
                                        lifetime_s = 1800
                                created_guess = 0
                                try:
                                    if isinstance(ttl_s, int) and ttl_s >= 0:
                                        created_guess = int(_time.time()) - max(0, (lifetime_s - ttl_s))
                                except Exception:
                                    created_guess = 0
                                # Compute ttl even when store key has no TTL (-1)
                                try:
                                    if not (isinstance(ttl_s, int) and ttl_s >= 0):
                                        if created_guess:
                                            ttl_s = max(0, int(lifetime_s - (int(_time.time()) - int(created_guess))))
                                        else:
                                            ttl_s = max(0, int(lifetime_s))  # best-effort when no timestamps
                                except Exception:
                                    ttl_s = -1
                                items.append({
                                    'sid': sid2,
                                    'session_id': sid2,
                                    'user_id': None,
                                    'user': 'Неизвестно',
                                    'ip': 'Неизвестно',
                                    'ua': 'Неизвестно',
                                    'created_at': created_guess,
                                    'last_seen': created_guess,
                                    'last_activity': created_guess,
                                    'ttl_seconds': ttl_s if isinstance(ttl_s, int) else -1,
                                })
                            except Exception:
                                continue
                    except Exception:
                        pass

                    # Union with in-memory sessions to avoid dropping inactive-but-unexpired
                    try:
                        mem_sessions = getattr(app, '_sessions', {}) or {}
                        if mem_sessions:
                            # Build a map for dedup by sid
                            idx = { (it.get('sid') or it.get('session_id')): it for it in items }
                            for msid, minfo in mem_sessions.items():
                                if msid in idx: continue
                                try:
                                    items.append({
                                        'sid': msid,
                                        'session_id': msid,
                                        'user_id': minfo.get('user_id'),
                                        'user': minfo.get('user') or 'Неизвестно',
                                        'ip': minfo.get('ip') or 'Неизвестно',
                                        'ua': minfo.get('ua') or 'Неизвестно',
                                        'created_at': int(minfo.get('created_at') or 0),
                                        'last_seen': int(minfo.get('last_seen') or 0),
                                        'last_activity': int(minfo.get('last_seen') or 0),
                                        'ttl_seconds': idx.get(msid, {}).get('ttl_seconds', -1),
                                    })
                                except Exception:
                                    continue
                    except Exception:
                        pass

                    # Sort by last_seen desc
                    items.sort(key=lambda r: r.get('last_seen') or 0, reverse=True)
                    dbg['items_count'] = len(items)
                    if debug_flag:
                        try:
                            _log.info("/admin/sessions debug: index=%s ttl_union=%s items=%s sample=%s",
                                      dbg.get('index_count'), dbg.get('ttl_union_count'), dbg.get('items_count'),
                                      items[0:3])
                        except Exception:
                            pass
                    payload = {'status': 'success', 'items': items}
                    if debug_flag:
                        payload['debug'] = dbg
                    # Store snapshot for short time to stabilize view
                    try:
                        import json as _json
                        import time as _time
                        rc.set('sessions:view:snapshot', _json.dumps(payload, ensure_ascii=False), ex=5)
                        rc.set('sessions:view:ts', int(_time.time()), ex=5)
                    except Exception:
                        pass
                    return jsonify(payload)
                except Exception as e:
                    _log.warning(f"Redis sessions fallback: {e}")

            # Fallback to in-memory sessions
            sessions = getattr(app, '_sessions', {}) or {}
            # Prune expired sessions based on configured lifetime to avoid showing stale rows
            try:
                from datetime import timedelta
                lifetime = app.config.get('PERMANENT_SESSION_LIFETIME')
                if isinstance(lifetime, timedelta):
                    max_age = int(lifetime.total_seconds())
                else:
                    max_age = int(lifetime or 31 * 24 * 3600)
            except Exception:
                max_age = 31 * 24 * 3600
            cutoff = time.time() - max_age
            for k, v in list(sessions.items()):
                try:
                    if float(v.get('last_seen') or 0) < cutoff:
                        app._sessions.pop(k, None)
                except Exception:
                    pass
            items = []
            for sid, info in sessions.items():
                try:
                    items.append({
                        'sid':
                        sid,
                        'user_id':
                        info.get('user_id'),
                        'user':
                        info.get('user'),
                        'ip':
                        info.get('ip'),
                        'ua':
                        info.get('ua'),
                        'created_at':
                        int(info.get('created_at') or 0),
                        'last_seen':
                        int(info.get('last_seen') or 0),
                        'last_activity':
                        int(info.get('last_seen') or 0)
                    })
                except Exception:
                    pass
            # sort by last_seen desc
            items.sort(key=lambda r: r.get('last_seen') or 0, reverse=True)
            return jsonify({'status': 'success', 'items': items})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Force logout by HTTP session id ---
    @app.route('/admin/force_logout_session', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    @rate_limit
    def admin_force_logout_session():
        """Mark a specific HTTP session id to be forcibly logged out on next request."""
        try:
            sid = (request.json or {}).get('sid') or request.form.get('sid')
            if not sid:
                return jsonify({
                    'status': 'error',
                    'message': 'sid required'
                }), 400
            # Use Redis-based force logout if available
            if hasattr(app,
                       'force_logout_manager') and app.force_logout_manager:
                app.force_logout_manager.add_session_logout(sid)
            else:
                # Fallback to in-memory force logout
                if not hasattr(app, '_force_logout_sessions'):
                    app._force_logout_sessions = set()
                app._force_logout_sessions.add(sid)

            # Capture user id before removing session
            user_id_for_cleanup = None
            try:
                entry = getattr(app, '_sessions', {}).get(sid)
                if entry:
                    user_id_for_cleanup = entry.get('user_id')
            except Exception:
                pass
            # Immediate Redis cleanup of this HTTP session (so it doesn't reappear)
            try:
                if hasattr(app, 'redis_client') and app.redis_client:
                    rc = app.redis_client
                    try:
                        rc.hdel('sessions:active', sid)
                    except Exception:
                        pass
                    try:
                        rc.delete(f'sessions:cookie:{sid}')
                    except Exception:
                        pass
                    try:
                        rc.delete(f'sessions:cookie:ttl:{sid}')
                    except Exception:
                        pass
                    try:
                        rc.srem('sessions:cookie:index', sid)
                    except Exception:
                        pass
                    # Also delete Flask-Session storage key to invalidate server-side session immediately
                    try:
                        sess_prefix = app.config.get('SESSION_KEY_PREFIX', 'znf:session:') or 'znf:session:'
                        rc.delete(f'{sess_prefix}{sid}')
                    except Exception:
                        pass
            except Exception:
                pass
            # Immediately remove from active sessions store for instant UI update
            try:
                if hasattr(app, '_sessions'):
                    app._sessions.pop(sid, None)
            except Exception:
                pass
            # Cleanup presence for this user if we have user_id
            if user_id_for_cleanup:
                if hasattr(app, 'presence_manager') and app.presence_manager:
                    app.presence_manager.remove_user_presence(
                        user_id_for_cleanup)
                else:
                    # Fallback to in-memory presence cleanup
                    try:
                        presence = getattr(app, '_presence', {}) or {}
                        for psid, info in list(presence.items()):
                            try:
                                if int(info.get('user_id')
                                       or -1) == int(user_id_for_cleanup
                                                     or -2):
                                    app._presence.pop(psid, None)
                            except Exception:
                                pass
                        presence_hb = getattr(app, '_presence_hb', {}) or {}
                        prefix = f"hb:{user_id_for_cleanup}:"
                        for key in list(presence_hb.keys()):
                            if isinstance(key, str) and key.startswith(prefix):
                                app._presence_hb.pop(key, None)
                    except Exception:
                        pass
            # Optionally emit a socket event if there is a presence mapping with same user to hint immediate logout
            try:
                if socketio:
                    payload = {
                        'reason': 'admin',
                        'title': 'Сессия завершена',
                        'body':
                        'Сессия разорвана администратором. Войдите снова.'
                    }
                    # We don't know socket room by HTTP session; best-effort: broadcast to user if can be found
                    pass
            except Exception:
                pass
            try:
                log_action('ADMIN_FORCE_LOGOUT_SESSION', current_user.name,
                           f'sid={sid}', (request.remote_addr or ''))
            except Exception:
                pass
            try:
                emit_admin_changed(socketio, 'presence-updated')
            except Exception:
                pass
            return jsonify({'status': 'success'})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Admin Sessions Page (UI) ---
    @app.route('/admin/sessions/view', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_sessions_view():
        try:
            return render_template('admin_sessions.j2.html')
        except Exception as e:
            app.flash_error(e)
            return render_template('error.j2.html', message=str(e)), 500

    # --- Generic heartbeat for idle tabs (no admin permission required) ---
    @app.route('/presence/heartbeat', methods=['POST'])
    def presence_heartbeat():
        """HTTP heartbeat to track presence for users even when sockets are idle.

		Stores entries keyed by user+ip+ua. Not visible without admin.view; admin endpoint merges both stores.
		"""
        try:
            # Only for authenticated users
            is_auth_attr = getattr(current_user, 'is_authenticated', False)
            try:
                is_authenticated = bool(
                    is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
            except Exception:
                is_authenticated = False
            if not is_authenticated:
                return jsonify({
                    'status': 'error',
                    'message': 'Unauthorized'
                }), 401
            data = request.get_json(silent=True) or {}
            user = getattr(current_user, 'name', None) or 'unknown'
            uid = getattr(current_user, 'id', None)
            ip = request.headers.get(
                'X-Forwarded-For',
                '').split(',')[0].strip() or request.remote_addr
            page = data.get('page')
            ua = request.headers.get('User-Agent', '')
            key = f"hb:{uid}:{ip}:{(ua or '')[:24]}"
            if not hasattr(app, '_presence_hb'):
                app._presence_hb = {}
            app._presence_hb[key] = {
                'user': user,
                'user_id': uid,
                'ip': ip,
                'page': page,
                'ua': ua,
                'updated_at': int(datetime.utcnow().timestamp())
            }
            return jsonify({'status': 'success'})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Explicit leave endpoint to drop presence immediately ---
    @app.route('/presence/leave', methods=['POST'])
    def presence_leave():
        """Immediately remove current user's presence entries (socket+heartbeat)."""
        try:
            # Auth check similar to heartbeat
            is_auth_attr = getattr(current_user, 'is_authenticated', False)
            try:
                is_authenticated = bool(
                    is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
            except Exception:
                is_authenticated = False
            if not is_authenticated:
                return jsonify({
                    'status': 'error',
                    'message': 'Unauthorized'
                }), 401
            uid = getattr(current_user, 'id', None)
            ip = request.headers.get(
                'X-Forwarded-For',
                '').split(',')[0].strip() or request.remote_addr
            ua = request.headers.get('User-Agent', '')
            # Remove all socket-based presence entries for this user
            try:
                presence = getattr(app, '_presence', {}) or {}
                for psid, info in list(presence.items()):
                    if int(info.get('user_id') or -1) == int(uid or -2):
                        app._presence.pop(psid, None)
            except Exception:
                pass
            # Remove heartbeat entry for this user/ip/ua key
            try:
                presence_hb = getattr(app, '_presence_hb', {}) or {}
                key_prefix = f"hb:{uid}:{ip}:"
                for k in list(presence_hb.keys()):
                    if k.startswith(key_prefix):
                        app._presence_hb.pop(k, None)
            except Exception:
                pass
            return jsonify({'status': 'success'})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Force logout ---
    @app.route('/admin/force_logout', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    @rate_limit
    def admin_force_logout():
        """Force logout a specific Socket.IO session id."""
        try:
            sid = (request.json or {}).get('sid') or request.form.get('sid')
            uid = (request.json
                   or {}).get('user_id') or request.form.get('user_id')
            if not sid and not uid:
                return jsonify({
                    'status': 'error',
                    'message': 'sid required'
                }), 400
            # Emit to specific sid if provided
            if socketio and sid:
                try:
                    payload = {
                        'reason': 'admin',
                        'title': 'Сессия завершена',
                        'body':
                        'Сессия разорвана администратором. Войдите снова.'
                    }
                    socketio.emit('force-logout', payload, room=sid)
                    try:
                        emit_admin_changed(socketio, 'force-logout', sid=sid)
                    except Exception:
                        pass
                except Exception:
                    pass
            # Additionally, emit to all sockets of the user if user_id provided
            if socketio and uid:
                try:
                    uid_int = int(uid)
                    presence = getattr(app, '_presence', {}) or {}
                    payload = {
                        'reason': 'admin',
                        'title': 'Сессия завершена',
                        'body':
                        'Сессия разорвана администратором. Войдите снова.'
                    }
                    for psid, info in list(presence.items()):
                        try:
                            if int(info.get('user_id') or -1) == uid_int:
                                socketio.emit('force-logout',
                                              payload,
                                              room=psid)
                        except Exception:
                            pass
                except Exception:
                    pass
            # Server-side session invalidation hint: set short-lived flag
            try:
                # Track users forced to logout to invalidate cookies in middleware
                if uid:
                    if not hasattr(app, '_force_logout_users'):
                        app._force_logout_users = set()
                    app._force_logout_users.add(int(uid))
            except Exception:
                pass
            # Cleanup presence/heartbeat and sessions store (best-effort)
            try:
                if uid:
                    # purge presence entries by user_id
                    presence = getattr(app, '_presence', {}) or {}
                    for psid, info in list(presence.items()):
                        try:
                            if int(info.get('user_id') or -1) == int(uid):
                                app._presence.pop(psid, None)
                        except Exception:
                            pass
                    # purge heartbeat keys by uid prefix
                    presence_hb = getattr(app, '_presence_hb', {}) or {}
                    prefix = f"hb:{uid}:"
                    for key in list(presence_hb.keys()):
                        if isinstance(key, str) and key.startswith(prefix):
                            app._presence_hb.pop(key, None)
                # if sid provided, drop from sessions immediately
                if sid and hasattr(app, '_sessions'):
                    app._sessions.pop(sid, None)
            except Exception:
                pass
            try:
                log_action('ADMIN_FORCE_LOGOUT', current_user.name,
                           f'sid={sid} uid={uid}', (request.remote_addr or ''))
            except Exception:
                pass
            return jsonify({'status': 'success'})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Force logout ALL sessions ---
    @app.route('/admin/force_logout_all', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    @rate_limit
    def admin_force_logout_all():
        """Force logout all currently tracked sessions and mark all users to re-login."""
        try:
            count = 0
            payload = {
                'reason': 'admin',
                'title': 'Сессия завершена',
                'body': 'Сессия разорвана администратором. Войдите снова.'
            }
            if socketio:
                try:
                    # Send force-logout to all users from in-memory presence
                    presence = getattr(app, '_presence', {}) or {}
                    for psid in list(presence.keys()):
                        try:
                            socketio.emit('force-logout', payload, room=psid)
                            try:
                                emit_admin_changed(socketio,
                                                   'force-logout',
                                                   sid=psid)
                            except Exception:
                                pass
                            count += 1
                        except Exception:
                            pass

                    # Also send force-logout to all users from Redis presence
                    if hasattr(app, 'redis_client') and app.redis_client:
                        try:
                            presence_data = app.redis_client.hgetall(
                                'presence:users')
                            for key, value in presence_data.items():
                                try:
                                    import json
                                    user_data = json.loads(value)
                                    user = user_data.get('user', '')
                                    ip = user_data.get('ip', '')
                                    if user and ip:
                                        # Create a unique room for this user+ip combination
                                        user_room = f"user:{user}:{ip}"
                                        socketio.emit('force-logout',
                                                      payload,
                                                      room=user_room)
                                        socketio.emit(
                                            'force-logout', payload, room=user
                                        )  # Also try user-only room
                                        count += 1
                                except Exception:
                                    continue
                        except Exception:
                            pass

                    # Send force-logout to all common rooms that users might be in
                    common_rooms = [
                        'users', 'groups', 'files', 'admin', 'categories',
                        'registrators', 'index'
                    ]
                    for room in common_rooms:
                        try:
                            socketio.emit('force-logout', payload, room=room)
                        except Exception:
                            pass
                except Exception:
                    pass
            # mark server-side flag for all known users (best-effort) and clear sessions/presence stores
            try:
                if not hasattr(app, '_force_logout_users'):
                    app._force_logout_users = set()
                presence = getattr(app, '_presence', {}) or {}
                for info in list(presence.values()):
                    uid = info.get('user_id')
                    if uid is not None:
                        try:
                            app._force_logout_users.add(int(uid))
                        except Exception:
                            pass
                # Clear tracked HTTP sessions immediately so UI updates at once
                try:
                    if hasattr(app, '_sessions'):
                        app._sessions.clear()
                except Exception:
                    pass
                # Clear presence and heartbeat stores
                try:
                    if hasattr(app, '_presence'):
                        app._presence.clear()
                    if hasattr(app, '_presence_hb'):
                        app._presence_hb.clear()
                except Exception:
                    pass
                # Clear Redis data
                try:
                    if hasattr(app, 'redis_client') and app.redis_client:
                        app.redis_client.delete('presence:users')
                        app.redis_client.delete('sessions:active')
                except Exception:
                    pass
                # Notify admin room about force logout
                if socketio:
                    try:
                        socketio.emit('admin:force_logout_all', {
                            'type': 'all_sessions_terminated',
                            'count': count
                        },
                                      room='admin')
                    except Exception:
                        pass
            except Exception:
                pass
            try:
                log_action('ADMIN_FORCE_LOGOUT_ALL', current_user.name,
                           f'count={count}', (request.remote_addr or ''))
            except Exception:
                pass
            return jsonify({'status': 'success', 'count': count})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/admin/force_refresh_all', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    @rate_limit
    def admin_force_refresh_all():
        """Force refresh all pages (hard refresh) for all users."""
        try:
            count = 0
            payload = {
                'reason': 'admin',
                'title': 'Обновление страницы',
                'body': 'Администратор принудительно обновил все страницы.'
            }

            if socketio:
                try:
                    # Send force-refresh to all users from in-memory presence
                    presence = getattr(app, '_presence', {}) or {}
                    for psid in list(presence.keys()):
                        try:
                            socketio.emit('force-refresh', payload, room=psid)
                            count += 1
                            print(
                                f"Sent force-refresh to presence session: {psid}"
                            )
                        except Exception as e:
                            print(
                                f"Failed to send force-refresh to {psid}: {e}")
                            pass

                    # Also send force-refresh to all users from Redis presence
                    if hasattr(app, 'redis_client') and app.redis_client:
                        try:
                            presence_data = app.redis_client.hgetall(
                                'presence:users')
                            for key, value in presence_data.items():
                                try:
                                    import json
                                    user_data = json.loads(value)
                                    user = user_data.get('user', '')
                                    ip = user_data.get('ip', '')
                                    if user and ip:
                                        # Create a unique room for this user+ip combination
                                        user_room = f"user:{user}:{ip}"
                                        socketio.emit('force-refresh',
                                                      payload,
                                                      room=user_room)
                                        socketio.emit(
                                            'force-refresh',
                                            payload,
                                            room=user
                                        )  # Also try user-only room
                                        count += 1
                                        print(
                                            f"Sent force-refresh to Redis user: {user} ({ip})"
                                        )
                                except Exception as e:
                                    print(
                                        f"Failed to process Redis user {key}: {e}"
                                    )
                                    continue
                        except Exception as e:
                            print(f"Failed to get Redis presence data: {e}")
                            pass

                    # Send force-refresh to all common rooms that users might be in
                    common_rooms = [
                        'users', 'groups', 'files', 'admin', 'categories',
                        'registrators', 'index'
                    ]
                    for room in common_rooms:
                        try:
                            socketio.emit('force-refresh', payload, room=room)
                            print(f"Sent force-refresh to common room: {room}")
                        except Exception as e:
                            print(
                                f"Failed to send force-refresh to room {room}: {e}"
                            )
                            pass
                except Exception:
                    pass

            try:
                log_action('ADMIN_FORCE_REFRESH_ALL', current_user.name,
                           f'count={count}', (request.remote_addr or ''))
            except Exception:
                pass

            return jsonify({'status': 'success', 'count': count})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Send message via push ---
    @app.route('/admin/send_message', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    @rate_limit
    def admin_send_message():
        """Send a browser notification to a user, group, or everyone."""
        try:
            target = (request.json or {}).get('target') or request.form.get('target')
            message = ((request.json or {}).get('message') or request.form.get('message') or '').strip()
            if not message:
                return jsonify({'status': 'error', 'message': 'Текст сообщения пуст'}), 400
            try:
                log_action('ADMIN_PUSH_REQUEST', current_user.name, f'target={target} text_len={len(message)}', (request.remote_addr or ''))
            except Exception:
                pass

            # Prepare unified payload
            payload = {
                'type': 'admin_message',
                'title': 'Сообщение администратора',
                'body': message,
                'icon': '/static/images/notification-icon.png',
                'ts': int(time.time())
            }

            sent_count = 0
            # Queue according to new Redis-based notification system
            if target == 'all':
                _queue_broadcast_notification(payload)
                sent_count = -1  # unknown reach; queued broadcast
            elif isinstance(target, str) and target.startswith('group:'):
                gid = int(target.split(':', 1)[1])
                _queue_group_notification(gid, payload)
                sent_count = -1
            elif isinstance(target, str) and target.startswith('user:'):
                uid = int(target.split(':', 1)[1])
                _queue_user_notification(uid, payload)
                sent_count = 1
            else:
                return jsonify({'status': 'error', 'message': 'Некорректная цель'}), 400

            # Also emit live event for currently connected users (best-effort)
            try:
                if socketio:
                    # Notify admin room about the action
                    socketio.emit('admin:notification', payload, room='admin')
                    # Live deliver only to intended recipients
                    if target == 'all':
                        socketio.emit('notification', payload)
                    elif isinstance(target, str) and target.startswith('user:'):
                        try:
                            uid = int(target.split(':', 1)[1])
                            # Emit to per-user room and try presence-based fallback
                            socketio.emit('notification', payload, room=f'user:{uid}')
                            _emit_notification_to_user_ids([uid], payload)
                        except Exception:
                            pass
                    elif isinstance(target, str) and target.startswith('group:'):
                        try:
                            gid = int(target.split(':', 1)[1])
                            rows = app._sql.execute_query(
                                f"SELECT id FROM {app._sql.config['db']['prefix']}_user WHERE gid=%s AND enabled=1;",
                                [gid]) or []
                            uids = [int(r[0]) for r in rows if r and r[0] is not None]
                            for _uid in uids:
                                try:
                                    socketio.emit('notification', payload, room=f'user:{_uid}')
                                except Exception:
                                    pass
                            _emit_notification_to_user_ids(uids, payload)
                        except Exception:
                            pass
            except Exception:
                pass

            try:
                log_action('ADMIN_PUSH', current_user.name, f'target={target} queued=1 text="{message}"', (request.remote_addr or ''))
            except Exception:
                pass
            return jsonify({'status': 'success', 'queued': True, 'live_emitted': True})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Users list for combobox ---
    @app.route('/admin/users_list', methods=['GET'])
    @require_permissions(ADMIN_MANAGE)
    def admin_users_list():
        """Return list of users for selection (id, name)."""
        try:
            rows = app._sql.execute_query(
                f"SELECT id, name FROM {app._sql.config['db']['prefix']}_user WHERE enabled=1 ORDER BY name;",
                [])
            items = [{'id': r[0], 'name': r[1]} for r in rows or []]
            return jsonify({'status': 'success', 'items': items})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # --- Logs listing and viewing ---
    @app.route('/admin/logs_list', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_logs_list():
        """Return list of files in the logs directory (name, size, mtime)."""
        try:
            logs_dir = path.join(app.root_path, 'logs')
            if not path.isdir(logs_dir):
                return jsonify({'status': 'success', 'items': []})
            items = []
            for name in listdir(logs_dir):
                # skip hidden files and dirs
                if name.startswith('.'):
                    continue
                full = path.join(logs_dir, name)
                if not path.isfile(full):
                    continue
                st = stat(full)
                items.append({
                    'name': name,
                    'size': int(st.st_size),
                    'mtime': int(st.st_mtime),
                })
            # sort by mtime desc
            items.sort(key=lambda x: x.get('mtime', 0), reverse=True)
            return jsonify({'status': 'success', 'items': items})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/admin/logs/view', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_logs_view():
        """Serve a log file as text/plain in a new tab. Prevent path traversal."""
        try:
            name = (request.args.get('name') or '').strip()
            if not name:
                return abort(400)
            # sanitize to basename only
            name = path.basename(name)
            logs_dir = path.join(app.root_path, 'logs')
            full = path.join(logs_dir, name)
            # ensure inside logs dir
            if not full.startswith(path.abspath(logs_dir) + path.sep):
                return abort(403)
            if not path.isfile(full):
                return abort(404)
            with open(full, 'r', encoding='utf-8', errors='replace') as f:
                data = f.read()
            return Response(data, mimetype='text/plain; charset=utf-8')
        except Exception as e:
            app.flash_error(e)
            return Response(str(e),
                            status=500,
                            mimetype='text/plain; charset=utf-8')

    @app.route('/admin/logs/download', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_logs_download():
        """Download a single log file as attachment."""
        try:
            name = (request.args.get('name') or '').strip()
            if not name:
                return abort(400)
            name = path.basename(name)
            logs_dir = path.join(app.root_path, 'logs')
            full = path.join(logs_dir, name)
            if not full.startswith(path.abspath(logs_dir) + path.sep):
                return abort(403)
            if not path.isfile(full):
                return abort(404)
            return send_file(full, as_attachment=True, download_name=name)
        except Exception as e:
            app.flash_error(e)
            return Response(str(e),
                            status=500,
                            mimetype='text/plain; charset=utf-8')

    @app.route('/admin/logs/download_all', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_logs_download_all():
        """Zip all files in logs dir and send as attachment."""
        try:
            logs_dir = path.join(app.root_path, 'logs')
            buf = BytesIO()
            with ZipFile(buf, mode='w', compression=ZIP_DEFLATED) as zf:
                if path.isdir(logs_dir):
                    for name in listdir(logs_dir):
                        if name.startswith('.'): continue
                        full = path.join(logs_dir, name)
                        if not path.isfile(full): continue
                        # Write file into zip under its filename
                        zf.write(full, arcname=name)
            buf.seek(0)
            ts = dt.now().strftime('%Y-%m-%d_%H-%M-%S')
            fname = f'znf-logs-{ts}.zip'
            return send_file(buf,
                             as_attachment=True,
                             download_name=fname,
                             mimetype='application/zip')
        except Exception as e:
            app.flash_error(e)
            return Response(str(e),
                            status=500,
                            mimetype='text/plain; charset=utf-8')

    # Registrators moved to routes/registrators.py

    def jsonify_payload(obj: dict) -> str:
        try:
            import json
            from os import urandom
            return json.dumps({
                **obj, 'id': int(urandom(2).hex(), 16)
            },
                              ensure_ascii=False)
        except Exception:
            return '{"title":"Сообщение","body":""}'

    # --- Socket.IO presence hooks ---
    if socketio:
        presence_store = getattr(app, '_presence', None)
        if presence_store is None:
            app._presence = {}

        @socketio.on('presence:update')
        def presence_update(data):
            try:
                user = getattr(current_user, 'name', None) or 'unknown'
                uid = getattr(current_user, 'id', None)
                # Resolve client IP (respecting reverse proxy headers)
                ip = request.headers.get(
                    'X-Forwarded-For',
                    '').split(',')[0].strip() or request.remote_addr
                page = (data or {}).get('page')
                ua = request.headers.get('User-Agent', '')

                # Presence temporarily disabled
                if not getattr(app.config, 'get', lambda *_: False)(
                        'PRESENCE_DISABLED') and not app.config.get(
                            'PRESENCE_DISABLED'):
                    # Use Redis-based presence if available
                    if hasattr(app,
                               'presence_manager') and app.presence_manager:
                        app.presence_manager.update_presence(
                            request.environ.get('flask_socketio.sid', ''), uid,
                            user, ip, page, ua)
                    else:
                        # Fallback to in-memory presence
                        app._presence[request.environ.get(
                            'flask_socketio.sid', '')] = {
                                'user': user,
                                'user_id': uid,
                                'ip': ip,
                                'page': page,
                                'ua': ua,
                                'updated_at':
                                int(datetime.utcnow().timestamp())
                            }

                # Join per-user room to allow targeted emits
                try:
                    if uid is not None:
                        from flask_socketio import join_room
                        join_room(f'user:{int(uid)}')
                except Exception:
                    pass

                # Notify all listeners that presence changed
                if not app.config.get('PRESENCE_DISABLED'):
                    try:
                        socketio.emit(
                            'presence:changed', {
                                'sid':
                                request.environ.get('flask_socketio.sid', ''),
                                'user':
                                user
                            })
                    except Exception:
                        pass
            except Exception:
                pass

        @socketio.on('disconnect')
        def presence_disconnect():
            try:
                if not app.config.get('PRESENCE_DISABLED'):
                    # Use Redis-based presence if available
                    if hasattr(app,
                               'presence_manager') and app.presence_manager:
                        app.presence_manager.remove_presence(
                            request.environ.get('flask_socketio.sid', ''))
                        # Cleanup stale entries
                        app.presence_manager.cleanup_stale_presence()
                    else:
                        # Fallback to in-memory presence
                        now_ts = int(datetime.utcnow().timestamp())
                        if hasattr(app, '_presence'):
                            stale = [
                                sid for sid, info in app._presence.items()
                                if (now_ts -
                                    int(info.get('updated_at') or 0)) > 60
                            ]
                            for sid in stale:
                                app._presence.pop(sid, None)
                            app._presence.pop(
                                request.environ.get('flask_socketio.sid', ''),
                                None)

                if not app.config.get('PRESENCE_DISABLED'):
                    try:
                        socketio.emit(
                            'presence:changed', {
                                'sid':
                                request.environ.get('flask_socketio.sid', ''),
                                'event':
                                'disconnect'
                            })
                    except Exception:
                        pass
            except Exception:
                pass

        @socketio.on('presence:leave')
        def presence_leave_socket():
            """Drop presence for this socket id immediately (e.g., on logout)."""
            try:
                if not app.config.get('PRESENCE_DISABLED'):
                    # Use Redis-based presence if available
                    if hasattr(app,
                               'presence_manager') and app.presence_manager:
                        app.presence_manager.remove_presence(
                            request.environ.get('flask_socketio.sid', ''))
                    else:
                        # Fallback to in-memory presence
                        if hasattr(app, '_presence'):
                            app._presence.pop(
                                request.environ.get('flask_socketio.sid', ''),
                                None)

                if not app.config.get('PRESENCE_DISABLED'):
                    try:
                        socketio.emit(
                            'presence:changed', {
                                'sid':
                                request.environ.get('flask_socketio.sid', ''),
                                'event':
                                'leave'
                            })
                    except Exception:
                        pass
            except Exception:
                pass

        # --- Redis-optimized Socket.IO events ---
        @socketio.on('join-room')
        def handle_join_room(data):
            """Join admin room for real-time updates."""
            try:
                # Handle both string and dict data
                if isinstance(data, str):
                    room = data if data else 'admin'
                else:
                    room = data.get('room', 'admin') if data else 'admin'

                join_room(room)
                emit('joined_room', {'room': room})
            except Exception as e:
                _log.error(f"Join room error: {e}")
                try:
                    emit('error', {'message': str(e)})
                except:
                    pass

        @socketio.on('user:heartbeat')
        def handle_user_heartbeat(data):
            """Handle user heartbeat for Redis optimization."""
            try:
                user = data.get('user')
                ip = request.environ.get('REMOTE_ADDR')
                ua = request.environ.get('HTTP_USER_AGENT', '')
                page = data.get('page', '')

                if not user:
                    return

                _log.info(f"Heartbeat from {user} at {ip}")

                # Update Redis if available (only for real pages)
                if hasattr(
                        app, 'redis_client'
                ) and app.redis_client and page and is_real_page(page):

                    user_key = f"{user}|{ip}"
                    user_data = {
                        'user': user,
                        'ip': ip,
                        'ua': ua,
                        'page': page,
                        'lastSeen': int(datetime.utcnow().timestamp() * 1000)
                    }

                    import json
                    app.redis_client.hset('presence:users', user_key,
                                          json.dumps(user_data))
                    app.redis_client.expire('presence:users', 60)

                # Notify admins
                emit('admin:presence:update', {
                    'type': 'user_activity',
                    'user': user,
                    'ip': ip,
                    'ua': ua,
                    'page': page,
                    'lastSeen': int(datetime.utcnow().timestamp() * 1000)
                },
                     room='admin')

            except Exception as e:
                _log.error(f"Heartbeat error: {e}")
                emit('error', {'message': str(e)})

        @socketio.on('user:login')
        def handle_user_login(data):
            """Handle user login event."""
            try:
                user = data.get('user')
                ip = request.environ.get('REMOTE_ADDR')
                ua = request.environ.get('HTTP_USER_AGENT', '')

                if not user:
                    return

                _log.info(f"User login: {user} at {ip}")

                # Update Redis if available
                if hasattr(app, 'redis_client') and app.redis_client:
                    user_key = f"{user}|{ip}"
                    user_data = {
                        'user': user,
                        'ip': ip,
                        'ua': ua,
                        'page': '/',
                        'lastSeen': int(datetime.utcnow().timestamp() * 1000)
                    }

                    import json
                    app.redis_client.hset('presence:users', user_key,
                                          json.dumps(user_data))
                    app.redis_client.expire('presence:users', 60)

                # Notify admins
                emit('admin:presence:update', {
                    'type': 'user_login',
                    'user': user,
                    'ip': ip,
                    'ua': ua,
                    'lastSeen': int(datetime.utcnow().timestamp() * 1000)
                },
                     room='admin')

            except Exception as e:
                _log.error(f"User login error: {e}")
                emit('error', {'message': str(e)})

        @socketio.on('user:logout')
        def handle_user_logout(data):
            """Handle user logout event."""
            try:
                user = data.get('user')
                ip = request.environ.get('REMOTE_ADDR')

                if not user:
                    return

                _log.info(f"User logout: {user} at {ip}")

                # Remove from Redis if available
                if hasattr(app, 'redis_client') and app.redis_client:
                    user_key = f"{user}|{ip}"
                    app.redis_client.hdel('presence:users', user_key)

                # Notify admins
                emit('admin:presence:update', {
                    'type': 'user_logout',
                    'user': user,
                    'ip': ip
                },
                     room='admin')

            except Exception as e:
                _log.error(f"User logout error: {e}")
                emit('error', {'message': str(e)})

        @socketio.on('session:terminate')
        def handle_session_terminate(data):
            """Handle session termination event."""
            try:
                sid = data.get('sid')
                user = data.get('user')

                if not sid:
                    return

                _log.info(f"Terminating session {sid} for user {user}")

                # Remove from Redis if available
                if hasattr(app, 'redis_client') and app.redis_client:
                    app.redis_client.hdel('sessions:active', sid)

                # Notify admins
                emit('admin:sessions:update', {
                    'type': 'session_terminated',
                    'sid': sid,
                    'user': user
                },
                     room='admin')

            except Exception as e:
                _log.error(f"Session terminate error: {e}")
                emit('error', {'message': str(e)})
