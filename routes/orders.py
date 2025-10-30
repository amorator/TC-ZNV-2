from flask import render_template, request, jsonify
from flask_login import login_required
from datetime import datetime as dt, timedelta
from modules.permissions import require_permissions, ORDERS_VIEW_PAGE, ORDERS_CREATE, ORDERS_APPROVE
from flask import redirect, url_for


def register(app, socketio=None):
	@app.route('/orders', methods=['GET'])
	@login_required
	@require_permissions(ORDERS_VIEW_PAGE)
	def orders():
		# Load groups for service select
		groups = []
		try:
			prefix = app._sql.config['db']['prefix']
			rows = app._sql.execute_query(f"SELECT id, name FROM {prefix}_group ORDER BY name;") or []
			for r in rows:
				try:
					gid = int(r[0])
					gname = str(r[1])
					groups.append({'id': gid, 'name': gname})
				except Exception:
					pass
		except Exception:
			groups = []
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
					'notes': '',
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
			status = (data.get('status') or 'in_progress').strip().lower() or 'in_progress'
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
			# Normalize empty dates as None; try parse to 'YYYY-MM-DD HH:MM:SS' or keep None
			def norm_dt(x):
				if not x: return None
				try:
					return dt.fromisoformat(str(x).replace('T', ' '))
				except Exception:
					return None
			issued_dt = norm_dt(issued)
			start_dt = norm_dt(start)
			end_dt = norm_dt(end)
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
			return jsonify({ 'ok': True, 'id': int(new_id) }), 200
		except Exception as e:
			try:
				app.logger.error(f"Orders create error: {e}")
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
			app._sql.execute_non_query(
				f"UPDATE {app._sql.config['db']['prefix']}_order SET approved = %s WHERE id = %s;",
				[val, order_id]
			)
			return jsonify({ 'ok': True, 'approved': bool(val) })
		except Exception as e:
			try:
				app.logger.error(f"Orders approve toggle error: {e}")
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
					'notes': '',
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
			try:
				app.logger.error(f"Orders search error: {e}")
			except Exception:
				pass
			return jsonify({ 'items': [], 'total': 0, 'page': 1, 'page_size': page_size }), 200
