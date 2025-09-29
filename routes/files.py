from flask import render_template, url_for, request, send_from_directory, redirect, Response, abort
from flask_login import current_user
from datetime import datetime as dt
from os import path, remove
from utils.common import make_dir, hash_str
from services.permissions import dirs_by_permission


def register(app, media_service):
	@app.route('/fls' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
	@app.route('/fls' + '/<int:did>', methods=['GET'])
	@app.route('/fls', methods=['GET'])
	@app.permission_required(3)
	def files(did=0, sdid=1):
		id = 3
		_dirs = dirs_by_permission(app, id, 'f')
		if did >= len(_dirs):
			did = 0
		if sdid >= len(_dirs[did]):
			sdid = 1
		dirs = list(_dirs[did].keys())
		files = app._sql.file_by_path([path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid])]) if sdid < len(dirs) else None
		return render_template('files.j2.html', id=id, dirs=_dirs, files=files, did=did, sdid=sdid)

	@app.route('/fls' + '/add' + '/<int:did>' + '/<int:sdid>', methods=['POST'])
	@app.permission_required(3, 'b')
	def files_add(did=0, sdid=1):
		try:
			dirs = dirs_by_permission(app, 3, 'f')
			if did >= len(dirs):
				did = 0
			if sdid >= len(dirs[did]):
				sdid = 1
			dirs = list(dirs[did].keys())
			dir = path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid])
			name = request.form.get('name')
			real_name = hash_str(dt.now().strftime('%Y-%m-%d_%H:%M:%S.f'))
			fpath = path.join(dir, real_name)
			make_dir(path.join(app._sql.config['files']['root'], 'video'), dirs[0], dirs[sdid])
			desc = request.form.get('description')
			id = app._sql.file_add([name, real_name + '.mp4', dir, f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})', desc, dt.now().strftime('%Y-%m-%d %H:%M'), 0])
			request.files.get('file').save(fpath + '.webm')
			media_service.convert_async(fpath + '.webm', fpath + '.mp4', ('file', id))
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/edit' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@app.permission_required(3, 'b')
	def files_edit(id, did=0, sdid=1):
		file = app._sql.file_by_id([id])
		if not (current_user.is_allowed(3, 'd') or current_user.name + ' (' in file.owner):
			return abort(403)
		try:
			name = request.form.get('name')
			desc = request.form.get('description')
			app._sql.file_edit([name, desc, id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/delete' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@app.permission_required(3, 'b')
	def files_delete(id, did=0, sdid=1):
		file = app._sql.file_by_id([id])
		if not (current_user.is_allowed(3, 'c') or current_user.name + ' (' in file.owner):
			return abort(403)
		try:
			app._sql.file_delete([id])
			remove(path.join(file.path, file.real_name))
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/show' + '/<int:did>' + '/<int:sdid>' + '/<name>', methods=['GET'])
	@app.permission_required(3, 'a')
	def files_show(did, sdid, name):
		try:
			dirs = dirs_by_permission(app, 3, 'f')
			if did >= len(dirs):
				did = 0
			if sdid >= len(dirs[did]):
				sdid = 1
			dirs = list(dirs[did].keys())
			return send_from_directory(path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid]), name)
		except Exception as e:
			app.flash_error(e)
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/view' + '/<int:id>' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
	@app.permission_required(3, 'm')
	def files_view(id, did=0, sdid=1):
		viewed = app._sql.file_by_id([id]).viewed
		try:
			if viewed:
				raise Exception('Данный файл уже отмечен как просмотренный!')
			app._sql.file_view([current_user.name, id])
		except Exception as e:
			app.flash_error(e)
		return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/note' + '/<int:did>' + '/<int:sdid>' + '/<int:id>' , methods=['POST'])
	@app.permission_required(3, 'm')
	def files_note(did=0, sdid=1, id=1):
		note = request.form.get('note')
		try:
			app._sql.file_note([note, id])
		except Exception as e:
			app.flash_error(e)
		return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/rec' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
	@app.permission_required(3, 'b')
	def record(did=0, sdid=1):
		id = 3
		resp = Response(render_template('record.j2.html', id=id, did=did, sdid=sdid))
		resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
		resp.headers["Pragma"] = "no-cache"
		resp.headers["Expires"] = "0"
		resp.headers['Cache-Control'] = 'public, max-age=0'
		return resp

	@app.route('/fls' + '/rec/save' + "/<name>/<desc>/<int:did>/<int:sdid>", methods=['POST'])
	def save(name, desc, did=0, sdid=1):
		try:
			desc = desc[1:]
			dirs = dirs_by_permission(app, 3, 'f')
			if did >= len(dirs):
				did = 0
			if sdid >= len(dirs[did]):
				sdid = 1
			dirs = list(dirs[did].keys())
			dir = path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid])
			make_dir(path.join(app._sql.config['files']['root'], 'video'), dirs[0], dirs[sdid])
			real_name = hash_str(dt.now().strftime('%Y-%m-%d_%H:%M:%S.f'))
			fname = path.join(dir, real_name)
			request.files.get(name + '.webm').save(fname + '.webm')
			id = app._sql.file_add([name, real_name + '.mp4', dir, f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})', desc, dt.now().strftime('%Y-%m-%d %H:%M'), 0])
			media_service.convert_async(fname + '.webm', fname + '.mp4', ('file', id))
			return {200: 'OK'}
		except Exception as e:
			app.flash_error(e)
			return {421: 'Can not process data'}


