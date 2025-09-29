from flask import render_template, url_for, request, send_from_directory, redirect, abort
from flask_login import current_user
from datetime import datetime as dt
from os import path, remove


def register(app, tp, media_service):
	@app.route('/rdrs', methods=['GET'])
	@app.permission_required(2)
	def orders():
		orders = app._sql.order_all()
		return render_template('orders.j2.html', id=2, orders=orders, groups=app._sql.group_all())

	@app.route('/rdrs/add', methods=['POST'])
	@app.permission_required(2, 'b')
	def orders_add():
		try:
			responsible = request.form.get('responsible')
			description = request.form.get('description')
			number = request.form.get('number')
			department = request.form.get('department')
			start_date = request.form.get('start_date')
			end_date = request.form.get('end_date')
			iss_date = request.form.get('iss_date')
			comp_date = request.form.get('comp_date')
			start_date = dt.strptime(start_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if start_date else None
			end_date = dt.strptime(end_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if end_date else None
			comp_date = dt.strptime(comp_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if comp_date else None
			iss_date = dt.strptime(iss_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if iss_date else None
			creator = current_user.name
			state = -1
			if comp_date:
				state = 1
			app._sql.order_add([state, number, iss_date, start_date, end_date, comp_date, responsible, description, department, creator])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))

	@app.route('/rdrs/edit/<int:id>', methods=['POST'])
	@app.permission_required(2, 'a')
	def orders_edit(id):
		ord = app._sql.order_by_id([id])
		if not (current_user.is_allowed(2, 'c') or current_user.name == ord.creator) or ord.state == 1:
			return abort(403)
		try:
			responsible = request.form.get('responsible')
			description = request.form.get('description')
			number = request.form.get('number')
			department = request.form.get('department')
			start_date = request.form.get('start_date')
			end_date = request.form.get('end_date')
			iss_date = request.form.get('iss_date')
			comp_date = request.form.get('comp_date')
			start_date = dt.strptime(start_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if start_date else None
			end_date = dt.strptime(end_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if end_date else None
			comp_date = dt.strptime(comp_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if comp_date else None
			iss_date = dt.strptime(iss_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if iss_date else None
			state = -1
			if comp_date:
				state = 1
			app._sql.order_edit([state, number, iss_date, start_date, end_date, comp_date, responsible, description, department, id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))

	@app.route('/rdrs/delete/<int:id>', methods=['POST'])
	@app.permission_required(2, 'a')
	def orders_delete(id):
		ord = app._sql.order_by_id([id])
		if not (current_user.is_allowed(2, 'd') or current_user.name == ord.creator) or ord.state == 1:
			return abort(403)
		try:
			app._sql.order_delete([id])
			for f in ord.attachments:
				try:
					remove(path.join(app._sql.config['files']['root'], 'ords', f))
				except Exception as e:
					app.flash_error(e)
				finally:
					file = path.join(app._sql.config['files']['root'], 'ords', path.splitext(f)[0] + '.mp4')
					if path.isfile(file):
						remove(file)
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))

	@app.route('/rdrs/appr/<int:id>', methods=['GET'])
	@app.permission_required(2, 'e')
	def orders_approve(id):
		try:
			app._sql.order_approve([1, id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))

	@app.route('/rdrs/dappr/<int:id>', methods=['GET'])
	@app.permission_required(2, 'e')
	def orders_disapprove(id):
		try:
			app._sql.order_approve([0, id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))

	@app.route('/rdrs/status/<int:id>', methods=['POST'])
	@app.permission_required(2, 'a')
	def orders_status(id):
		if not (current_user.is_allowed(2, 'c') or current_user.is_allowed(2, 'f') or current_user.name == ord.creator) or ord.state == 1:
			return abort(403)
		try:
			state = int(request.form.get('status'))
			if state == 1:
				comp_date = request.form.get('comp_date')
				comp_date = dt.strptime(comp_date, '%Y-%m-%dT%H:%M').strftime('%y.%m.%d %H:%M') if comp_date else None
			else:
				comp_date = None
			app._sql.order_status([state, comp_date, id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))

	@app.route('/rdrs/view/<int:id>', methods=['GET'])
	@app.permission_required(2, 'h')
	def orders_view(id):
		try:
			ord = app._sql.order_by_id([id])
			if ord.viewed:
				if current_user.name in ord.viewed:
					viewed = ord.viewed
				else:
					viewed = ord.viewed + "<hr>" + current_user.name
			else:
				viewed = current_user.name
			app._sql.order_view([viewed, id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))

	@app.route('/rdrs/file_add/<int:id>', methods=['POST'])
	@app.permission_required(2, 'b')
	def orders_file_add(id):
		ord = app._sql.order_by_id([id])
		if not (current_user.is_allowed(2, 'c') and current_user.is_allowed(2, 'g') or current_user.name == ord.creator) or ord.state == 1:
			return abort(403)
		try:
			if 'file' not in request.files:
				app.flash_error('Файл не выбран!')
			for file in request.files.getlist('file'):
				name = str(id) + "_" + file.filename
				fname = path.join(app._sql.config['files']['root'], 'ords', name)
				f = path.splitext(fname)
				if path.isfile(fname) or path.isfile(f[0] + '.mp4'):
					raise Exception('Указанный файл уже существует!')
				ord.attachments.append(name)
				file.save(fname)
				if f[1].lower() in ('.mp4', '.avi', '.webm', '.mov'):
					media_service.convert_async(fname, f[0] + '.mp4', ('order', id))
			app._sql.order_edit_attachments(['|'.join(ord.attachments), ord.id])
		except Exception as e:
			app.flash_error(str(e))
		finally:
			return redirect(url_for('orders'))

	@app.route('/rdrs/file_add_remote/<int:id>', methods=['POST'])
	@app.permission_required(2, 'b')
	def orders_file_add_remote(id):
		ord = app._sql.order_by_id([id])
		if not (current_user.is_allowed(2, 'c') and current_user.is_allowed(2, 'g') or current_user.name == ord.creator) or ord.state == 1:
			return abort(403)
		try:
			url = [request.form.get(f's{i}') for i in range(0, 7)]
			name = str(id) + '_' + url[-1]
			fname = path.join(app._sql.config['files']['root'], 'ords', name)
			if path.isfile(fname) or path.isfile(path.splitext(fname)[0] + '.mp4'):
				raise Exception('Указанный файл уже существует!')
			tp.add(_orders_file_add_remote, [url, name, fname, ord, id])
			app.flash_error(f"Загрузка файла {name} начата в фоновом режиме. Время загрузки зависит от размера файла. Подождите и обновите страницу.")
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))

	def _orders_file_add_remote(args):
		url, name, fname, ord, id = args
		import urllib.request as http
		http.urlretrieve('http://' + ''.join(url), fname)
		ord.attachments.append(name)
		app._sql.order_edit_attachments(['|'.join(ord.attachments), ord.id])
		f = path.splitext(fname)
		if f[1].lower() in ('.mp4', '.avi', '.webm', '.mov'):
			media_service.convert_async(fname, f[0] + '.mp4', ('order', id))

	@app.route('/rdrs/file/<string:name>', methods=['GET'])
	@app.permission_required(2, 'a')
	def order_file_show(name):
		try:
			return send_from_directory(path.join(app._sql.config['files']['root'], 'ords'), name)
		except Exception as e:
			app.flash_error(e)
			return redirect(url_for('orders'))

	@app.route('/rdrs/file_delete/<int:id>/<string:name>', methods=['POST'])
	@app.permission_required(2, 'b')
	def order_file_delete(id, name):
		ord = app._sql.order_by_id([id])
		if not (current_user.is_allowed(2, 'c') and current_user.is_allowed(2, 'g') or current_user.name == ord.creator) or ord.state == 1:
			return abort(403)
		try:
			ord.attachments.remove(name)
			app._sql.order_edit_attachments(['|'.join(ord.attachments), ord.id])
			try:
				remove(path.join(app._sql.config['files']['root'], 'ords', name))
			finally:
				file = path.join(app._sql.config['files']['root'], 'ords', path.splitext(name)[0] + '.mp4')
				if path.isfile(file):
					remove(file)
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('orders'))


