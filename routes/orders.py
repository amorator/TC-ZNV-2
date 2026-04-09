from flask import render_template, request, jsonify
from flask_login import login_required, current_user
from datetime import datetime as dt, timedelta
from modules.permissions import (
    require_permissions,
    ORDERS_VIEW_PAGE,
    ORDERS_CREATE,
    ORDERS_APPROVE,
    ORDERS_DELETE_ANY,
    ORDERS_STATUS_CHANGE,
    ADMIN_ANY,
    ORDERS_FILES_EDIT,
    ORDERS_FILES_VIEW,
    ORDERS_VIEW_ALL,
    ORDERS_EDIT_APPROVED,
)
from flask import redirect, url_for
from modules.logging import log_action
import logging

_log = logging.getLogger(__name__)


def register(app, socketio=None):
	def _norm_service_name(value: str) -> str:
		"""Normalize service/group name for robust comparisons."""
		try:
			return ' '.join(str(value or '').strip().lower().split())
		except Exception:
			return ''

	def _load_orders_access_ctx():
		"""Build shared access context for current user in orders scope."""
		ctx = {
			'has_view_all': False,
			'user_gid': 0,
			'user_id': 0,
			'user_service': '',
			'service_to_gid': {},
			'order_to_sub_id': {},
			'perm_cache': {},
		}
		try:
			prefix = app._sql.config['db']['prefix']
			# Admin-group override parity with existing orders logic.
			def _is_admin_group_member() -> bool:
				try:
					cfg = getattr(app._sql, 'config', {})
					from configparser import ConfigParser
					aname = 'Программисты'
					if isinstance(cfg, ConfigParser):
						aname = cfg.get('admin', 'group', fallback=aname) or aname
					else:
						if isinstance(cfg, dict):
							admin = cfg.get('admin') if hasattr(cfg, 'get') else None
							if isinstance(admin, dict) and 'group' in admin:
								aname = admin.get('group') or aname
							elif 'group' in cfg:
								aname = cfg.get('group') or aname
					name_norm = (aname or '').strip().lower()
					rows = app._sql.execute_query(f"SELECT id,name FROM {prefix}_group") or []
					admin_gid = None
					for gid, gname in rows:
						try:
							ctx['service_to_gid'][_norm_service_name(str(gname or ''))] = int(gid)
						except Exception:
							continue
						if str(gname).strip().lower() == name_norm:
							admin_gid = int(gid)
					if admin_gid is not None:
						return int(getattr(current_user, 'gid', 0) or 0) == int(admin_gid)
				except Exception:
					return False
				return False

			ctx['user_gid'] = int(getattr(current_user, 'gid', 0) or 0)
			ctx['user_id'] = int(getattr(current_user, 'id', 0) or 0)
			ctx['has_view_all'] = bool(
				current_user.has('orders.view_all') or
				current_user.has('admin.any') or
				_is_admin_group_member()
			)

			if not ctx['has_view_all']:
				try:
					row = app._sql.execute_query(
						f"SELECT name FROM {prefix}_group WHERE id=%s LIMIT 1;",
						[int(ctx['user_gid'])]
					) or []
					if row and row[0]:
						ctx['user_service'] = _norm_service_name(str(row[0][0] or ''))
				except Exception:
					pass

				try:
					orders_cat_id = app._sql.category_id_by_folder('orders')
				except Exception:
					orders_cat_id = None
				if orders_cat_id:
					try:
						subs = app._sql.subcategory_by_category([int(orders_cat_id)]) or []
						for sub in subs:
							try:
								if int(getattr(sub, 'enabled', 1) or 1) != 1:
									continue
								folder = str(getattr(sub, 'folder_name', '') or '')
								if not folder.startswith('order-'):
									continue
								order_id = int(folder[len('order-'):])
								ctx['order_to_sub_id'][order_id] = int(getattr(sub, 'id'))
							except Exception:
								continue
					except Exception:
						pass
		except Exception:
			pass
		return ctx

	def _has_subcategory_view_access(subcategory_id: int, access_ctx: dict) -> bool:
		"""Check matrix/legacy view permission for current user on a subcategory."""
		try:
			sub_id = int(subcategory_id)
		except Exception:
			return False
		cache = access_ctx.get('perm_cache') if isinstance(access_ctx, dict) else None
		if isinstance(cache, dict) and sub_id in cache:
			return bool(cache.get(sub_id))
		allowed = False
		try:
			raw = app._sql.setting_get(f"subcategory_permissions:{sub_id}")
			if raw:
				import json
				perms = json.loads(raw)
				gid = int(access_ctx.get('user_gid', 0) or 0)
				uid = int(access_ctx.get('user_id', 0) or 0)
				gmx = perms.get('group_by_id', {}).get(str(gid), {}) if isinstance(perms.get('group_by_id'), dict) else {}
				umx = perms.get('user_by_id', {}).get(str(uid), {}) if isinstance(perms.get('user_by_id'), dict) else {}
				if any(int(gmx.get(k, 0)) == 1 for k in ('view_all', 'view_group', 'view_own')):
					allowed = True
				if (not allowed) and any(int(umx.get(k, 0)) == 1 for k in ('view_all', 'view_group', 'view_own')):
					allowed = True
				if (not allowed) and int(perms.get('group', {}).get(str(gid), 0) or 0) == 1:
					allowed = True
				if not allowed:
					login = (getattr(current_user, 'login', '') or '').strip()
					if login and int(perms.get('user', {}).get(login, 0) or 0) == 1:
						allowed = True
		except Exception:
			allowed = False
		if isinstance(cache, dict):
			cache[sub_id] = bool(allowed)
		return bool(allowed)

	def _has_orders_service_view_access(service_gid: int, access_ctx: dict) -> bool:
		"""Check matrix/legacy view permission for orders service bucket."""
		try:
			gid = int(service_gid)
		except Exception:
			return False
		cache = access_ctx.get('perm_cache') if isinstance(access_ctx, dict) else None
		cache_key = f"svc:{gid}"
		if isinstance(cache, dict) and cache_key in cache:
			return bool(cache.get(cache_key))
		allowed = False
		try:
			raw = app._sql.setting_get(f"orders_service_permissions:{gid}")
			if raw:
				import json
				perms = json.loads(raw)
				ugid = int(access_ctx.get('user_gid', 0) or 0)
				uid = int(access_ctx.get('user_id', 0) or 0)
				gmx = perms.get('group_by_id', {}).get(str(ugid), {}) if isinstance(perms.get('group_by_id'), dict) else {}
				umx = perms.get('user_by_id', {}).get(str(uid), {}) if isinstance(perms.get('user_by_id'), dict) else {}
				if any(int(gmx.get(k, 0)) == 1 for k in ('view_all', 'view_group', 'view_own')):
					allowed = True
				if (not allowed) and any(int(umx.get(k, 0)) == 1 for k in ('view_all', 'view_group', 'view_own')):
					allowed = True
				if (not allowed) and int(perms.get('group', {}).get(str(ugid), 0) or 0) == 1:
					allowed = True
				if not allowed:
					login = (getattr(current_user, 'login', '') or '').strip()
					if login and int(perms.get('user', {}).get(login, 0) or 0) == 1:
						allowed = True
		except Exception:
			allowed = False
		if isinstance(cache, dict):
			cache[cache_key] = bool(allowed)
		return bool(allowed)

	def _can_view_order_row(order_obj, access_ctx: dict) -> bool:
		"""Visibility for list/search rows: own service OR explicit subcategory permission OR view_all."""
		try:
			if bool(access_ctx.get('has_view_all')):
				return True
			user_service = _norm_service_name(str(access_ctx.get('user_service') or ''))
			order_service = _norm_service_name(str(getattr(order_obj, 'service', '') or ''))
			if user_service and order_service and order_service == user_service:
				return True
			service_gid = access_ctx.get('service_to_gid', {}).get(order_service)
			if service_gid and _has_orders_service_view_access(int(service_gid), access_ctx):
				return True
			order_id = int(getattr(order_obj, 'id', 0) or 0)
			sub_id = access_ctx.get('order_to_sub_id', {}).get(order_id)
			if sub_id:
				return _has_subcategory_view_access(int(sub_id), access_ctx)
		except Exception:
			return False
		return False

	def _can_view_order_dict(order_dict: dict, access_ctx: dict) -> bool:
		"""Visibility for single order payload."""
		try:
			if bool(access_ctx.get('has_view_all')):
				return True
			order_service = _norm_service_name(str(order_dict.get('service', '') or ''))
			user_service = _norm_service_name(str(access_ctx.get('user_service', '') or ''))
			if user_service and order_service and order_service == user_service:
				return True
			service_gid = access_ctx.get('service_to_gid', {}).get(order_service)
			if service_gid and _has_orders_service_view_access(int(service_gid), access_ctx):
				return True
			creator_gid = order_dict.get('creator_gid')
			if creator_gid is not None:
				try:
					if int(creator_gid) == int(access_ctx.get('user_gid', 0) or 0):
						return True
				except Exception:
					pass
			order_id = int(order_dict.get('id', 0) or 0)
			sub_id = access_ctx.get('order_to_sub_id', {}).get(order_id)
			if sub_id:
				return _has_subcategory_view_access(int(sub_id), access_ctx)
		except Exception:
			return False
		return False

	def _get_accessible_service_names(access_ctx: dict) -> list[str]:
		"""List of service names visible to current user in orders."""
		try:
			prefix = app._sql.config['db']['prefix']
			rows = app._sql.execute_query(f"SELECT id, name FROM {prefix}_group ORDER BY name;") or []
		except Exception:
			rows = []
		names = []
		for r in rows:
			try:
				gid = int(r[0])
				gname = str(r[1] or '').strip()
				if not gname:
					continue
				if bool(access_ctx.get('has_view_all')):
					names.append(gname)
					continue
				user_service = str(access_ctx.get('user_service') or '').strip().lower()
				if user_service and user_service == _norm_service_name(gname):
					names.append(gname)
					continue
				if _has_orders_service_view_access(gid, access_ctx):
					names.append(gname)
			except Exception:
				continue
		# stable unique preserving order
		seen = set()
		out = []
		for n in names:
			key = n.lower()
			if key in seen:
				continue
			seen.add(key)
			out.append(n)
		return out

	# Socket.IO: support SyncManager.joinRoom('orders')
	try:
		_sock = socketio if socketio else getattr(app, 'socketio', None)
		if _sock:
			from flask_socketio import join_room

			@_sock.on('orders:join')
			def _orders_join(_data=None):
				try:
					join_room('orders')
				except Exception:
					pass
	except Exception:
		pass
	@app.route('/orders', methods=['GET'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def orders():
		# Load groups for service select (no redundant try/except)
		prefix = app._sql.config['db']['prefix']
		rows = app._sql.execute_query(f"SELECT id, name FROM {prefix}_group ORDER BY name;") or []
		groups = [{'id': int(r[0]), 'name': str(r[1])} for r in rows]
		# Determine admin group id from config name (case-insensitive)
		def _get_admin_group_name(default: str = 'Программисты') -> str:
			try:
				cfg = getattr(app._sql, 'config', {})
				from configparser import ConfigParser
				if isinstance(cfg, ConfigParser):
					return cfg.get('admin', 'group', fallback=default) or default
			except Exception:
				pass
			try:
				if isinstance(cfg, dict):
					admin = cfg.get('admin') if hasattr(cfg, 'get') else None
					if isinstance(admin, dict) and 'group' in admin:
						return admin.get('group') or default
					if 'group' in cfg:
						return cfg.get('group') or default
			except Exception:
				pass
			return default
		admin_group_name = _get_admin_group_name()
		admin_group_id = None
		try:
			name_norm = (admin_group_name or '').strip().lower()
			for r in rows:
				try:
					if str(r[1]).strip().lower() == name_norm:
						admin_group_id = int(r[0])
						break
				except Exception:
					continue
		except Exception:
			admin_group_id = None
		# Check if user is admin group member
		def is_admin_group_member() -> bool:
			try:
				name_norm = (admin_group_name or '').strip().lower()
				for r in rows:
					try:
						if str(r[1]).strip().lower() == name_norm:
							return int(current_user.gid) == int(r[0])
					except Exception:
						continue
			except Exception:
				pass
			return False
		
		access_ctx = _load_orders_access_ctx()
		has_view_all = bool(access_ctx.get('has_view_all'))
		accessible_services = _get_accessible_service_names(access_ctx)
		
		return render_template('orders.j2.html',
							   title='Наряды — Заявки-Наряды-Файлы',
							   id=2,
				   groups=groups,
				   accessible_services=accessible_services,
				   admin_group_id=admin_group_id,
				   has_view_all=has_view_all)

	@app.route('/api/orders', methods=['GET'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def api_orders():
		# Accept header guard: redirect HTML direct hits to page
		accept = (request.headers.get('Accept') or '')
		is_ajax = (request.headers.get('X-Requested-With') == 'XMLHttpRequest')
		if ('text/html' in accept) and (not is_ajax):
			return redirect(url_for('orders'))
		# Defaults for safe fallback in except
		page = int((request.args.get('page') or '1').strip() or '1')
		page_size = int((request.args.get('page_size') or '10').strip() or '10')
		try:
			access_ctx = _load_orders_access_ctx()
			has_view_all = bool(access_ctx.get('has_view_all'))
			user_service = _norm_service_name(str(access_ctx.get('user_service') or ''))
			
			# Filters: status_in (csv of in_progress,stopped,done), date_from, date_to (YYYY-MM-DD)
			status_in = set([s.strip().lower() for s in (request.args.get('status_in') or 'in_progress,stopped,done').split(',') if s.strip()])
			date_from = (request.args.get('date_from') or '').strip()
			date_to = (request.args.get('date_to') or '').strip()
			q = (request.args.get('q') or '').strip().lower()
			# Service filter:
			# - view_all: any requested service (or all when empty)
			# - restricted: only among accessible services; empty means "all accessible"
			service = _norm_service_name(str(request.args.get('service') or ''))
			if not has_view_all:
				allowed_services = set([_norm_service_name(s) for s in _get_accessible_service_names(access_ctx)])
				if service and service not in allowed_services:
					service = ''
			def parse_date(d):
				try:
					return dt.strptime(d, '%Y-%m-%d')
				except Exception:
					return None
			df = parse_date(date_from)
			dt_to = parse_date(date_to)
			# Make date_to inclusive to the end of the day when provided
			if dt_to is not None:
				dt_to = dt_to.replace(hour=23, minute=59, second=59, microsecond=999999)
			# default to current month
			if not df or not dt_to:
				now = dt.now()
				first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
				next_month = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
				last = next_month - timedelta(seconds=1)
				df = df or first
				dt_to = dt_to or last
			rows = app._sql.order_all() or []
			result = []
			for o in rows:
				# normalize status
				st = (getattr(o, 'status', '') or '').strip().lower()
				if st in ('in_progress', 'process', '0', 'ведутся'):
					stn = 'in_progress'
				elif st in ('stopped', '-1', 'не ведутся'):
					stn = 'stopped'
				elif st in ('done', '1', 'completed', 'завершены'):
					stn = 'done'
				else:
					stn = 'in_progress'
				if stn not in status_in:
					continue
				if service:
					srv_field = _norm_service_name(str(getattr(o, 'service', '') or ''))
					if srv_field != service:
						continue
				if not _can_view_order_row(o, access_ctx):
					continue
				# date filter by overlap within [df, dt_to]
				def to_dt(x):
					try:
						return x if isinstance(x, dt) else dt.fromisoformat(str(x).split('.')[0].replace(' ', 'T'))
					except Exception:
						return None
				issued = to_dt(getattr(o, 'issued', None))
				start = to_dt(getattr(o, 'start', None))
				end = to_dt(getattr(o, 'end', None))
				created = to_dt(getattr(o, 'created_at', None))
				# Include if any of issued/start/end within range, or if all three are empty then fallback to created_at
				in_range = any(d and df <= d <= dt_to for d in (issued, start, end)) or (
					(not issued and not start and not end) and (created and df <= created <= dt_to)
				)
				if not in_range:
					continue
				# text search across all visible columns
				if q:
					def fmt_dt(d):
						try:
							return d.strftime('%Y-%m-%d %H:%M') if isinstance(d, dt) else str(d or '')
						except Exception:
							return str(d or '')
					# Three states: 0 = ожидание, 1 = согласовано, -1 = не согласовано
					approved_val = int(getattr(o, 'approved', 0) or 0)
					if approved_val == 1:
						approved_txt = 'согласовано'
					elif approved_val == -1:
						approved_txt = 'не согласовано'
					else:
						approved_txt = 'ожидание'
					status_ru = {
						'in_progress': 'работы ведутся',
						'stopped': 'работы не ведутся',
						'done': 'работы завершены',
					}.get(stn, stn)
					hay = ' '.join([
						str(getattr(o, 'service', '') or ''),
						str(getattr(o, 'number', '') or ''),
						str(getattr(o, 'responsible', '') or ''),
						str(getattr(o, 'work_name', '') or ''),
						fmt_dt(issued) or '',
						fmt_dt(start) or '',
						fmt_dt(end) or '',
						approved_txt,
						status_ru,
						str(getattr(o, 'note', '') or ''),
						str(getattr(o, 'id', '') or ''),
					]).lower()
					if q not in hay:
						continue
				result.append({
					'id': o.id,
					'service': getattr(o, 'service', ''),
					'status': stn,
					'number': getattr(o, 'number', ''),
					'issued': (issued.isoformat(sep=' ') if issued else ''),
					'start': (start.isoformat(sep=' ') if start else ''),
					'end': (end.isoformat(sep=' ') if end else ''),
					'responsible': getattr(o, 'responsible', ''),
					'work_name': getattr(o, 'work_name', ''),
					'approved': int(getattr(o, 'approved', 0) or 0),
					'files': 0,
					'note': getattr(o, 'note', '') or '',
					'extended': bool(getattr(o, 'extended', False)),
					'finalized': bool(getattr(o, 'finalized', False)),
				})
			# Paginate
			total = len(result)
			total_pages = max(1, (total + page_size - 1) // page_size)
			page = max(1, min(page, total_pages))
			start_idx = (page - 1) * page_size
			end_idx = start_idx + page_size
			items = result[start_idx:end_idx]
			return jsonify({
				'items': items,
				'total': total,
				'page': page,
				'page_size': page_size,
			})
		except Exception as e:
			try:
				app.logger.error(f"Orders api error: {e}")
			except Exception:
				pass
			return jsonify({ 'items': [], 'total': 0, 'page': page, 'page_size': page_size }), 200

	@app.route('/api/orders', methods=['POST'])
	@login_required
	@require_permissions(ORDERS_CREATE)
	def api_orders_create():
		try:
			# Accept JSON body
			data = request.get_json(silent=True) or {}
			# Always enforce creator's service (current user's group name), ignore client input
			service = ''
			number = (data.get('number') or '').strip()
			responsible = (data.get('responsible') or '').strip()
			work_name = (data.get('work_name') or '').strip()
			status = (data.get('status') or 'stopped').strip().lower() or 'stopped'
			issued = (data.get('issued') or '').strip() or None
			start = (data.get('start') or '').strip() or None
			end = (data.get('end') or '').strip() or None
			# Backend validation: required fields except 3 date fields
			missing = []
			if not number: missing.append('number')
			if not responsible: missing.append('responsible')
			if not work_name: missing.append('work_name')
			if missing:
				return jsonify({ 'ok': False, 'error': 'validation', 'missing': missing }), 400
			# Dates validation: all three required; end > start > issued; issued >= today (date-only)
			def norm_dt(x):
				if not x: return None
				try:
					return dt.fromisoformat(str(x).replace('T', ' '))
				except Exception:
					return None
			issued_dt = norm_dt(issued)
			start_dt = norm_dt(start)
			end_dt = norm_dt(end)
			if not issued_dt or not start_dt or not end_dt:
				return jsonify({ 'ok': False, 'error': 'dates_required' }), 400
			if not (issued_dt < start_dt < end_dt):
				return jsonify({ 'ok': False, 'error': 'dates_order' }), 400
			# Temporarily disabled: allow 'issued' date earlier than today
			# Enforce service to creator's group (for all users)
			try:
				prefix = app._sql.config['db']['prefix']
				row = app._sql.execute_query(f"SELECT name FROM {prefix}_group WHERE id=%s LIMIT 1;", [int(current_user.gid)]) or []
				creator_group_name = (row[0][0] or '') if row and row[0] else ''
				if creator_group_name:
					service = str(creator_group_name)
			except Exception:
				pass
			# Insert
			new_id = app._sql.order_add([
				service,
				status,
				number,
				issued_dt,
				start_dt,
				end_dt,
				responsible,
				work_name,
				0,  # approved default
			])
			# Set creator metadata
			try:
				app._sql.execute_non_query(
					f"UPDATE {app._sql.config['db']['prefix']}_order SET created_by = %s, creator_gid = %s WHERE id = %s;",
					[current_user.id, current_user.gid, int(new_id)]
				)
			except Exception:
				pass
			try:
				log_action('ORDER_CREATE', current_user.name, f'id={int(new_id)} number={number} service={service}', (request.remote_addr or ''))
			except Exception:
				pass
			# Emit realtime update
			_sock = socketio if socketio else getattr(app, 'socketio', None)
			if _sock:
				payload = {
					'reason': 'create',
					'id': int(new_id),
				}
				_log.debug(f"[orders] emit orders:changed: {payload}")
				_sock.emit('orders:changed', payload)
			return jsonify({ 'ok': True, 'id': int(new_id) }), 200
		except Exception as e:
			try:
				app.logger.error(f"Orders create error: {e}")
			except Exception:
				pass
			return jsonify({ 'ok': False, 'error': 'server' }), 500

	@app.route('/orders/create', methods=['POST'])
	@login_required
	@require_permissions(ORDERS_CREATE)
	def orders_create():
		"""Create order via form-data (for validateForm flow)."""
		try:
			# Ignore client input; will set to current user's group below
			service = ''
			number = (request.form.get('number') or '').strip()
			responsible = (request.form.get('responsible') or '').strip()
			work_name = (request.form.get('work_name') or '').strip()
			status = (request.form.get('status') or 'stopped').strip().lower() or 'stopped'
			issued = (request.form.get('issued') or '').strip() or None
			start = (request.form.get('start') or '').strip() or None
			end = (request.form.get('end') or '').strip() or None
			missing = []
			if not number: missing.append('number')
			if not responsible: missing.append('responsible')
			if not work_name: missing.append('work_name')
			if missing:
				return jsonify({ 'ok': False, 'error': 'validation', 'missing': missing }), 400
			def norm_dt(x):
				if not x: return None
				try:
					return dt.fromisoformat(str(x).replace('T', ' '))
				except Exception:
					return None
			issued_dt = norm_dt(issued)
			start_dt = norm_dt(start)
			end_dt = norm_dt(end)
			if not issued_dt or not start_dt or not end_dt:
				return jsonify({ 'ok': False, 'error': 'dates_required' }), 400
			if not (issued_dt < start_dt < end_dt):
				return jsonify({ 'ok': False, 'error': 'dates_order' }), 400
			try:
				if issued_dt.date() < dt.now().date():
					return jsonify({ 'ok': False, 'error': 'issued_too_early' }), 400
			except Exception:
				pass
			# Enforce service to creator's group (for all users)
			try:
				prefix = app._sql.config['db']['prefix']
				row = app._sql.execute_query(f"SELECT name FROM {prefix}_group WHERE id=%s LIMIT 1;", [int(current_user.gid)]) or []
				creator_group_name = (row[0][0] or '') if row and row[0] else ''
				if creator_group_name:
					service = str(creator_group_name)
			except Exception:
				pass
			new_id = app._sql.order_add([
				service,
				status,
				number,
				issued_dt,
				start_dt,
				end_dt,
				responsible,
				work_name,
				0,  # approved default: 0 = ожидание
			])
			# Set creator metadata
			try:
				app._sql.execute_non_query(
					f"UPDATE {app._sql.config['db']['prefix']}_order SET created_by = %s, creator_gid = %s WHERE id = %s;",
					[current_user.id, current_user.gid, int(new_id)]
				)
			except Exception:
				pass
			# Emit realtime update
			_sock = socketio if socketio else getattr(app, 'socketio', None)
			if _sock:
				payload = {
					'reason': 'create',
					'id': int(new_id),
				}
				_log.debug(f"[orders] emit orders:changed: {payload}")
				_sock.emit('orders:changed', payload)
			return jsonify({ 'ok': True, 'id': int(new_id) }), 200
		except Exception as e:
			try:
				app.logger.error(f"Orders create(form) error: {e}")
			except Exception:
				pass
			return jsonify({ 'ok': False, 'error': 'server' }), 500

	@app.route('/api/orders/<int:order_id>', methods=['GET', 'POST'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def api_orders_get_or_update(order_id: int):
		try:
			prefix = app._sql.config['db']['prefix']
			# Fetch existing order
			rows = app._sql.execute_query(
				f"SELECT id, service, status, number, issued, start, end, responsible, work_name, approved, created_by, creator_gid, extended FROM {prefix}_order WHERE id=%s",
				[order_id]
			) or []
			if not rows:
				return jsonify({ 'ok': False, 'error': 'not found' }), 404
			row = rows[0]
			def to_iso(x):
				try:
					return (x if isinstance(x, dt) else dt.fromisoformat(str(x).split('.')[0].replace(' ', 'T'))).isoformat(sep=' ')
				except Exception:
					return ''
			order = {
				'id': int(row[0]),
				'service': str(row[1] or ''),
				'status': str(row[2] or ''),
				'number': str(row[3] or ''),
				'issued': to_iso(row[4]) if row[4] else '',
				'start': to_iso(row[5]) if row[5] else '',
				'end': to_iso(row[6]) if row[6] else '',
				'responsible': str(row[7] or ''),
				'work_name': str(row[8] or ''),
				'approved': int(row[9] or 0),
				'created_by': int(row[10]) if row[10] is not None else None,
				'creator_gid': int(row[11]) if row[11] is not None else None,
				'extended': bool(row[12]) if len(row) > 12 else False,
			}
			if request.method == 'GET':
				access_ctx = _load_orders_access_ctx()
				if not _can_view_order_dict(order, access_ctx):
					return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'view_permission_required' }), 403
				return jsonify({ 'ok': True, 'order': order })
			# POST update
			# Permission: admin or orders.edit_any; group-based allowed, BUT forbidden when approved == True
			groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
			service_gid = None
			for gid, name in groups:
				if str(name) == order['service']:
					service_gid = int(gid)
					break
			creator_gid = order.get('creator_gid')
			finalized = int(order.get('finalized', 0) or 0)
			approved_val = int(order.get('approved', 0) or 0)
			
			# If finalized=1, only admin can edit
			if finalized == 1:
				if not current_user.has('admin.any'):
					return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'finalized_locked' }), 403
			
			# Check if user has edit_approved permission - allows editing all orders regardless of approved status
			has_edit_approved = current_user.has('orders.edit_approved')
			
			if has_edit_approved:
				# With edit_approved permission, can edit all orders (except finalized=1, already checked above)
				can_edit = True
			else:
				# Without edit_approved, can only edit when approved != 1 (i.e., pending (0) or rejected (-1))
				if approved_val == 1:
					return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'approved_locked' }), 403
				# Standard edit permission logic for pending/rejected orders
				can_edit = (
					current_user.has('admin.any') or
					current_user.has('orders.edit_any') or
					current_user.has('orders.view_all') or
					(service_gid and current_user.gid == service_gid) or
					(creator_gid and current_user.gid == creator_gid)
				)
			
			if str(order.get('status', '')).strip().lower() == 'done':
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_locked' }), 403
			
			if not can_edit:
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'edit_permission_required' }), 403
			data = request.get_json(silent=True) or {}
			number = (data.get('number') or '').strip()
			responsible = (data.get('responsible') or '').strip()
			# Service should not be changed when editing an order
			work_name = (data.get('work_name') or '').strip()
			issued = (data.get('issued') or '').strip() or None
			start = (data.get('start') or '').strip() or None
			end = (data.get('end') or '').strip() or None
			missing = []
			if not number: missing.append('number')
			if not responsible: missing.append('responsible')
			if not work_name: missing.append('work_name')
			if missing:
				return jsonify({ 'ok': False, 'error': 'validation', 'missing': missing }), 400
			def norm_dt(x):
				if not x: return None
				try:

					return dt.fromisoformat(str(x).replace('T', ' '))
				except Exception:
					return None
			issued_dt = norm_dt(issued)
			start_dt = norm_dt(start)
			end_dt = norm_dt(end)
			app._sql.execute_non_query(
				f"UPDATE {prefix}_order SET number=%s, responsible=%s, work_name=%s, issued=%s, start=%s, end=%s WHERE id=%s;",
				[number, responsible, work_name, issued_dt, start_dt, end_dt, order_id]
			)
			# Ensure/refresh files subcategory for this order (keep folder, update display to reflect number)
			try:
				cat_id = app._sql.category_id_by_folder('orders') or app._sql._ensure_orders_category()
				folder = f'order-{order_id}'
				sub_id = app._sql.subcategory_id_by_folder(int(cat_id), folder)
				if not sub_id:
					# Create if missing
					display = f"{order_id} - {number}".strip()
					app._sql.subcategory_add([int(cat_id), display, folder, int(order_id), 1])
				else:
					# Update display name to keep in sync with order number
					existing = app._sql.subcategory_by_id([int(sub_id)])
					if existing:
						disp_order = int(getattr(existing, 'display_order', order_id) or order_id)
						enabled = int(getattr(existing, 'enabled', 1) or 1)
						display = f"{order_id} - {number}".strip()
						app._sql.subcategory_edit([int(cat_id), display, folder, disp_order, enabled, int(sub_id)])
			except Exception:
				pass
			# Emit realtime update
			_sock = socketio if socketio else getattr(app, 'socketio', None)
			if _sock:
				payload = {
					'reason': 'edit',
					'id': int(order_id),
				}
				_log.debug(f"[orders] emit orders:changed: {payload}")
				_sock.emit('orders:changed', payload)
			return jsonify({ 'ok': True })
		except Exception as e:
			try:
				app.logger.error(f"Orders get/update error: {e}")
			except Exception:
				pass
			return jsonify({ 'ok': False, 'error': 'server' }), 500

	@app.route('/api/orders/<int:order_id>/approved', methods=['POST'])
	@login_required
	@require_permissions(ORDERS_APPROVE)
	def api_orders_toggle_approved(order_id: int):
		"""
		Установка состояния согласования:
		- Если в запросе передан 'approved' (1 или -1), устанавливает это значение
		- Если 'approved' не передан, делает циклическое переключение: 0 -> 1 -> -1 -> 0
		"""
		try:
			data = request.get_json(silent=True) or {}
			requested_approved = data.get('approved')
			
			prefix = app._sql.config['db']['prefix']
			# Получаем текущее значение approved
			row = app._sql.execute_query(
				f"SELECT approved, status, issued, start, end FROM {prefix}_order WHERE id=%s",
				[order_id]
			) or []
			if not row:
				return jsonify({ 'ok': False, 'error': 'not_found' }), 404
			
			current_approved = int(row[0][0] or 0)
			st = str(row[0][1] or '').strip().lower()
			has_all_dates = (row[0][2] is not None and row[0][3] is not None and row[0][4] is not None)
			
			# Если запрошено конкретное значение, используем его
			if requested_approved is not None:
				try:
					next_val = int(requested_approved)
					# Проверяем, что значение валидное
					if next_val not in (-1, 0, 1):
						next_val = None  # Будет использовано циклическое переключение
				except (ValueError, TypeError):
					next_val = None  # Будет использовано циклическое переключение
			else:
				next_val = None
			
			# Если конкретное значение не указано, делаем циклическое переключение: 0 -> 1 -> -1 -> 0
			if next_val is None:
				if current_approved == 0:
					next_val = 1  # ожидание -> согласовано
				elif current_approved == 1:
					next_val = -1  # согласовано -> не согласовано
				elif current_approved == -1:
					next_val = 0  # не согласовано -> ожидание
				else:
					# Если значение нестандартное, начинаем с 0
					next_val = 0
			
			# Если пытаемся переключить с согласованного (1) на не согласовано (-1) или ожидание (0),
			# и наряд завершен со всеми датами -> запретить
			if current_approved == 1 and next_val != 1 and st == 'done' and has_all_dates:
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_with_all_dates_locked' }), 403
			
			app._sql.execute_non_query(
				f"UPDATE {app._sql.config['db']['prefix']}_order SET approved = %s WHERE id = %s;",
				[next_val, order_id]
			)
			
			# Логирование
			state_names = {0: 'ожидание', 1: 'согласовано', -1: 'не согласовано'}
			try:
				log_action('ORDER_APPROVE', current_user.name, 
					f'id={order_id} {state_names.get(current_approved, str(current_approved))} -> {state_names.get(next_val, str(next_val))}', 
					(request.remote_addr or ''))
			except Exception:
				pass
			
			# Emit realtime update
			_sock = socketio if socketio else getattr(app, 'socketio', None)
			if _sock:
				payload = {
					'reason': 'approve',
					'id': int(order_id),
					'approved': next_val,
				}
				_log.debug(f"[orders] emit orders:changed: {payload}")
				_sock.emit('orders:changed', payload)
			
			return jsonify({ 'ok': True, 'approved': next_val })
		except Exception as e:
			try:
				app.logger.error(f"Orders approve toggle error: {e}")
			except Exception:
				pass
			return jsonify({ 'ok': False, 'error': 'server' }), 500

	@app.route('/api/orders/<int:order_id>/status', methods=['POST'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def api_orders_update_status(order_id: int):
		"""Update order status. Only admin or orders.status_change. Allowed only when approved == True."""
		try:
			# Determine service of order to check approval and permissions
			prefix = app._sql.config['db']['prefix']
			row = app._sql.execute_query(f'SELECT service, status, approved, issued, start, end, creator_gid, finalized FROM {prefix}_order WHERE id=%s', [order_id])
			if not row:
				return jsonify({ 'ok': False, 'error': 'not found' }), 404
			service = (row[0][0] or '').strip()
			current_status = (row[0][1] or '').strip().lower()
			approved_val = int(row[0][2] or 0)
			issued = row[0][3]
			start = row[0][4]
			end = row[0][5]
			finalized = int(row[0][7] or 0)
			# Forbid further changes when completed unless override by admin or admin-group member
			def is_admin_group_member() -> bool:
				try:
					cfg = getattr(app._sql, 'config', {})
					from configparser import ConfigParser
					aname = 'Программисты'
					if isinstance(cfg, ConfigParser):
						aname = cfg.get('admin', 'group', fallback=aname) or aname
					else:
						if isinstance(cfg, dict):
							admin = cfg.get('admin') if hasattr(cfg, 'get') else None
							if isinstance(admin, dict) and 'group' in admin:
								aname = admin.get('group') or aname
							elif 'group' in cfg:
								aname = cfg.get('group') or aname
					name_norm = (aname or '').strip().lower()
					rows = app._sql.execute_query(f"SELECT id,name FROM {prefix}_group") or []
					for gid, gname in rows:
						if str(gname).strip().lower() == name_norm:
							return int(current_user.gid) == int(gid)
				except Exception:
					return False
				return False
			is_override = bool(current_user.has('admin.any') or is_admin_group_member())
			# Disabled: allow status changes even when current status is 'done'
			# if current_status == 'done' and not is_override:
			# 	return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_locked' }), 403
			# Permission: admin, explicit status_change, or membership in responsible/creator groups
			# Resolve service_gid
			groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
			service_gid = None
			service_norm = (service or '').strip().lower()
			for gid, name in groups:
				try:
					gname_norm = (str(name) or '').strip().lower()
					if gname_norm == service_norm:
						service_gid = int(gid)
						break
				except Exception:
					continue
			creator_gid = int(row[0][6]) if (row and len(row[0]) > 6 and row[0][6] is not None) else None
			# Status change allowed for: admins, explicit status_change permission, or members of service/creator groups
			# Note: orders.view_all and orders.edit_any are NOT sufficient for status changes
			can_change = (
				current_user.has('admin.any') or
				current_user.has(ORDERS_STATUS_CHANGE) or
				(service_gid and current_user.gid == service_gid) or
				(creator_gid and current_user.gid == creator_gid)
			)
			# Admin group membership override
			def _is_admin_group_member() -> bool:
				try:
					cfg = getattr(app._sql, 'config', {})
					from configparser import ConfigParser
					aname = 'Программисты'
					if isinstance(cfg, ConfigParser):
						aname = cfg.get('admin', 'group', fallback=aname) or aname
					else:
						if isinstance(cfg, dict):
							admin = cfg.get('admin') if hasattr(cfg, 'get') else None
							if isinstance(admin, dict) and 'group' in admin:
								aname = admin.get('group') or aname
							elif 'group' in cfg:
								aname = cfg.get('group') or aname
					name_norm = (aname or '').strip().lower()
					rows2 = app._sql.execute_query(f"SELECT id,name FROM {prefix}_group") or []
					for gid2, gname2 in rows2:
						if str(gname2).strip().lower() == name_norm:
							return int(current_user.gid) == int(gid2)
				except Exception:
					return False
				return False
			if not (can_change or _is_admin_group_member()):
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'status_change_permission_required' }), 403
			# Only when approved
			# Strict rule: status can be changed only when order is approved
			if approved_val != 1:
				return jsonify({ 'ok': False, 'error': 'not_approved', 'reason': 'not_approved' }), 400
			# New rule: finalized locks any further status changes
			if finalized == 1 and not current_user.has('admin.any'):
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'finalized_locked' }), 403
			# Lock when completed with all dates
			# Disabled: lock when completed with all dates
			# if current_status == 'done' and (issued is not None and start is not None and end is not None) and not (is_override or current_user.has('orders.view_all') or current_user.has('orders.edit_any')):
			# 	return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_with_all_dates_locked' }), 403
			# Read incoming desired status or cycle
			data = request.get_json(silent=True) or {}
			req_status = (data.get('status') or '').strip().lower()
			valid = ('stopped', 'in_progress', 'done')
			if req_status not in valid:
				# Cycle: stopped -> in_progress -> done -> stopped
				if current_status not in valid:
					next_status = 'stopped'
				elif current_status == 'stopped':
					next_status = 'in_progress'
				elif current_status == 'in_progress':
					next_status = 'done'
				else:
					next_status = 'stopped'
			else:
				next_status = req_status
			app._sql.execute_non_query(
				f"UPDATE {prefix}_order SET status=%s WHERE id=%s;",
				[next_status, order_id]
			)
			try:
				log_action('ORDER_STATUS', current_user.name, f'id={order_id} status={next_status}', (request.remote_addr or ''))
			except Exception:
				pass
			# Emit realtime update
			try:
				_sock = socketio if socketio else getattr(app, 'socketio', None)
				if _sock:
					payload = {
						'reason': 'status',
						'id': int(order_id),
						'status': next_status,
					}
					_log.debug(f"[orders] emit orders:changed: {payload}")
					_sock.emit('orders:changed', payload)
			except Exception:
				pass
			return jsonify({ 'ok': True, 'status': next_status })
		except Exception as e:
			try:
				app.logger.error(f"Orders status update error: {e}")
			except Exception:
				pass
			return jsonify({ 'ok': False, 'error': 'server' }), 500

	@app.route('/api/orders/<int:order_id>/timeline', methods=['POST'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def api_orders_update_timeline(order_id: int):
		"""Update order issued/start/end and status. Only admin or orders.status_change; only when approved == True."""
		try:
			prefix = app._sql.config['db']['prefix']
			row = app._sql.execute_query(f'SELECT service, approved, status, issued, start, end, creator_gid FROM {prefix}_order WHERE id=%s', [order_id])
			if not row:
				return jsonify({ 'ok': False, 'error': 'not found' }), 404
			service = (row[0][0] or '').strip()
			approved_val = int(row[0][1] or 0)
			current_status = str(row[0][2] or '').strip().lower()
			cur_issued = row[0][3]
			cur_start = row[0][4]
			cur_end = row[0][5]
			# Permission: admin, explicit status_change, or membership in responsible/creator groups
			groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
			service_gid = None
			service_norm = (service or '').strip().lower()
			for gid, name in groups:
				try:
					gname_norm = (str(name) or '').strip().lower()
					if gname_norm == service_norm:
						service_gid = int(gid)
						break
				except Exception:
					continue
			creator_gid = int(row[0][6]) if (row and len(row[0]) > 6 and row[0][6] is not None) else None
			# Admin group membership override helper (same as in status handler)
			def _is_admin_group_member() -> bool:
				try:
					cfg = getattr(app._sql, 'config', {})
					from configparser import ConfigParser
					aname = 'Программисты'
					if isinstance(cfg, ConfigParser):
						aname = cfg.get('admin', 'group', fallback=aname) or aname
					else:
						if isinstance(cfg, dict):
							admin = cfg.get('admin') if hasattr(cfg, 'get') else None
							if isinstance(admin, dict) and 'group' in admin:
								aname = admin.get('group') or aname
							elif 'group' in cfg:
								aname = cfg.get('group') or aname
					name_norm = (aname or '').strip().lower()
					rows2 = app._sql.execute_query(f"SELECT id,name FROM {prefix}_group") or []
					for gid2, gname2 in rows2:
						if str(gname2).strip().lower() == name_norm:
							return int(current_user.gid) == int(gid2)
				except Exception:
					return False
				return False
			can_change = (
				current_user.has('admin.any') or
				current_user.has(ORDERS_STATUS_CHANGE) or
				(service_gid and current_user.gid == service_gid) or
				(creator_gid and current_user.gid == creator_gid)
			)
			if not (can_change or _is_admin_group_member()):
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'status_change_permission_required' }), 403
			if approved_val != 1:
				return jsonify({ 'ok': False, 'error': 'not_approved', 'reason': 'not_approved' }), 400
			# Allow timeline updates even when status is 'done' for permitted users (no done_locked)
			data = request.get_json(silent=True) or {}
			def norm_dt(x):
				if not x: return None
				try:
					return dt.fromisoformat(str(x).replace('T', ' '))
				except Exception as e:
					try:
						app.logger.warning(f"orders.timeline: parse_error value={x} err={e}")
					except Exception:
						pass
					return None
			issued = norm_dt((data.get('issued') or '').strip() or None)
			start = norm_dt((data.get('start') or '').strip() or None)
			end = norm_dt((data.get('end') or '').strip() or None)
			try:
				app.logger.info(f"orders.timeline: id={order_id} ct={request.headers.get('Content-Type')} raw={data} parsed_issued={issued} parsed_start={start} parsed_end={end} approved={approved_val}")
			except Exception:
				pass
			status = (data.get('status') or '').strip().lower()
			if status not in ('stopped','in_progress','done',''):
				return jsonify({ 'ok': False, 'error': 'bad status' }), 400
			# If approved: allow only completion — update end, force status=done; keep issued/start unchanged
			if approved_val == 1:
				# Require end
				if end is None:
					try:
						app.logger.warning(f"orders.timeline: dates_required id={order_id} end=None raw_end={data.get('end')}")
					except Exception:
						pass
					return jsonify({ 'ok': False, 'error': 'dates_required' }), 400
				# Validate order: end after existing issued/start when present
				if cur_issued and end <= cur_issued:
					return jsonify({ 'ok': False, 'error': 'dates_order' }), 400
				if cur_start and end <= cur_start:
					return jsonify({ 'ok': False, 'error': 'dates_order' }), 400
			app._sql.execute_non_query(
				f"UPDATE {prefix}_order SET end=%s, status=%s, finalized=1 WHERE id=%s",
				[end, 'done', order_id]
			)
			try:
				log_action('ORDER_COMPLETE', current_user.name, f'id={order_id} end={end}', (request.remote_addr or ''))
			except Exception:
				pass
			# Emit realtime update (completion)
			try:
				_sock = socketio if socketio else getattr(app, 'socketio', None)
				if _sock:
					payload = {
						'reason': 'timeline',
						'id': int(order_id),
						'status': 'done',
					}
					_sock.emit('orders:changed', payload)
					try:
						import logging
						_log = logging.getLogger(__name__)
						_log.info(f"[orders] emit orders:changed event: {payload}")
					except Exception:
						pass
			except Exception:
				pass
			return jsonify({ 'ok': True })
			# Not approved: update any provided fields
			fields = ['issued = %s', 'start = %s', 'end = %s']
			values = [issued, start, end]
			if status:
				fields.append('status = %s')
				values.append(status)
			values.append(order_id)
			app._sql.execute_non_query(
				f"UPDATE {prefix}_order SET " + ', '.join(fields) + " WHERE id=%s",
				values
			)
			try:
				log_action('ORDER_TIMELINE', current_user.name, f'id={order_id} issued={issued} start={start} end={end} status={status or "(nochange)"}', (request.remote_addr or ''))
			except Exception:
				pass
			# Emit realtime update (timeline updated)
			try:
				_sock = socketio if socketio else getattr(app, 'socketio', None)
				if _sock:
					payload = {
						'reason': 'timeline',
						'id': int(order_id),
					}
					_log.debug(f"[orders] emit orders:changed: {payload}")
					_sock.emit('orders:changed', payload)
			except Exception:
				pass
			return jsonify({ 'ok': True })
		except Exception as e:
			try:
				app.logger.error(f"Orders timeline update error: {e}")
			except Exception:
				pass
			return jsonify({ 'ok': False, 'error': 'server' }), 500

	@app.route('/api/orders/<int:order_id>/extend', methods=['POST'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def api_orders_extend(order_id: int):
		"""One-time extension: allow changing start/end/status once when approved and not done.
		Accessible to same users as completion (admin, orders.status_change, service/creator group)."""
		try:
			prefix = app._sql.config['db']['prefix']
			row = app._sql.execute_query(f'SELECT service, approved, status, issued, start, end, extended, creator_gid FROM {prefix}_order WHERE id=%s', [order_id])
			if not row:
				return jsonify({ 'ok': False, 'error': 'not found' }), 404
			service = (row[0][0] or '').strip()
			approved_val = int(row[0][1] or 0)
			current_status = str(row[0][2] or '').strip().lower()
			cur_issued = row[0][3]
			already_extended = int(row[0][6] or 0) == 1
			creator_gid = int(row[0][7]) if (row and len(row[0]) > 7 and row[0][7] is not None) else None
			# Permissions: same as completion
			groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
			service_gid = None
			service_norm = (service or '').strip().lower()
			for gid, name in groups:
				try:
					gname_norm = (str(name) or '').strip().lower()
					if gname_norm == service_norm:
						service_gid = int(gid)
						break
				except Exception:
					continue
			can_change = (
				current_user.has('admin.any') or
				current_user.has(ORDERS_STATUS_CHANGE) or
				(service_gid and current_user.gid == service_gid) or
				(creator_gid and current_user.gid == creator_gid)
			)
			if not can_change:
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'status_change_permission_required' }), 403
			# Business rules
			# Allow users with ORDERS_STATUS_CHANGE to extend as well (besides admin/admin-group), with standard constraints
			_hasStatusChange = bool(current_user.has(ORDERS_STATUS_CHANGE))
			if approved_val != 1 and not (_is_admin_group_member() or current_user.has('admin.any') or _hasStatusChange):
				return jsonify({ 'ok': False, 'error': 'not_approved', 'reason': 'not_approved' }), 400
			if current_status == 'done' and not (_is_admin_group_member() or current_user.has('admin.any') or _hasStatusChange):
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_locked' }), 403
			if already_extended and not (_is_admin_group_member() or current_user.has('admin.any') or _hasStatusChange):
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'already_extended' }), 400
			# Parse input
			data = request.get_json(silent=True) or {}
			def norm_dt(x):
				if not x: return None
				try:
					return dt.fromisoformat(str(x).replace('T', ' '))
				except Exception:
					return None
			start = norm_dt((data.get('start') or '').strip() or None)
			end = norm_dt((data.get('end') or '').strip() or None)
			status = (data.get('status') or '').strip().lower()
			try:
				app.logger.info(f"orders.extend: id={order_id} ct={request.headers.get('Content-Type')} raw={data} parsed_start={start} parsed_end={end} approved={approved_val}")
			except Exception:
				pass
			if status not in ('stopped','in_progress','done',''):
				return jsonify({ 'ok': False, 'error': 'bad status' }), 400
			# Validate: require end and start; end > start; and if issued exists, start > issued
			if start is None or end is None:
				return jsonify({ 'ok': False, 'error': 'dates_required' }), 400
			if end <= start:
				return jsonify({ 'ok': False, 'error': 'dates_order' }), 400
			if cur_issued and start <= cur_issued:
				return jsonify({ 'ok': False, 'error': 'dates_order' }), 400
			# Apply update and mark extended once
			set_status = status or current_status or 'stopped'
			app._sql.execute_non_query(
				f"UPDATE {prefix}_order SET start=%s, end=%s, status=%s, extended=1 WHERE id=%s",
				[start, end, set_status, order_id]
			)
			try:
				log_action('ORDER_EXTEND', current_user.name, f'id={order_id} start={start} end={end} status={set_status}', (request.remote_addr or ''))
			except Exception:
				pass
			# Emit realtime update
			try:
				_sock = socketio if socketio else getattr(app, 'socketio', None)
				if _sock:
					payload = {
						'reason': 'extend',
						'id': int(order_id),
					}
					_log.debug(f"[orders] emit orders:changed: {payload}")
					_sock.emit('orders:changed', payload)
			except Exception:
				pass
			return jsonify({ 'ok': True })
		except Exception as e:
			try:
				app.logger.error(f"Orders extend error: {e}")
			except Exception:
				pass
			return jsonify({ 'ok': False, 'error': 'server' }), 500

	@app.route('/api/orders/search', methods=['GET'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def api_orders_search():
		"""Search orders with filters and pagination. Аналог users_search/groups_search"""
		try:
			page = int((request.args.get('page') or '1').strip() or '1')
			page_size = int((request.args.get('page_size') or '10').strip() or '10')
			q = (request.args.get('q') or '').strip().lower()
			status_in = set([s.strip().lower() for s in (request.args.get('status_in') or 'in_progress,stopped,done').split(',') if s.strip()])
			date_from = (request.args.get('date_from') or '').strip()
			date_to = (request.args.get('date_to') or '').strip()
			access_ctx = _load_orders_access_ctx()
			has_view_all = bool(access_ctx.get('has_view_all'))
			service = _norm_service_name(str(request.args.get('service') or ''))
			if not has_view_all:
				allowed_services = set([_norm_service_name(s) for s in _get_accessible_service_names(access_ctx)])
				if service and service not in allowed_services:
					service = ''
			def parse_date(d):
				try:
					return dt.strptime(d, '%Y-%m-%d')
				except Exception:
					return None
			df = parse_date(date_from)
			dt_to = parse_date(date_to)
			if dt_to is not None:
				dt_to = dt_to.replace(hour=23, minute=59, second=59, microsecond=999999)
			if not df or not dt_to:
				now = dt.now()
				first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
				next_month = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
				last = next_month - timedelta(seconds=1)
				df = df or first
				dt_to = dt_to or last
			rows = app._sql.order_all() or []
			result = []
			for o in rows:
				# status/фильтр
				st = (getattr(o, 'status', '') or '').strip().lower()
				if st in ('in_progress', 'process', '0', 'ведутся'):
					stn = 'in_progress'
				elif st in ('stopped', '-1', 'не ведутся'):
					stn = 'stopped'
				elif st in ('done', '1', 'completed', 'завершены'):
					stn = 'done'
				else:
					stn = 'in_progress'
				if stn not in status_in:
					continue
				if service:
					srv_field = _norm_service_name(str(getattr(o, 'service', '') or ''))
					if srv_field != service:
						continue
				if not _can_view_order_row(o, access_ctx):
					continue
				# Даты -- issued/start/end/created пересечение с df...dt_to
				def to_dt(x):
					try:
						return x if isinstance(x, dt) else dt.fromisoformat(str(x).split('.')[0].replace(' ', 'T'))
					except Exception:
						return None
				issued = to_dt(getattr(o, 'issued', None))
				start = to_dt(getattr(o, 'start', None))
				end = to_dt(getattr(o, 'end', None))
				created = to_dt(getattr(o, 'created_at', None))
				in_range = any(d and df <= d <= dt_to for d in (issued, start, end)) or (
					(not issued and not start and not end) and (created and df <= created <= dt_to)
				)
				if not in_range:
					continue
				# Поиск по всем отображаемым колонкам и по всем страницам
				def fmt_dt(d):
					try:
						return d.strftime('%Y-%m-%d %H:%M') if isinstance(d, dt) else str(d or '')
					except Exception:
						return str(d or '')
				# Three states: 0 = ожидание, 1 = согласовано, -1 = не согласовано
				approved_val = int(getattr(o, 'approved', 0) or 0)
				if approved_val == 1:
					approved_txt = 'согласовано'
				elif approved_val == -1:
					approved_txt = 'не согласовано'
				else:
					approved_txt = 'ожидание'
				status_ru = {
					'in_progress': 'работы ведутся',
					'stopped': 'работы не ведутся',
					'done': 'работы завершены',
				}.get(stn, stn)
				hay = ' '.join([
					str(getattr(o, 'service', '') or ''),
					str(getattr(o, 'number', '') or ''),
					str(getattr(o, 'responsible', '') or ''),
					str(getattr(o, 'work_name', '') or ''),
					fmt_dt(issued) or '',
					fmt_dt(start) or '',
					fmt_dt(end) or '',
					approved_txt,
					status_ru,
					str(getattr(o, 'note', '') or ''),
					str(getattr(o, 'id', '') or ''),
				]).lower()
				if q and q not in hay:
					continue
				result.append({
					'id': o.id,
					'service': getattr(o, 'service', ''),
					'status': stn,
					'number': getattr(o, 'number', ''),
					'issued': (issued.isoformat(sep=' ') if issued else ''),
					'start': (start.isoformat(sep=' ') if start else ''),
					'end': (end.isoformat(sep=' ') if end else ''),
					'responsible': getattr(o, 'responsible', ''),
					'work_name': getattr(o, 'work_name', ''),
					'approved': int(getattr(o, 'approved', 0) or 0),
					'files': 0,
					'note': getattr(o, 'note', '') or '',
					'extended': bool(getattr(o, 'extended', False)),
				})
			total = len(result)
			pages = max(1, (total + page_size - 1) // page_size)
			page = max(1, min(page, pages))
			start_idx = (page - 1) * page_size
			end_idx = start_idx + page_size
			items = result[start_idx:end_idx]
			return jsonify({
				'items': items,
				'total': total,
				'page': page,
				'page_size': page_size,
			})
		except Exception as e:
			app.logger.error(f"Orders search error: {e}")
			return jsonify({'items': [], 'total': 0, 'page': 1, 'page_size': page_size}), 200

	@app.route('/orders/print', methods=['GET', 'POST'], endpoint='orders_print')
	def orders_print():
		"""Render print table: orders active for selected date, excluding completed."""

		getter = (request.args if request.method == 'GET' else request.form)
		date_raw = getter.get('date')
		date_str = (date_raw or '').strip()
		resp = (getter.get('responsible') or '').strip()
		job1 = (getter.get('job1') or '').strip()
		job2 = (getter.get('job2') or '').strip()
		def _format_display(raw: str) -> str:
			if not raw:
				return ''
			try:
				raw = raw.strip()
			except Exception:
				pass
			try:
				parsed = dt.fromisoformat(raw.replace(' ', 'T'))
				return parsed.strftime('%d.%m.%Y')
			except Exception:
				pass
			for fmt in ('%Y-%m-%d', '%d.%m.%Y', '%d-%m-%Y', '%Y.%m.%d'):
				try:
					return dt.strptime(raw, fmt).strftime('%d.%m.%Y')
				except Exception:
					continue
			try:
				clean = raw.split('T')[0].split(' ')[0]
				return dt.strptime(clean.replace('/', '-'), '%Y-%m-%d').strftime('%d.%m.%Y')
			except Exception:
				pass
			return raw.replace('-', '.').replace('/', '.')
		# Basic validation
		missing = []
		if not date_str: missing.append('date')
		if not resp: missing.append('responsible')
		if not job1: missing.append('job1')
		if missing:
			return render_template('orders_table_print.j2.html', date=_format_display(date_str), resp=resp, job=[job1, job2], data=[[], {}])
		def _parse_day(raw: str):
			if not raw:
				return None
			candidates = []
			try:
				clean = raw.strip()
			except Exception:
				clean = raw
			if not clean:
				return None
			candidates.append(clean)
			try:
				candidates.append(clean.replace('/', '-'))
			except Exception:
				pass
			try:
				if 'T' in clean:
					candidates.append(clean.split('T')[0])
				elif ' ' in clean:
					candidates.append(clean.split(' ')[0])
			except Exception:
				pass
			formats = ('%Y-%m-%d', '%d.%m.%Y', '%d-%m-%Y', '%Y.%m.%d')
			for candidate in candidates:
				for fmt in formats:
					try:
						return dt.strptime(candidate, fmt).date()
					except Exception:
						continue
				try:
					return dt.fromisoformat(candidate.replace(' ', 'T')).date()
				except Exception:
					continue
			return None
		day = _parse_day(date_str)
		if not day:
			return render_template('orders_table_print.j2.html', date=_format_display(date_str), resp=resp, job=[job1, job2], data=[[], {}])
		date_display = day.strftime('%d.%m.%Y')
		# Load all orders and filter: start <= day <= end, status != 'done'
		rows = app._sql.order_all() or []
		def to_dt(x):
			try:
				return x if isinstance(x, dt) else dt.fromisoformat(str(x).split('.')[0].replace(' ', 'T'))
			except Exception:
				return None
		orders = []
		for o in rows:
			st = (getattr(o, 'status', '') or '').strip().lower()
			if st in ('done', '1', 'completed', 'завершены'):
				continue
			start = to_dt(getattr(o, 'start', None))
			end = to_dt(getattr(o, 'end', None))
			if not start or not end:
				continue
			if not (start.date() <= day <= end.date()):
				continue
			def fmt(v):
				try:
					return v.strftime('%Y-%m-%d %H:%M') if isinstance(v, dt) else str(v)
				except Exception:
					return str(v)
			orders.append({
				'department': (getattr(o, 'service', '') or ''),
				'number': (getattr(o, 'number', '') or ''),
				'start_date': fmt(start),
				'end_date': fmt(end),
				'responsible': (getattr(o, 'responsible', '') or ''),
				'jobs': (getattr(o, 'work_name', '') or ''),
			})
		deps = {}
		for o in orders:
			name = (o.get('department') or '').strip()
			if name and name not in deps:
				deps[name] = name
		return render_template('orders_table_print.j2.html', date=date_display, resp=resp, job=[job1, job2], data=[orders, deps])

	@app.route('/orders/<int:order_id>/files', methods=['GET'])
	@login_required
	def orders_files_embed(order_id: int):
		"""Open files UI for this order in embed mode: ensure system category 'orders' and subcategory 'order-<id>'.
		Redirect to /files with cat_id/sub_id and embed flags.
		"""
		# Ensure system category and subcategory for this order
		cat_id = app._sql.category_id_by_folder('orders')
		if not cat_id:
			cat_id = app._sql._ensure_orders_category()
		folder = f'order-{order_id}'
		sub_id = app._sql.subcategory_id_by_folder(int(cat_id), folder)
		if not sub_id:
			# Try to create with display "<id> - <number>"
			ord = app._sql.order_by_id([order_id])
			display = f"{order_id} - {getattr(ord, 'number', '')}".strip()
			try:
				app._sql.subcategory_add([int(cat_id), display, folder, int(order_id), 1])
			except Exception:
				pass
			sub_id = app._sql.subcategory_id_by_folder(int(cat_id), folder)

		# Compute permission overrides for embed
		force_can_manage = 0
		force_can_add = 0
		# Notes must follow standard file permissions in embed (no force)
		force_can_notes = 0
		perms = getattr(current_user, 'permissions', set()) or set()
		if ADMIN_ANY in perms or ORDERS_FILES_EDIT in perms:
			force_can_manage = 1
			force_can_add = 1
		elif ORDERS_FILES_VIEW in perms:
			force_can_manage = 0
			force_can_add = 0
			# keep notes forced off
		else:
			# Group-based: full access if user's gid matches order's service group
			prefix = app._sql.config['db']['prefix']
			row = app._sql.execute_query(f'SELECT service, creator_gid FROM {prefix}_order WHERE id=%s', [order_id])
			service = row[0][0] if row else ''
			creator_gid = int(row[0][1]) if (row and row[0][1] is not None) else None
			groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
			service_gid = None
			for gid, name in groups:
				if name == service:
					service_gid = int(gid)
					break
			if (service_gid and current_user.gid == service_gid) or (creator_gid and current_user.gid == creator_gid):
				force_can_manage = 1
				force_can_add = 1
				# do not force notes in embed; use standard file permissions only

		# Build redirect to files with embed flags
		return redirect(url_for('files', embed=1, no_move=1, cat_id=cat_id, sub_id=sub_id, force_can_manage=force_can_manage, force_can_add=force_can_add, force_can_notes=force_can_notes))

	@app.route('/orders/note/<int:order_id>', methods=['POST'])
	@login_required
	def orders_note(order_id):
		note = request.form.get('note', '').strip()
		try:
			prefix = app._sql.config['db']['prefix']
			# Найти order и узнать service (служба, == group.name)
			row = app._sql.execute_query(f'SELECT service, creator_gid FROM {prefix}_order WHERE id=%s', [order_id])
			if not row:
				return jsonify({'ok': False, 'error': 'not found'}), 404
			service = row[0][0]
			creator_gid = int(row[0][1]) if (row and row[0][1] is not None) else None
			# Получить все группы (имя->id)
			groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
			service_gid = None
			for gid,name in groups:
				if name == service:
					service_gid = int(gid)
			can_note = (
				current_user.has('orders.notes')
				or current_user.has('orders.edit_any')
				or current_user.has('admin.any')
				or (service_gid and current_user.gid == service_gid)
				or (creator_gid and current_user.gid == creator_gid)
			)
			if not can_note:
				return jsonify({'ok': False, 'error': 'forbidden'}), 403
			# Обновить note
			app._sql.execute_non_query(f'UPDATE {prefix}_order SET note=%s WHERE id=%s', [note, order_id])
			try:
				log_action('ORDER_NOTE', current_user.name, f'id={order_id} note_len={len(note)}', (request.remote_addr or ''))
			except Exception:
				pass
			# Emit realtime update to orders listeners
			try:
				_sock = socketio if socketio else getattr(app, 'socketio', None)
				if _sock:
					payload = {
						'reason': 'note',
						'id': int(order_id),
					}
					_log.debug(f"[orders] emit orders:changed: {payload}")
					_sock.emit('orders:changed', payload)
			except Exception:
				pass
			return jsonify({'ok': True}), 200
		except Exception as e:
			return jsonify({'ok': False, 'error': str(e)}), 500

	@app.route('/orders/delete/<int:order_id>', methods=['POST'])
	@login_required
	def orders_delete(order_id: int):
		try:
			prefix = app._sql.config['db']['prefix']
			# Resolve service, approval and status to check permissions and locks
			row = app._sql.execute_query(f'SELECT service, approved, status, creator_gid FROM {prefix}_order WHERE id=%s', [order_id])
			if not row:
				return jsonify({'ok': False, 'error': 'not found'}), 404
			service = row[0][0]
			approved_val = int(row[0][1] or 0)
			cur_status = str(row[0][2] or '').strip().lower()
			groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
			service_gid = None
			for gid, name in groups:
				if name == service:
					service_gid = int(gid)
					break
			creator_gid = int(row[0][3]) if (row and len(row[0]) > 3 and row[0][3] is not None) else None
			can_delete = (
				current_user.has('admin.any') or
				current_user.has(ORDERS_DELETE_ANY) or
				(service_gid and current_user.gid == service_gid) or
				(creator_gid and current_user.gid == creator_gid)
			)
			if not can_delete:
				return jsonify({'ok': False, 'error': 'forbidden', 'reason': 'delete_permission_required'}), 403
			
			# Check if user is admin (admin.any or admin group member)
			def _is_admin_group_member() -> bool:
				try:
					cfg = getattr(app._sql, 'config', {})
					from configparser import ConfigParser
					aname = 'Программисты'
					if isinstance(cfg, ConfigParser):
						aname = cfg.get('admin', 'group', fallback=aname) or aname
					else:
						if isinstance(cfg, dict):
							admin = cfg.get('admin') if hasattr(cfg, 'get') else None
							if isinstance(admin, dict) and 'group' in admin:
								aname = admin.get('group') or aname
							elif 'group' in cfg:
								aname = cfg.get('group') or aname
					name_norm = (aname or '').strip().lower()
					prefix = app._sql.config['db']['prefix']
					rows = app._sql.execute_query(f"SELECT id,name FROM {prefix}_group") or []
					for gid, gname in rows:
						if str(gname).strip().lower() == name_norm:
							return int(current_user.gid) == int(gid)
				except Exception:
					return False
				return False
			
			is_admin = current_user.has('admin.any') or _is_admin_group_member()
			
			# Disallow delete if approved (1) or rejected (-1) or completed
			# Only pending (0) allows deletion, except for admins
			if not is_admin and (approved_val != 0 or cur_status == 'done'):
				return jsonify({'ok': False, 'error': 'forbidden', 'reason': 'approved_locked'}), 403
			# Delete order
			app._sql.execute_non_query(f'DELETE FROM {prefix}_order WHERE id=%s', [order_id])
			# Cleanup files subcategory and files for this order
			try:
				cat_id = app._sql.category_id_by_folder('orders')
				folder = f'order-{order_id}'
				if cat_id:
					sub_id = app._sql.subcategory_id_by_folder(int(cat_id), folder)
					if sub_id:
						# Remove files in this subcategory (DB and FS)
						files = app._sql.file_by_category_and_subcategory([int(cat_id), int(sub_id)])

						for f in files or []:
							# Compute path and remove file from filesystem; always remove DB record
							dir_path = app._sql.get_file_storage_path(int(cat_id), int(sub_id))
							file_path = os.path.join(dir_path, getattr(f, 'real_name', '') or getattr(f, 'file_name', ''))
							try:
								if file_path and os.path.exists(file_path):
									os.remove(file_path)
							except Exception:
								pass
							app._sql.file_delete([int(f.id)])
						# Delete subcategory itself
						app._sql.subcategory_delete([int(sub_id)])
			except Exception:
				pass
			try:
				log_action('ORDER_DELETE', current_user.name, f'id={order_id} service={service}', (request.remote_addr or ''))
			except Exception:
				pass
			# Emit realtime update
			try:
				_sock = socketio if socketio else getattr(app, 'socketio', None)
				if _sock:
					payload = {
						'reason': 'delete',
						'id': int(order_id),
					}
					_log.debug(f"[orders] emit orders:changed: {payload}")
					_sock.emit('orders:changed', payload)
			except Exception:
				pass
			return jsonify({'ok': True}), 200
		except Exception as e:
			try:
				app.logger.error(f"Orders delete error: {e}")
			except Exception:
				pass
			return jsonify({'ok': False, 'error': 'server'}), 500
