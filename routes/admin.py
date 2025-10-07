from flask import render_template, request, jsonify, Response, abort, send_file, make_response
from flask_login import current_user
from modules.permissions import require_permissions, ADMIN_VIEW_PAGE, ADMIN_MANAGE
from modules.logging import get_logger, log_action
from datetime import datetime

_log = get_logger(__name__)


def register(app, socketio=None):

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
					[]
				)
				groups = [{'id': r[0], 'name': r[1]} for r in (rows or []) if r]
			except Exception:
				# Fallback to group_all() if available and map objects to dict
				try:
					objs = app._sql.group_all()
					groups = [{'id': getattr(o, 'id', None), 'name': getattr(o, 'name', '')} for o in (objs or [])]
				except Exception:
					groups = []
		except Exception:
			groups = []
		# Log page view in actions log
		try:
			log_action('ADMIN_VIEW', current_user.name, f'ip={request.remote_addr}', request.remote_addr)
		except Exception:
			pass
		return render_template('admin.j2.html', title='Администрирование — Заявки-Наряды-Файлы', groups=groups)

	# --- Обслуживание таблицы подписок на уведомления (ручной запуск, с блокировкой на 23ч) ---
	@app.route('/admin/push_maintain', methods=['POST'])
	@require_permissions(ADMIN_MANAGE)
	def admin_push_maintain():
		"""Ручное обслуживание web push подписок: чистка ошибок и проверка неактивных.

		Ограничение: не чаще 1 раза в 23 часа (глобальная блокировка).
		"""
		try:
			# Глобальный троттлинг по времени
			from datetime import datetime, timedelta
			now = datetime.utcnow()
			last_run = getattr(app, '_last_push_maintain', None)
			if last_run and (now - last_run) < timedelta(hours=23):
				return jsonify({'status': 'error', 'message': 'Операция уже выполнялась недавно. Повторите позже.'}), 429
			app._last_push_maintain = now
			# Порог для “старых ошибок” (N дней), берем из конфигурации либо 7 по умолчанию
			try:
				N = int(app._sql.config.get('web', {}).get('push_error_ttl_days', 7))
			except Exception:
				N = 7
			# 1) Удалить записи с last_success_at IS NULL и last_error_at < NOW()-N дней
			deleted = 0
			try:
				res = app._sql.execute_non_query(
					f"DELETE FROM {app._sql.config['db']['prefix']}_push_sub WHERE last_success_at IS NULL AND last_error_at IS NOT NULL AND last_error_at < (NOW() - INTERVAL %s DAY);",
					[N]
				)
				deleted = deleted + (res or 0)
			except Exception:
				pass
			# 2) Протестировать неактивные >30 дней: один легкий пуш на пользователя (ограниченно)
			tested = 0
			removed = 0
			try:
				from pywebpush import webpush, WebPushException
				vapid_public = (app._sql.push_get_vapid_public() or '')
				vapid_private = (app._sql.push_get_vapid_private() or '')
				vapid_subject = (app._sql.push_get_vapid_subject() or 'mailto:admin@example.com')
				if vapid_public and vapid_private:
					rows = app._sql.execute_query(
						f"SELECT s.user_id, s.endpoint, s.p256dh, s.auth FROM {app._sql.config['db']['prefix']}_push_sub s WHERE (s.last_success_at IS NULL OR s.last_success_at < (NOW() - INTERVAL 30 DAY)) GROUP BY s.user_id ORDER BY s.user_id;",
						[]
					)
					payload = {'title': 'Проверка подписки', 'body': 'Сервисная проверка', 'icon': '/static/images/notification-icon.png'}
					for r in rows or []:
						uid, endpoint, p256dh, auth = r[0], r[1], r[2], r[3]
						if not endpoint: continue
						try:
							webpush(
								subscription_info={'endpoint': endpoint, 'keys': {'p256dh': p256dh, 'auth': auth}},
								data=jsonify_payload(payload),
								vapid_private_key=vapid_private,
								vapid_claims={'sub': vapid_subject}
							)
							tested += 1
							try: app._sql.push_mark_success(endpoint)
							except Exception: pass
						except WebPushException as we:
							code = getattr(getattr(we, 'response', None), 'status_code', None)
							if code == 410:
								try:
									app._sql.push_remove_subscription(endpoint)
									removed += 1
								except Exception:
									pass
							try: app._sql.push_mark_error(endpoint, str(code or '410'))
							except Exception: pass
							continue
			except Exception:
				pass
			try:
				log_action('ADMIN_PUSH_MAINTAIN', current_user.name, f'deleted={deleted} tested={tested} removed={removed}', request.remote_addr)
			except Exception:
				pass
			return jsonify({'status': 'success', 'deleted': deleted, 'tested': tested, 'removed': removed})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	# --- Logs table server-side pagination & search (HTML tbody fragment) ---
	@app.route('/admin/logs/page', methods=['GET'])
	@require_permissions(ADMIN_VIEW_PAGE)
	def admin_logs_page():
		"""Return paginated logs table rows as HTML fragment and meta."""
		try:
			import os
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
					items.append({'name': name, 'size': int(st.st_size), 'mtime': int(st.st_mtime)})
			items.sort(key=lambda x: x.get('mtime', 0), reverse=True)
			total = len(items)
			start = (page - 1) * page_size
			end = start + page_size
			slice_items = items[start:end]
			# Render minimal rows HTML to match admin logs table structure
			html_rows = []
			for it in slice_items:
				size_kb = f"{round(it['size']/1024, 1)} KB" if it['size'] < 1024*1024 else f"{round(it['size']/1024/1024, 1)} MB"
				html_rows.append(f"<tr class=\"table__body_row logs-row\" data-name=\"{it['name']}\"><td class=\"table__body_item\">{it['name']}</td><td class=\"table__body_item text-end\">{size_kb}</td></tr>")
			html = ''.join(html_rows)
			resp = make_response(jsonify({'html': html, 'total': total, 'page': page, 'page_size': page_size}))
			resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
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
			import os
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
					items.append({'name': name, 'size': int(st.st_size), 'mtime': int(st.st_mtime)})
			items.sort(key=lambda x: x.get('mtime', 0), reverse=True)
			total = len(items)
			start = (page - 1) * page_size
			end = start + page_size
			slice_items = items[start:end]
			html_rows = []
			for it in slice_items:
				size_kb = f"{round(it['size']/1024, 1)} KB" if it['size'] < 1024*1024 else f"{round(it['size']/1024/1024, 1)} MB"
				html_rows.append(f"<tr class=\"table__body_row logs-row\" data-name=\"{it['name']}\"><td class=\"table__body_item\">{it['name']}</td><td class=\"table__body_item text-end\">{size_kb}</td></tr>")
			html = ''.join(html_rows)
			resp = make_response(jsonify({'html': html, 'total': total, 'page': page, 'page_size': page_size}))
			resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
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
			# Do not log periodic presence refreshes to avoid log spam
			# Minimal in-memory presence stores on app (socket + heartbeat)
			presence = getattr(app, '_presence', {}) or {}
			presence_hb = getattr(app, '_presence_hb', {}) or {}
			now_ts = int(datetime.utcnow().timestamp())
			stale_cutoff = 8  # seconds
			rows = []
			for sid, info in presence.items():
				try:
					if (now_ts - int(info.get('updated_at') or 0)) > stale_cutoff:
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
					if (now_ts - int(info.get('updated_at') or 0)) > stale_cutoff:
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
				if not prev or int(r.get('updated_at') or 0) >= int(prev.get('updated_at') or 0):
					unique[key] = r
			items = list(unique.values())
			items.sort(key=lambda r: r.get('updated_at') or 0, reverse=True)
			return jsonify({'status': 'success', 'items': items})
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
				is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
			except Exception:
				is_authenticated = False
			if not is_authenticated:
				return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401
			data = request.get_json(silent=True) or {}
			user = getattr(current_user, 'name', None) or 'unknown'
			uid = getattr(current_user, 'id', None)
			ip = request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr
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
				is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
			except Exception:
				is_authenticated = False
			if not is_authenticated:
				return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401
			uid = getattr(current_user, 'id', None)
			ip = request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr
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
	def admin_force_logout():
		"""Force logout a specific Socket.IO session id."""
		try:
			sid = (request.json or {}).get('sid') or request.form.get('sid')
			uid = (request.json or {}).get('user_id') or request.form.get('user_id')
			if not sid and not uid:
				return jsonify({'status': 'error', 'message': 'sid required'}), 400
			# Emit to specific sid if provided
			if socketio and sid:
				try:
					payload = {'reason': 'admin', 'title': 'Сессия завершена', 'body': 'Сессия разорвана администратором. Войдите снова.'}
					socketio.emit('force-logout', payload, room=sid)
				except Exception:
					pass
			# Additionally, emit to all sockets of the user if user_id provided
			if socketio and uid:
				try:
					uid_int = int(uid)
					presence = getattr(app, '_presence', {}) or {}
					payload = {'reason': 'admin', 'title': 'Сессия завершена', 'body': 'Сессия разорвана администратором. Войдите снова.'}
					for psid, info in list(presence.items()):
						try:
							if int(info.get('user_id') or -1) == uid_int:
								socketio.emit('force-logout', payload, room=psid)
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
			try:
				log_action('ADMIN_FORCE_LOGOUT', current_user.name, f'sid={sid} uid={uid}', request.remote_addr)
			except Exception:
				pass
			return jsonify({'status': 'success'})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	# --- Send message via push ---
	@app.route('/admin/send_message', methods=['POST'])
	@require_permissions(ADMIN_MANAGE)
	def admin_send_message():
		"""Send a browser notification to a user, group, or everyone."""
		try:
			target = (request.json or {}).get('target') or request.form.get('target')
			message = ((request.json or {}).get('message') or request.form.get('message') or '').strip()
			if not message:
				return jsonify({'status': 'error', 'message': 'Текст сообщения пуст'}), 400
			try:
				log_action('ADMIN_PUSH_REQUEST', current_user.name, f'target={target} text_len={len(message)}', request.remote_addr)
			except Exception:
				pass
			# Resolve recipients
			recipient_user_ids = []
			if target == 'all':
				# All users with subscriptions
				try:
					rows = app._sql.execute_query(
						f"SELECT DISTINCT user_id FROM {app._sql.config['db']['prefix']}_push_sub;",
						[]
					)
				except Exception:
					rows = []
				recipient_user_ids = [r[0] for r in (rows or []) if r and r[0]]
			elif isinstance(target, str) and target.startswith('group:'):
				gid = int(target.split(':',1)[1])
				try:
					rows = app._sql.execute_query(
						f"SELECT DISTINCT u.id FROM {app._sql.config['db']['prefix']}_user u JOIN {app._sql.config['db']['prefix']}_push_sub s ON s.user_id=u.id WHERE u.gid=%s AND u.enabled=1;",
						[gid]
					)
				except Exception:
					rows = []
				recipient_user_ids = [r[0] for r in (rows or []) if r and r[0]]
			elif isinstance(target, str) and target.startswith('user:'):
				uid = int(target.split(':',1)[1])
				recipient_user_ids = [uid]
			else:
				return jsonify({'status': 'error', 'message': 'Некорректная цель'}), 400

			# Send using pywebpush
			try:
				from pywebpush import webpush, WebPushException
			except Exception:
				return jsonify({'status': 'error', 'message': 'pywebpush not installed'}), 501
			vapid_public = (app._sql.push_get_vapid_public() or '')
			vapid_private = (app._sql.push_get_vapid_private() or '')
			vapid_subject = (app._sql.push_get_vapid_subject() or 'mailto:admin@example.com')
			if not vapid_public or not vapid_private:
				return jsonify({'status': 'error', 'message': 'VAPID keys not configured'}), 400
			payload = {'title': 'Сообщение администратора', 'body': message, 'icon': '/static/images/notification-icon.png'}
			sent = 0
			for uid in recipient_user_ids:
				rows = app._sql.push_get_user_subscriptions(uid) or []
				for row in rows:
					endpoint, p256dh, auth = row[1], row[2], row[3]
					sub_info = { 'endpoint': endpoint, 'keys': {'p256dh': p256dh, 'auth': auth} }
					try:
						webpush(
							subscription_info=sub_info,
							data=jsonify_payload(payload),
							vapid_private_key=vapid_private,
							vapid_claims={'sub': vapid_subject}
						)
						sent += 1
					except WebPushException as we:
						_log.error(f"Push send failed: {we}")
						continue
			try:
				log_action('ADMIN_PUSH', current_user.name, f'target={target} sent={sent} text="{message}"', request.remote_addr)
			except Exception:
				pass
			return jsonify({'status': 'success', 'sent': sent})
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
				[]
			)
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
			import os, time
			logs_dir = os.path.join(app.root_path, 'logs')
			if not os.path.isdir(logs_dir):
				return jsonify({'status': 'success', 'items': []})
			items = []
			for name in os.listdir(logs_dir):
				# skip hidden files and dirs
				if name.startswith('.'):
					continue
				full = os.path.join(logs_dir, name)
				if not os.path.isfile(full):
					continue
				st = os.stat(full)
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
			import os
			name = (request.args.get('name') or '').strip()
			if not name:
				return abort(400)
			# sanitize to basename only
			name = os.path.basename(name)
			logs_dir = os.path.join(app.root_path, 'logs')
			full = os.path.join(logs_dir, name)
			# ensure inside logs dir
			if not full.startswith(os.path.abspath(logs_dir) + os.sep):
				return abort(403)
			if not os.path.isfile(full):
				return abort(404)
			with open(full, 'r', encoding='utf-8', errors='replace') as f:
				data = f.read()
			return Response(data, mimetype='text/plain; charset=utf-8')
		except Exception as e:
			app.flash_error(e)
			return Response(str(e), status=500, mimetype='text/plain; charset=utf-8')

	@app.route('/admin/logs/download', methods=['GET'])
	@require_permissions(ADMIN_VIEW_PAGE)
	def admin_logs_download():
		"""Download a single log file as attachment."""
		try:
			import os
			name = (request.args.get('name') or '').strip()
			if not name:
				return abort(400)
			name = os.path.basename(name)
			logs_dir = os.path.join(app.root_path, 'logs')
			full = os.path.join(logs_dir, name)
			if not full.startswith(os.path.abspath(logs_dir) + os.sep):
				return abort(403)
			if not os.path.isfile(full):
				return abort(404)
			return send_file(full, as_attachment=True, download_name=name)
		except Exception as e:
			app.flash_error(e)
			return Response(str(e), status=500, mimetype='text/plain; charset=utf-8')

	@app.route('/admin/logs/download_all', methods=['GET'])
	@require_permissions(ADMIN_VIEW_PAGE)
	def admin_logs_download_all():
		"""Zip all files in logs dir and send as attachment."""
		try:
			import os, io, zipfile, datetime
			logs_dir = os.path.join(app.root_path, 'logs')
			buf = io.BytesIO()
			with zipfile.ZipFile(buf, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
				if os.path.isdir(logs_dir):
					for name in os.listdir(logs_dir):
						if name.startswith('.'): continue
						full = os.path.join(logs_dir, name)
						if not os.path.isfile(full): continue
						# Write file into zip under its filename
						zf.write(full, arcname=name)
			buf.seek(0)
			ts = datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
			fname = f'znv-logs-{ts}.zip'
			return send_file(buf, as_attachment=True, download_name=fname, mimetype='application/zip')
		except Exception as e:
			app.flash_error(e)
			return Response(str(e), status=500, mimetype='text/plain; charset=utf-8')

	def jsonify_payload(obj: dict) -> str:
		try:
			import json
			from os import urandom
			return json.dumps({ **obj, 'id': int(urandom(2).hex(), 16) }, ensure_ascii=False)
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
				ip = request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr
				page = (data or {}).get('page')
				ua = request.headers.get('User-Agent', '')
				app._presence[request.sid] = {
					'user': user,
					'user_id': uid,
					'ip': ip,
					'page': page,
					'ua': ua,
					'updated_at': int(datetime.utcnow().timestamp())
				}
				# Notify all listeners that presence changed
				try:
					socketio.emit('presence:changed', {'sid': request.sid, 'user': user})
				except Exception:
					pass
			except Exception:
				pass

		@socketio.on('disconnect')
		def presence_disconnect():
			try:
				# prune stale (older than 60s) and remove current sid
				now_ts = int(datetime.utcnow().timestamp())
				if hasattr(app, '_presence'):
					stale = [sid for sid, info in app._presence.items() if (now_ts - int(info.get('updated_at') or 0)) > 60]
					for sid in stale:
						app._presence.pop(sid, None)
					app._presence.pop(request.sid, None)
					try:
						socketio.emit('presence:changed', {'sid': request.sid, 'event': 'disconnect'})
					except Exception:
						pass
			except Exception:
				pass

		@socketio.on('presence:leave')
		def presence_leave_socket():
			"""Drop presence for this socket id immediately (e.g., on logout)."""
			try:
				if hasattr(app, '_presence'):
					app._presence.pop(request.sid, None)
					try:
						socketio.emit('presence:changed', {'sid': request.sid, 'event': 'leave'})
					except Exception:
						pass
			except Exception:
				pass

