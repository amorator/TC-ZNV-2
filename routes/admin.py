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
from flask_socketio import join_room
from pywebpush import webpush, WebPushException

from modules.logging import get_logger, log_action
from modules.permissions import require_permissions, ADMIN_VIEW_PAGE, ADMIN_MANAGE
from modules.registrators import Registrator, parse_directory_listing
from modules.sync_manager import emit_admin_changed

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
        # Log page view in actions log
        try:
            log_action('ADMIN_VIEW', current_user.name,
                       f'ip={request.remote_addr}',
                       (request.remote_addr or ''))
        except Exception:
            pass

        return render_template('admin.j2.html',
                               title='Администрирование — Заявки-Наряды-Файлы',
                               groups=groups)

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

    # --- Обслуживание таблицы подписок на уведомления (ручной запуск, с блокировкой на 23ч) ---
    @app.route('/admin/push_maintain', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    @rate_limit
    def admin_push_maintain():
        """Ручное обслуживание web push подписок: чистка ошибок и проверка неактивных.

		Ограничение: не чаще 1 раза в 12 часов (глобальная блокировка).
		"""
        try:
            # Resolve DB table prefix safely (dict or ConfigParser styles)
            def _get_db_prefix():
                try:
                    cfg = getattr(app._sql, 'config', {})
                    # dict-like
                    if isinstance(cfg, dict):
                        db = cfg.get('db') or {}
                        return (db.get('prefix') or '').strip()
                    # ConfigParser-style
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
            # Глобальный троттлинг по времени
            from datetime import datetime, timedelta
            now = datetime.utcnow()
            last_run = getattr(app, '_last_push_maintain', None)
            if last_run and (now - last_run) < timedelta(hours=12):
                return jsonify({
                    'status':
                    'error',
                    'message':
                    'Операция уже выполнялась недавно (ограничение 12 часов). Повторите позже.'
                }), 429
            app._last_push_maintain = now
            # Порог для “старых ошибок” (N дней), берем из конфигурации либо 7 по умолчанию
            try:
                N = int(
                    app._sql.config.get('web', {}).get('push_error_ttl_days',
                                                       7))
            except Exception:
                N = 7
            # 1) Удалить записи с last_success_at IS NULL и last_error_at < NOW()-N дней
            deleted = 0
            try:
                res = app._sql.execute_non_query(
                    f"DELETE FROM {db_prefix}_push_sub WHERE last_success_at IS NULL AND last_error_at IS NOT NULL AND last_error_at < (NOW() - INTERVAL %s DAY);",
                    [N])
                deleted = deleted + (res or 0)
            except Exception:
                pass
            # 2) Протестировать неактивные >30 дней: один легкий пуш на пользователя (ограниченно)
            tested = 0
            removed = 0
            try:
                vapid_public = (app._sql.push_get_vapid_public() or '')
                vapid_private = (app._sql.push_get_vapid_private() or '')
                vapid_subject = (app._sql.push_get_vapid_subject()
                                 or 'mailto:admin@example.com')
                if vapid_public and vapid_private:
                    # Fetch candidate subscriptions (one per user in Python to avoid SQL only_full_group_by issues)
                    rows = app._sql.execute_query(
                        f"SELECT s.user_id, s.endpoint, s.p256dh, s.auth FROM {db_prefix}_push_sub s WHERE (s.last_success_at IS NULL OR s.last_success_at < (NOW() - INTERVAL 30 DAY)) ORDER BY s.user_id;",
                        [])
                    payload = {
                        'title': 'Проверка подписки',
                        'body': 'Сервисная проверка',
                        'icon': '/static/images/notification-icon.png'
                    }
                    # Deduplicate by user_id to limit one test push per user
                    seen_users = set()
                    for r in rows or []:
                        uid, endpoint, p256dh, auth = r[0], r[1], r[2], r[3]
                        if not endpoint: continue
                        if uid in seen_users: continue
                        seen_users.add(uid)
                        try:
                            webpush(subscription_info={
                                'endpoint': endpoint,
                                'keys': {
                                    'p256dh': p256dh,
                                    'auth': auth
                                }
                            },
                                    data=jsonify_payload(payload),
                                    vapid_private_key=vapid_private,
                                    vapid_claims={'sub': vapid_subject})
                            tested += 1
                            try:
                                app._sql.push_mark_success(endpoint)
                            except Exception:
                                pass
                        except WebPushException as we:
                            code = getattr(getattr(we, 'response', None),
                                           'status_code', None)
                            if code == 410:
                                try:
                                    app._sql.push_remove_subscription(endpoint)
                                    removed += 1
                                except Exception:
                                    pass
                            try:
                                app._sql.push_mark_error(
                                    endpoint, str(code or '410'))
                            except Exception:
                                pass
                            continue
            except Exception:
                pass
            try:
                log_action(
                    'ADMIN_PUSH_MAINTAIN', current_user.name,
                    f'deleted={deleted} tested={tested} removed={removed}',
                    (request.remote_addr or ''))
            except Exception:
                pass
            # include cooldown info in response
            try:
                from datetime import timedelta
                next_allowed_dt = app._last_push_maintain + timedelta(hours=12)
                seconds_left = max(
                    0, int((next_allowed_dt - now).total_seconds()))
            except Exception:
                seconds_left = 12 * 3600

            # Отправляем событие синхронизации для обновления UI у всех пользователей
            try:
                emit_admin_changed(
                    socketio,
                    'maintenance',
                    action='push_maintain_completed',
                    deleted=deleted,
                    tested=tested,
                    removed=removed,
                    seconds_left=seconds_left,
                    timestamp=now.isoformat(),
                )
            except Exception:
                pass

            return jsonify({
                'status': 'success',
                'deleted': deleted,
                'tested': tested,
                'removed': removed,
                'seconds_left': seconds_left
            })
        except Exception as e:
            try:
                _log.error("/admin/push_maintain failed", exc_info=True)
            except Exception:
                pass
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # Статус «обслуживания подписок»: вернёт последний запуск и когда можно снова
    @app.route('/admin/push_maintain_status', methods=['GET'])
    @require_permissions(ADMIN_MANAGE)
    def admin_push_maintain_status():
        try:
            from datetime import datetime, timedelta
            last_run = getattr(app, '_last_push_maintain', None)
            cooldown = timedelta(hours=12)
            now = datetime.utcnow()
            next_allowed_at = None
            seconds_left = 0
            if last_run:
                next_allowed_dt = last_run + cooldown
                next_allowed_at = int(next_allowed_dt.timestamp())
                seconds_left = max(
                    0, int((next_allowed_dt - now).total_seconds()))
            return jsonify({
                'status':
                'success',
                'last_run':
                int(last_run.timestamp()) if last_run else None,
                'next_allowed_at':
                next_allowed_at,
                'seconds_left':
                seconds_left
            })
        except Exception as e:
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

    # --- Presence: list active sessions ---
    @app.route('/admin/presence', methods=['GET'])
    @require_permissions(ADMIN_VIEW_PAGE)
    def admin_presence():
        """Return JSON with currently connected users (Socket.IO sessions)."""
        try:
            # Use Redis-based presence if available
            if hasattr(app, 'presence_manager') and app.presence_manager:
                items = app.presence_manager.get_active_presence()
            else:
                # Fallback to in-memory presence
                presence = getattr(app, '_presence', {}) or {}
                presence_hb = getattr(app, '_presence_hb', {}) or {}
                now_ts = int(datetime.utcnow().timestamp())
                stale_cutoff = 8  # seconds
                rows = []
                for sid, info in presence.items():
                    try:
                        if (now_ts - int(info.get('updated_at')
                                         or 0)) > stale_cutoff:
                            continue
                    except Exception:
                        pass
                    rows.append({
                        'sid': sid,
                        'user_id': info.get('user_id'),
                        'user': info.get('user'),
                        'ip': info.get('ip'),
                        'page': info.get('page'),
                        'ua': info.get('ua'),
                        'updated_at': info.get('updated_at'),
                    })
                # Merge heartbeat-based entries
                for key, info in presence_hb.items():
                    try:
                        if (now_ts - int(info.get('updated_at')
                                         or 0)) > stale_cutoff:
                            continue
                    except Exception:
                        pass
                    rows.append({
                        'sid': key,
                        'user_id': info.get('user_id'),
                        'user': info.get('user'),
                        'ip': info.get('ip'),
                        'page': info.get('page'),
                        'ua': info.get('ua'),
                        'updated_at': info.get('updated_at'),
                    })
                # Deduplicate by user_id+ip+ua (fallback to user+ip+ua) keeping the freshest entry
                unique = {}
                for r in rows:
                    uid = r.get('user_id')
                    ip = (r.get('ip') or '').strip()
                    user = (r.get('user') or '').strip()
                    ua = (r.get('ua') or '').strip()
                    # normalize UA a bit to avoid overly long keys but keep browser identity
                    ua_key = ua[:64]
                    key = f"{uid or user}:{ip}:{ua_key}"
                    prev = unique.get(key)
                    if not prev or int(r.get('updated_at') or 0) >= int(
                            prev.get('updated_at') or 0):
                        unique[key] = r
                items = list(unique.values())
                items.sort(key=lambda r: r.get('updated_at') or 0,
                           reverse=True)

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
                        'sid': sid,
                        'user_id': info.get('user_id'),
                        'user': info.get('user'),
                        'ip': info.get('ip'),
                        'ua': info.get('ua'),
                        'created_at': int(info.get('created_at') or 0),
                        'last_seen': int(info.get('last_seen') or 0),
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

    # --- Send message via push ---
    @app.route('/admin/send_message', methods=['POST'])
    @require_permissions(ADMIN_MANAGE)
    @rate_limit
    def admin_send_message():
        """Send a browser notification to a user, group, or everyone."""
        try:
            target = (request.json
                      or {}).get('target') or request.form.get('target')
            message = ((request.json or {}).get('message')
                       or request.form.get('message') or '').strip()
            if not message:
                return jsonify({
                    'status': 'error',
                    'message': 'Текст сообщения пуст'
                }), 400
            try:
                log_action('ADMIN_PUSH_REQUEST', current_user.name,
                           f'target={target} text_len={len(message)}',
                           (request.remote_addr or ''))
            except Exception:
                pass
            # Resolve recipients
            recipient_user_ids = []
            if target == 'all':
                # All users with subscriptions
                try:
                    rows = app._sql.execute_query(
                        f"SELECT DISTINCT user_id FROM {app._sql.config['db']['prefix']}_push_sub;",
                        [])
                except Exception:
                    rows = []
                recipient_user_ids = [r[0] for r in (rows or []) if r and r[0]]
            elif isinstance(target, str) and target.startswith('group:'):
                gid = int(target.split(':', 1)[1])
                try:
                    rows = app._sql.execute_query(
                        f"SELECT DISTINCT u.id FROM {app._sql.config['db']['prefix']}_user u JOIN {app._sql.config['db']['prefix']}_push_sub s ON s.user_id=u.id WHERE u.gid=%s AND u.enabled=1;",
                        [gid])
                except Exception:
                    rows = []
                recipient_user_ids = [r[0] for r in (rows or []) if r and r[0]]
            elif isinstance(target, str) and target.startswith('user:'):
                uid = int(target.split(':', 1)[1])
                recipient_user_ids = [uid]
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Некорректная цель'
                }), 400

            # Send using pywebpush
            try:
                from pywebpush import webpush, WebPushException
            except Exception:
                return jsonify({
                    'status': 'error',
                    'message': 'pywebpush not installed'
                }), 501
            vapid_public = (app._sql.push_get_vapid_public() or '')
            vapid_private = (app._sql.push_get_vapid_private() or '')
            vapid_subject = (app._sql.push_get_vapid_subject()
                             or 'mailto:admin@example.com')
            if not vapid_public or not vapid_private:
                return jsonify({
                    'status': 'error',
                    'message': 'VAPID keys not configured'
                }), 400
            payload = {
                'title': 'Сообщение администратора',
                'body': message,
                'icon': '/static/images/notification-icon.png'
            }
            sent = 0
            removed = 0
            for uid in recipient_user_ids:
                rows = app._sql.push_get_user_subscriptions(uid) or []
                for row in rows:
                    endpoint, p256dh, auth = row[1], row[2], row[3]
                    sub_info = {
                        'endpoint': endpoint,
                        'keys': {
                            'p256dh': p256dh,
                            'auth': auth
                        }
                    }
                    try:
                        webpush(subscription_info=sub_info,
                                data=jsonify_payload(payload),
                                vapid_private_key=vapid_private,
                                vapid_claims={'sub': vapid_subject})
                        sent += 1
                        try:
                            app._sql.push_mark_success(endpoint)
                        except Exception:
                            pass
                    except WebPushException as we:
                        # Mirror cleanup logic from /push/test
                        code = getattr(getattr(we, 'response', None),
                                       'status_code', None)
                        body_text = ''
                        try:
                            resp = getattr(we, 'response', None)
                            if resp is not None:
                                code = getattr(resp, 'status_code', None)
                                body_text = getattr(resp, 'text',
                                                    str(we)) or str(we)
                            else:
                                body_text = str(we)
                        except Exception:
                            body_text = str(we)
                        if code == 410 or 'No such subscription' in body_text or 'Gone' in body_text:
                            try:
                                app._sql.push_remove_subscription(endpoint)
                                removed += 1
                            except Exception:
                                pass
                        try:
                            app._sql.push_mark_error(endpoint,
                                                     str(code or '410'))
                        except Exception:
                            pass
                        _log.error(f"Push send failed: {we}")
                        continue
            try:
                log_action(
                    'ADMIN_PUSH', current_user.name,
                    f'target={target} sent={sent} removed={removed} text="{message}"',
                    (request.remote_addr or ''))
            except Exception:
                pass
            return jsonify({
                'status': 'success',
                'sent': sent,
                'removed': removed
            })
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
