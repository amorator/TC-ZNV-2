from flask import render_template, url_for, request, send_from_directory, redirect, abort
from flask_login import current_user
from datetime import datetime as dt
from os import path, remove


def register(app):
	@app.route('/requests', methods=['GET'])
	@app.permission_required(1)
	def requests():
		requests = app._sql.request_all()
		return render_template('requests.j2.html', title='Заявки — Заявки-Наряды-Видео', id=1, requests=requests)

	@app.route('/requests/file/<string:name>', methods=['GET'])
	@app.permission_required(1)
	def request_file_show(name):
		try:
			return send_from_directory(path.join(app._sql.config['files']['root'], 'req'), name)
		except Exception as e:
			app.flash_error(e)
			return redirect(url_for('requests'))

	@app.route('/requests/file_delete/<int:id>/<string:name>', methods=['GET'])
	@app.permission_required(1, 'b')
	def requests_file_delete(id, name):
		req = app._sql.request_by_id([id])
		if not (current_user.is_allowed(1, 'c') or current_user.name + ' (' in req.creator):
			return abort(403)
		try:
			req.files.remove(name)
			app._sql.request_edit_before([req.creator, req.description, '|'.join(req.files), req.id])
			remove(path.join(app._sql.config['files']['root'], 'req', name))
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/file_add/<int:id>', methods=['POST'])
	@app.permission_required(1, 'b')
	def requests_file_add(id):
		req = app._sql.request_by_id([id])
		if not (current_user.is_allowed(1, 'c') or current_user.name + ' (' in req.creator):
			return abort(403)
		try:
			if 'file' not in request.files:
				app.flash_error('Файл не выбран!')
			file = request.files.get('file')
			name = str(id) + "_" + file.filename
			fname = path.join(app._sql.config['files']['root'], 'req', name)
			if path.isfile(name):
				raise Exception('Указанный файл уже существует!')
			req.files.append(name)
			app._sql.request_edit_before([req.creator, req.description, '|'.join(req.files), req.id])
			request.files.get('file').save(fname)
		except Exception as e:
			app.flash_error(str(e))
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/add', methods=['POST'])
	@app.permission_required(1, 'b')
	def requests_add():
		try:
			creator = (request.form.get('creator') or '').strip()
			description = (request.form.get('description') or '').strip()
			app._sql.request_add([dt.now().strftime('%d.%m.%y %H:%M'), creator + '\n' if creator else '', f"{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})", description, ''])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/edit1/<int:id>', methods=['POST'])
	@app.permission_required(1, 'b')
	def requests_edit1(id):
		req = app._sql.request_by_id([id])
		if not ((current_user.is_allowed(1, 'c') or current_user.name + ' (' in req.creator) and req.status_edit() == 1 or current_user.is_allowed(1, 'z')):
			return abort(403)
		try:
			creator = (request.form.get('creator') or '').strip()
			description = (request.form.get('description') or '').strip()
			app._sql.request_edit_before([creator, description, '|'.join(req.files), id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/edit2/<int:id>', methods=['POST'])
	@app.permission_required(1, 'b')
	def requests_edit2(id):
		req = app._sql.request_by_id([id])
		if not ((current_user.is_allowed(1, 'c') or current_user.name + ' (' in req.creator) and req.status_edit() != 1 or current_user.is_allowed(1, 'z')):
			return abort(403)
		try:
			start_date = (request.form.get('start_date') or '').strip()
			end_date = (request.form.get('end_date') or '').strip()
			final_date = (request.form.get('final_date') or '').strip()
			start_date = dt.strptime(start_date, '%Y-%m-%dT%H:%M') if start_date else ''
			end_date = dt.strptime(end_date, '%Y-%m-%dT%H:%M') if end_date else ''
			final_date = dt.strptime(final_date, '%Y-%m-%dT%H:%M') if final_date else ''
			if not start_date:
				raise Exception('Не указано время вывода в ремонт!')
			if final_date and not end_date:
				raise Exception('Не указано время окончания ремонта!')
			if end_date:
				if start_date >= end_date:
					raise Exception('Окончание ремонта не может быть раньше начала!')
				if final_date and end_date > final_date:
					raise Exception('Ввод оборудования в работу не может быть раньше окончания ремонта!')
			app._sql.request_edit_after([start_date, end_date, final_date, id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/delete/<int:id>', methods=['POST'])
	@app.permission_required(1, 'b')
	def requests_delete(id):
		req = app._sql.request_by_id([id])
		if not (current_user.is_allowed(1, 'c') or current_user.name + ' (' in req.creator):
			return abort(403)
		try:
			app._sql.request_delete([id])
			if len(req.files) > 1:
				for file in req.files[1:]:
					remove(path.join(app._sql.config['files']['root'], 'req', file))
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/appr/<int:id>', methods=['GET'])
	@app.permission_required(1, 'e')
	def requests_approve(id):
		try:
			req = app._sql.request_by_id([id])
			if req.approve_now(current_user.name, app._sql.group_name_by_id([current_user.gid])):
				app._sql.request_edit_status([req.status1, id], 1)
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/dappr/<int:id>', methods=['POST'])
	@app.permission_required(1, 'e')
	def requests_disapprove(id):
		try:
			req = app._sql.request_by_id([id])
			reason = (request.form.get('reason') or '').strip()
			reason = 'Причина: ' + (reason if reason else 'не указана.')
			if req.disapprove_now(current_user.name, app._sql.group_name_by_id([current_user.gid]), reason):
				app._sql.request_edit_status([req.status1, id], 1)
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/allow/<int:id>', methods=['GET'])
	@app.permission_required(1, 'f')
	def requests_allow(id):
		try:
			req = app._sql.request_by_id([id])
			if req.allow_now(current_user.name, app._sql.group_name_by_id([current_user.gid])):
				app._sql.request_edit_status([req.status2, id], 2)
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))

	@app.route('/requests/deny/<int:id>', methods=['POST'])
	@app.permission_required(1, 'f')
	def requests_deny(id):
		try:
			req = app._sql.request_by_id([id])
			reason = (request.form.get('reason') or '').strip()
			reason = 'Причина: ' + (reason if reason else 'не указана.')
			if req.deny_now(current_user.name, app._sql.group_name_by_id([current_user.gid]), reason):
				app._sql.request_edit_status([req.status2, id], 2)
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('requests'))


