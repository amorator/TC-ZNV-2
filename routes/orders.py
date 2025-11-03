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
)
from flask import redirect, url_for
from modules.logging import log_action


def register(app, socketio=None):
	@app.route('/orders', methods=['GET'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def orders():
		# Load groups for service select (no redundant try/except)
		prefix = app._sql.config['db']['prefix']
		rows = app._sql.execute_query(f"SELECT id, name FROM {prefix}_group ORDER BY name;") or []
		groups = [{'id': int(r[0]), 'name': str(r[1])} for r in rows]
		return render_template('orders.j2.html',
							   title='Наряды — Заявки-Наряды-Файлы',
							   id=2,
					   groups=groups)

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
			# Filters: status_in (csv of in_progress,stopped,done), date_from, date_to (YYYY-MM-DD)
			status_in = set([s.strip().lower() for s in (request.args.get('status_in') or 'in_progress,stopped,done').split(',') if s.strip()])
			date_from = (request.args.get('date_from') or '').strip()
			date_to = (request.args.get('date_to') or '').strip()
			q = (request.args.get('q') or '').strip().lower()
			service = (request.args.get('service') or '').strip().lower()
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
					srv_field = (getattr(o, 'service', '') or '').strip().lower()
					if srv_field != service:
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
				# text search
				if q:
					hay = ' '.join([
						getattr(o, 'service', '') or '',
						getattr(o, 'number', '') or '',
						getattr(o, 'responsible', '') or '',
						getattr(o, 'work_name', '') or '',
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
					'approved': bool(getattr(o, 'approved', False)),
					'files': 0,
					'note': getattr(o, 'note', '') or '',
					'extended': bool(getattr(o, 'extended', False)),
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
			service = (data.get('service') or '').strip()
			number = (data.get('number') or '').strip()
			responsible = (data.get('responsible') or '').strip()
			work_name = (data.get('work_name') or '').strip()
			status = (data.get('status') or 'stopped').strip().lower() or 'stopped'
			issued = (data.get('issued') or '').strip() or None
			start = (data.get('start') or '').strip() or None
			end = (data.get('end') or '').strip() or None
			# Backend validation: required fields except 3 date fields
			missing = []
			if not service: missing.append('service')
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
			# issued date must be today or later (ignore time)
			try:
				if issued_dt.date() < dt.now().date():
					return jsonify({ 'ok': False, 'error': 'issued_too_early' }), 400
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
			service = (request.form.get('service') or '').strip()
			number = (request.form.get('number') or '').strip()
			responsible = (request.form.get('responsible') or '').strip()
			work_name = (request.form.get('work_name') or '').strip()
			status = (request.form.get('status') or 'stopped').strip().lower() or 'stopped'
			issued = (request.form.get('issued') or '').strip() or None
			start = (request.form.get('start') or '').strip() or None
			end = (request.form.get('end') or '').strip() or None
			missing = []
			if not service: missing.append('service')
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
			new_id = app._sql.order_add([
				service,
				status,
				number,
				issued_dt,
				start_dt,
				end_dt,
				responsible,
				work_name,
				0,
			])
			# Set creator metadata
			try:
				app._sql.execute_non_query(
					f"UPDATE {app._sql.config['db']['prefix']}_order SET created_by = %s, creator_gid = %s WHERE id = %s;",
					[current_user.id, current_user.gid, int(new_id)]
				)
			except Exception:
				pass
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
				'approved': bool(row[9]),
				'created_by': int(row[10]) if row[10] is not None else None,
				'creator_gid': int(row[11]) if row[11] is not None else None,
				'extended': bool(row[12]) if len(row) > 12 else False,
			}
			if request.method == 'GET':
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
			can_edit = (
				current_user.has('admin.any') or
				current_user.has('orders.edit_any') or
				(service_gid and current_user.gid == service_gid) or
				(creator_gid and current_user.gid == creator_gid)
			)
			# Disallow edit if approved or already completed
			if str(order.get('status', '')).strip().lower() == 'done':
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_locked' }), 403
			if order.get('approved'):
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'approved_locked' }), 403
			if not can_edit:
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'edit_permission_required' }), 403
			data = request.get_json(silent=True) or {}
			number = (data.get('number') or '').strip()
			responsible = (data.get('responsible') or '').strip()
			service = (data.get('service') or '').strip() or order['service']
			work_name = (data.get('work_name') or '').strip()
			issued = (data.get('issued') or '').strip() or None
			start = (data.get('start') or '').strip() or None
			end = (data.get('end') or '').strip() or None
			missing = []
			if not service: missing.append('service')
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
				f"UPDATE {prefix}_order SET service=%s, number=%s, responsible=%s, work_name=%s, issued=%s, start=%s, end=%s WHERE id=%s;",
				[service, number, responsible, work_name, issued_dt, start_dt, end_dt, order_id]
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
		try:
			data = request.get_json(silent=True) or {}
			approved = data.get('approved')
			# normalize to 0/1
			val = 1 if (str(approved).lower() in ('1','true','yes','on')) else 0
			# If trying to unapprove, and order is done and all 3 dates filled -> forbid
			prefix = app._sql.config['db']['prefix']
			row = app._sql.execute_query(
				f"SELECT status, issued, start, end FROM {prefix}_order WHERE id=%s",
				[order_id]
			) or []
			if row:
				st = str(row[0][0] or '').strip().lower()
				has_all_dates = (row[0][1] is not None and row[0][2] is not None and row[0][3] is not None)
				if val == 0 and st == 'done' and has_all_dates:
					return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_with_all_dates_locked' }), 403
			app._sql.execute_non_query(
				f"UPDATE {app._sql.config['db']['prefix']}_order SET approved = %s WHERE id = %s;",
				[val, order_id]
			)
			try:
				log_action('ORDER_APPROVE', current_user.name, f'id={order_id} approved={bool(val)}', (request.remote_addr or ''))
			except Exception:
				pass
			return jsonify({ 'ok': True, 'approved': bool(val) })
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
			row = app._sql.execute_query(f'SELECT service, status, approved, issued, start, end, creator_gid FROM {prefix}_order WHERE id=%s', [order_id])
			if not row:
				return jsonify({ 'ok': False, 'error': 'not found' }), 404
			service = (row[0][0] or '').strip()
			current_status = (row[0][1] or '').strip().lower()
			approved_val = int(row[0][2] or 0)
			issued = row[0][3]
			start = row[0][4]
			end = row[0][5]
			# Forbid any further status changes once completed
			if current_status == 'done':
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_locked' }), 403
			# Permission: admin, explicit status_change, or membership in responsible/creator groups
			# Resolve service_gid
			groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
			service_gid = None
			for gid, name in groups:
				if name == service:
					service_gid = int(gid)
					break
			creator_gid = int(row[0][6]) if (row and len(row[0]) > 6 and row[0][6] is not None) else None
			can_change = (
				current_user.has('admin.any') or
				current_user.has(ORDERS_STATUS_CHANGE) or
				(service_gid and current_user.gid == service_gid) or
				(creator_gid and current_user.gid == creator_gid)
			)
			if not can_change:
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'status_change_permission_required' }), 403
			# Only when approved
			if approved_val != 1:
				return jsonify({ 'ok': False, 'error': 'not_approved', 'reason': 'not_approved' }), 400
			# Lock when completed with all dates
			if current_status == 'done' and (issued is not None and start is not None and end is not None):
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_with_all_dates_locked' }), 403
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
			for gid, name in groups:
				if name == service:
					service_gid = int(gid)
					break
			creator_gid = int(row[0][6]) if (row and len(row[0]) > 6 and row[0][6] is not None) else None
			can_change = (
				current_user.has('admin.any') or
				current_user.has(ORDERS_STATUS_CHANGE) or
				(service_gid and current_user.gid == service_gid) or
				(creator_gid and current_user.gid == creator_gid)
			)
			if not can_change:
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'status_change_permission_required' }), 403
			if approved_val != 1:
				return jsonify({ 'ok': False, 'error': 'not_approved', 'reason': 'not_approved' }), 400
			# Forbid any further timeline changes once completed
			if current_status == 'done':
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_locked' }), 403
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
					f"UPDATE {prefix}_order SET end=%s, status=%s WHERE id=%s",
					[end, 'done', order_id]
				)
				try:
					log_action('ORDER_COMPLETE', current_user.name, f'id={order_id} end={end}', (request.remote_addr or ''))
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
			for gid, name in groups:
				if name == service:
					service_gid = int(gid)
					break
			can_change = (
				current_user.has('admin.any') or
				current_user.has(ORDERS_STATUS_CHANGE) or
				(service_gid and current_user.gid == service_gid) or
				(creator_gid and current_user.gid == creator_gid)
			)
			if not can_change:
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'status_change_permission_required' }), 403
			# Business rules
			if approved_val != 1:
				return jsonify({ 'ok': False, 'error': 'not_approved', 'reason': 'not_approved' }), 400
			if current_status == 'done':
				return jsonify({ 'ok': False, 'error': 'forbidden', 'reason': 'done_locked' }), 403
			if already_extended:
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
			service = (request.args.get('service') or '').strip().lower()
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
					srv_field = (getattr(o, 'service', '') or '').strip().lower()
					if srv_field != service:
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
				# Поиск. Достаточно service, number, responsible, work_name (как в /api/orders)
				hay = ' '.join([
					getattr(o, 'service', '') or '',
					getattr(o, 'number', '') or '',
					getattr(o, 'responsible', '') or '',
					getattr(o, 'work_name', '') or '',
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
					'approved': bool(getattr(o, 'approved', False)),
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
		date_str = (getter.get('date') or '').strip()
		resp = (getter.get('responsible') or '').strip()
		job1 = (getter.get('job1') or '').strip()
		job2 = (getter.get('job2') or '').strip()
		# Basic validation
		missing = []
		if not date_str: missing.append('date')
		if not resp: missing.append('responsible')
		if not job1: missing.append('job1')
		if missing:
			return render_template('orders_table_print.j2.html', date=(date_str or ''), resp=resp, job=[job1, job2], data=[[], {}])
		try:
			day = _dt.strptime(date_str, '%Y-%m-%d').date()
		except Exception:
			return jsonify({ 'ok': False, 'error': 'validation', 'missing': ['date'] }), 400
		# Load all orders and filter: start <= day <= end, status != 'done'
		rows = app._sql.order_all() or []
		def to_dt(x):
			try:
				return x if isinstance(x, _dt) else _dt.fromisoformat(str(x).split('.')[0].replace(' ', 'T'))
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
					return v.strftime('%Y-%m-%d %H:%M') if isinstance(v, _dt) else str(v)
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
		return render_template('orders_table_print.j2.html', date=date_str, resp=resp, job=[job1, job2], data=[orders, deps])

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
			# Disallow delete if approved or completed
			if approved_val == 1 or cur_status == 'done':
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
			return jsonify({'ok': True}), 200
		except Exception as e:
			try:
				app.logger.error(f"Orders delete error: {e}")
			except Exception:
				pass
			return jsonify({'ok': False, 'error': 'server'}), 500
