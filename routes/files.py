from flask import render_template, url_for, request, send_from_directory, redirect, Response, abort
from flask_login import current_user
from datetime import datetime as dt
from os import path, remove
from utils.common import make_dir, hash_str
from services.permissions import dirs_by_permission
from modules.permissions import require_permissions, FILES_VIEW_PAGE, FILES_UPLOAD, FILES_EDIT_ANY, FILES_DELETE_ANY, FILES_MARK_VIEWED
from modules.logging import get_logger, log_access, log_action
import os
from typing import Any, Dict, Tuple, Optional, List
from random import randint

_log = get_logger(__name__)


def register(app, media_service, socketio=None) -> None:
	"""Register all `/fls` routes on the provided Flask app.

	Args:
		app: The application object providing `route`, `permission_required`, `_sql`, and helpers.
		media_service: Service handling media conversion in background.
		socketio: Optional Socket.IO server for broadcasting table updates.

	This function defines all handlers for the files section:
	- listing and filtering files by directory
	- uploading (single- and two-phase) and conversion
	- edit, delete, view-mark, notes, move
	- serving converted and original files
	- recorder modal endpoints
	"""
	def validate_directory_params(did, sdid, _dirs):
		"""Validate and normalize directory parameters.

		Args:
			did: Requested directory index.
			sdid: Requested subdirectory index.
			_dirs: Nested structure of allowed directories for the current user.

		Returns:
			Tuple[int, int]: Safe `(did, sdid)` indices within bounds.
		"""
		if did < 0 or did >= len(_dirs):
			did = 0
		if sdid < 1 or sdid >= len(_dirs[did]):
			sdid = 1
		return did, sdid

	def validate_uploaded_file(file, app):
		"""Validate uploaded file type and size.

		Ensures the file is provided, extension is from the allowed set, and
		optionally checks size against config `files.max_size_mb`. If the limit is
		0 or absent, only emptiness is checked.

		Args:
			file: Werkzeug file-like object from `request.files`.
			app: The application object with config access.

		Returns:
			bool: True when validation passes.

		Raises:
			ValueError: If file is missing, empty, or has unsupported extension/size.
		"""
		if not file or not file.filename:
			raise ValueError('Файл не выбран')
		
		# Check file extension
		allowed_extensions = {'.mp4', '.webm', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.m4v'}
		file_ext = os.path.splitext(file.filename.lower())[1]
		if file_ext not in allowed_extensions:
			raise ValueError(f'Неподдерживаемый формат файла. Разрешены: {", ".join(allowed_extensions)}')
		
		# Optional size check from config (0 or missing => unlimited)
		try:
			max_size_mb = int(app._sql.config['files'].get('max_size_mb', 0))
		except Exception:
			max_size_mb = 0
		if max_size_mb and max_size_mb > 0:
			file.seek(0, os.SEEK_END)
			file_size = file.tell()
			file.seek(0)  # Reset file pointer
			max_size = max_size_mb * 1024 * 1024
			if file_size > max_size:
				raise ValueError(f'Файл слишком большой. Максимальный размер: {max_size_mb}MB')
			if file_size == 0:
				raise ValueError('Файл пустой')
		else:
			# Still check for empty file
			try:
				pos = file.tell()
				chunk = file.read(1)
				file.seek(pos)
				if not chunk:
					raise ValueError('Файл пустой')
			except Exception:
				pass
		
		return True

	@app.route('/fls' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
	@app.route('/fls' + '/<int:did>', methods=['GET'])
	@app.route('/fls', methods=['GET'])
	@require_permissions(FILES_VIEW_PAGE)
	def files(did: int = 0, sdid: int = 1):
		"""Render files page for the selected directory.

		Args:
			did: Directory index (root category).
			sdid: Subdirectory index within the selected root.
		"""
		id = 3
		_dirs = dirs_by_permission(app, id, 'f')
		did, sdid = validate_directory_params(did, sdid, _dirs)
		dirs = list(_dirs[did].keys())
		files = app._sql.file_by_path([path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid])]) if sdid < len(dirs) else None
		max_file_size_mb = int(app._sql.config['files'].get('max_size_mb', 500))
		return render_template('files.j2.html', id=id, dirs=_dirs, files=files, did=did, sdid=sdid, max_file_size_mb=max_file_size_mb)

	@app.route('/fls' + '/add' + '/<int:did>' + '/<int:sdid>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	def files_add(did: int = 0, sdid: int = 1):
		"""Single-phase upload: save original, create DB record (ready=0), start conversion."""
		try:
			dirs = dirs_by_permission(app, 3, 'f')
			did, sdid = validate_directory_params(did, sdid, dirs)
			dirs = list(dirs[did].keys())
			dir = path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid])
			
			# Validate form data
			name = request.form.get('name', '').strip()
			if not name:
				raise ValueError('Название файла не может быть пустым')
			
			desc = request.form.get('description', '').strip()
			
			# Validate uploaded file
			uploaded_file = request.files.get('file')
			validate_uploaded_file(uploaded_file, app)
			
			real_name = hash_str(dt.now().strftime('%Y-%m-%d_%H:%M:%S.f'))
			fpath = path.join(dir, real_name)
			make_dir(path.join(app._sql.config['files']['root'], 'video'), dirs[0], dirs[sdid])
			
			uploaded_file.save(fpath + '.webm')
			# initial metadata: length=0, size in MB from uploaded file size
			try:
				uploaded_file.seek(0, os.SEEK_END)
				size_bytes = uploaded_file.tell()
				uploaded_file.seek(0)
			except Exception:
				size_bytes = 0
			size_mb = round(size_bytes / (1024*1024), 1) if size_bytes else 0
			id = app._sql.file_add([name, real_name + '.mp4', dir, f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})', desc, dt.now().strftime('%Y-%m-%d %H:%M'), 0, 0, size_mb])
			# try to detect duration from original .webm and notify clients
			try:
				import subprocess
				p = subprocess.Popen(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", fpath + '.webm'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
				sout, _ = p.communicate(timeout=10)
				length_seconds = int(float((sout or '0').strip()) or 0)
				app._sql.file_update_metadata([length_seconds, size_mb, id])
				if socketio:
					try:
						socketio.emit('files:changed', {'reason': 'metadata', 'id': id, 'meta': {'length': length_seconds, 'size': size_mb}}, broadcast=True)
					except Exception:
						pass
			except Exception:
				pass
			log_action('FILE_UPLOAD', current_user.name, f'uploaded file {name} to {dirs[0]}/{dirs[sdid]}', request.remote_addr)
			# notify all clients about new pending file
			if socketio:
				try:
					socketio.emit('files:changed', {'reason': 'added', 'id': id}, broadcast=True)
				except Exception:
					pass
			
			media_service.convert_async(fpath + '.webm', fpath + '.mp4', ('file', id))
		except Exception as e:
			app.flash_error(e)
			log_action('FILE_UPLOAD', current_user.name, f'failed to upload file {name}: {str(e)}', request.remote_addr, success=False)
		finally:
			return redirect(url_for('files', did=did, sdid=sdid))

	# Phase 1: init record (for large uploads to appear immediately)
	@app.route('/fls' + '/add/init' + '/<int:did>' + '/<int:sdid>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	def files_add_init(did: int = 0, sdid: int = 1):
		"""Two-phase upload (init): create DB record before uploading large files.

		Returns a JSON object with the created record id and `upload_url` for the
		second phase.
		"""
		try:
			_dirs = dirs_by_permission(app, 3, 'f')
			did, sdid = validate_directory_params(did, sdid, _dirs)
			dirs = list(_dirs[did].keys())
			dir = path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid])
			make_dir(path.join(app._sql.config['files']['root'], 'video'), dirs[0], dirs[sdid])
			name = (request.form.get('name') or '').strip()
			desc = (request.form.get('description') or '').strip()
			if not name:
				raise ValueError('Название файла не может быть пустым')
			real_name = hash_str(dt.now().strftime('%Y-%m-%d_%H:%M:%S.f'))
			fid = app._sql.file_add([name, real_name + '.mp4', dir, f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})', desc, dt.now().strftime('%Y-%m-%d %H:%M'), 0, 0, 0])
			if socketio:
				try:
					socketio.emit('files:changed', {'reason': 'init', 'id': fid}, broadcast=True)
				except Exception:
					pass
			return {'id': fid, 'real_name': real_name, 'upload_url': url_for('files_upload', did=did, sdid=sdid, id=fid)}
		except Exception as e:
			app.flash_error(e)
			return {'error': str(e)}, 400

	# Phase 2: upload binary and start conversion
	@app.route('/fls' + '/upload' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	def files_upload(id: int, did: int = 0, sdid: int = 1):
		"""Two-phase upload (upload): receive binary, save original, start conversion."""
		try:
			file_rec = app._sql.file_by_id([id])
			if not file_rec:
				return abort(404)
			# Validate uploaded file
			uploaded_file = request.files.get('file')
			validate_uploaded_file(uploaded_file, app)
			# Save to original and begin conversion
			base = path.join(file_rec.path, path.splitext(file_rec.real_name)[0])
			uploaded_file.save(base + '.webm')
			# update size from uploaded file
			try:
				uploaded_file.seek(0, os.SEEK_END)
				size_bytes = uploaded_file.tell()
				uploaded_file.seek(0)
			except Exception:
				size_bytes = 0
			size_mb = round(size_bytes / (1024*1024), 1) if size_bytes else 0
			try:
				# probe duration from original
				import subprocess
				p = subprocess.Popen(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", base + '.webm'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
				sout, _ = p.communicate(timeout=10)
				length_seconds = int(float((sout or '0').strip()) or 0)
				app._sql.file_update_metadata([length_seconds, size_mb, id])
				if socketio:
					try:
						socketio.emit('files:changed', {'reason': 'metadata', 'id': id, 'meta': {'length': length_seconds, 'size': size_mb}}, broadcast=True)
					except Exception:
						pass
			except Exception:
				pass
			media_service.convert_async(base + '.webm', base + '.mp4', ('file', id))
			if socketio:
				try:
					socketio.emit('files:changed', {'reason': 'uploaded', 'id': id}, broadcast=True)
				except Exception:
					pass
			return {200: 'OK'}
		except Exception as e:
			app.flash_error(e)
			return {'error': str(e)}, 400

	@app.route('/fls' + '/edit' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	def files_edit(id: int, did: int = 0, sdid: int = 1):
		"""Edit file metadata (name, description). Only owner or privileged users."""
		file = app._sql.file_by_id([id])
		if not (current_user.has('files.edit_any') or current_user.name + ' (' in file.owner):
			return abort(403)
		try:
			name = request.form.get('name')
			desc = request.form.get('description')
			app._sql.file_edit([name, desc, id])
			log_action('FILE_EDIT', current_user.name, f'edited file {file.name} (id={id})', request.remote_addr)
			if socketio:
				try:
					socketio.emit('files:changed', {'reason': 'edited', 'id': id}, broadcast=True)
				except Exception:
					pass
		except Exception as e:
			app.flash_error(e)
			log_action('FILE_EDIT', current_user.name, f'failed to edit file {file.name}: {str(e)}', request.remote_addr, success=False)
		finally:
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/delete' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	def files_delete(id: int, did: int = 0, sdid: int = 1):
		"""Delete file: remove DB record and any existing media files (.mp4, .webm)."""
		if id <= 0:
			app.flash_error('Invalid file ID')
			return redirect(url_for('files', did=did, sdid=sdid))
			
		file = app._sql.file_by_id([id])
		if not file:
			app.flash_error('File not found')
			return redirect(url_for('files', did=did, sdid=sdid))
			
		if not (current_user.has('files.delete_any') or current_user.name + ' (' in file.owner):
			return abort(403)
		try:
			app._sql.file_delete([id])
			log_action('FILE_DELETE', current_user.name, f'deleted file {file.name} (id={id})', request.remote_addr)
			# Remove converted file if exists
			try:
				remove(path.join(file.path, file.real_name))
			except Exception:
				pass
			# Also remove original uploaded file if exists (e.g., pending .webm)
			try:
				base, _ = os.path.splitext(file.real_name)
				orig = path.join(file.path, base + '.webm')
				if os.path.exists(orig):
					os.remove(orig)
			except Exception:
				pass
			if socketio:
				try:
					socketio.emit('files:changed', {'reason': 'deleted', 'id': id}, broadcast=True)
				except Exception:
					pass
		except Exception as e:
			app.flash_error(e)
			log_action('FILE_DELETE', current_user.name, f'failed to delete file {file.name}: {str(e)}', request.remote_addr, success=False)
		finally:
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/show' + '/<int:did>' + '/<int:sdid>' + '/<name>', methods=['GET'])
	@require_permissions(FILES_VIEW_PAGE)
	def files_show(did: int, sdid: int, name: str):
		"""Serve converted media file (.mp4) from the selected directory."""
		try:
			_dirs = dirs_by_permission(app, 3, 'f')
			did, sdid = validate_directory_params(did, sdid, _dirs)
			dirs = list(_dirs[did].keys())
			return send_from_directory(path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid]), name)
		except Exception as e:
			app.flash_error(e)
			return redirect(url_for('files', did=did, sdid=sdid))

	# Serve original uploaded file (.webm) when processing
	@app.route('/fls' + '/orig' + '/<int:did>' + '/<int:sdid>' + '/<name>', methods=['GET'])
	@require_permissions(FILES_VIEW_PAGE)
	def files_orig(did: int, sdid: int, name: str):
		"""Serve original uploaded file (.webm) while conversion is in progress."""
		try:
			# name here is real_name.mp4 => map to .webm
			base, _ = os.path.splitext(name)
			_dirs = dirs_by_permission(app, 3, 'f')
			did, sdid = validate_directory_params(did, sdid, _dirs)
			dirs = list(_dirs[did].keys())
			return send_from_directory(path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid]), base + '.webm', as_attachment=True)
		except Exception as e:
			app.flash_error(e)
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/view' + '/<int:id>' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
	@require_permissions(FILES_MARK_VIEWED)
	def files_view(id: int, did: int = 0, sdid: int = 1):
		"""Mark a file as viewed by the current user once (permission 'm')."""
		if id <= 0:
			app.flash_error('Invalid file ID')
			return redirect(url_for('files', did=did, sdid=sdid))
			
		file = app._sql.file_by_id([id])
		if not file:
			app.flash_error('File not found')
			return redirect(url_for('files', did=did, sdid=sdid))
			
		try:
			if file.viewed:
				raise Exception('Данный файл уже отмечен как просмотренный!')
			app._sql.file_view([current_user.name, id])
		except Exception as e:
			app.flash_error(e)
		return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/move' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	def files_move(id: int, did: int = 0, sdid: int = 1):
		"""Move file to another allowed directory and update DB path."""
		# Only owner or users with edit rights can move
		file = app._sql.file_by_id([id])
		if not file:
			app.flash_error('File not found')
			return redirect(url_for('files', did=did, sdid=sdid))
		if not (current_user.has('files.edit_any') or current_user.name + ' (' in file.owner):
			return abort(403)
		try:
			# Determine target directory within the same root/category
			_dirs = dirs_by_permission(app, 3, 'f')
			did, sdid = validate_directory_params(did, sdid, _dirs)
			dirs = list(_dirs[did].keys())
			selected_root = request.form.get('target_root')
			selected_sub = request.form.get('target_sub')
			# Validate selected root exists in dirs
			valid_roots = [ (dirs.values() | list)[0] for dirs in _dirs ]
			if selected_root not in valid_roots:
				raise ValueError('Неверная категория назначения')
			# Find its sub list to validate subcategory
			root_index = valid_roots.index(selected_root)
			valid_subs = (list(_dirs[root_index].values())[1:])
			if selected_sub not in valid_subs:
				raise ValueError('Неверная подкатегория назначения')
			new_dir = os.path.join(app._sql.config['files']['root'], 'video', selected_root, selected_sub)
			make_dir(os.path.join(app._sql.config['files']['root'], 'video'), root, selected)
			# Move files on disk: real_name without extension combines with mp4/webm if exist
			old_base = os.path.join(file.path, os.path.splitext(file.real_name)[0])
			new_base = os.path.join(new_dir, os.path.splitext(file.real_name)[0])
			for ext in ('.mp4', '.webm'):
				old_path = old_base + ext
				new_path = new_base + ext
				if os.path.exists(old_path):
					os.replace(old_path, new_path)
			# Update DB path
			app._sql.file_move([new_dir, id])
			# Notify clients
			if socketio:
				try:
					socketio.emit('files:changed', {'reason': 'moved', 'id': id}, broadcast=True)
				except Exception:
					pass
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/fls' + '/note' + '/<int:did>' + '/<int:sdid>' + '/<int:id>' , methods=['POST'])
	@require_permissions(FILES_MARK_VIEWED)
	def files_note(did: int = 0, sdid: int = 1, id: int = 1):
		"""Save or update a note for the file."""
		if id <= 0:
			app.flash_error('Invalid file ID')
			return redirect(url_for('files', did=did, sdid=sdid))
			
		note = request.form.get('note', '').strip()
		try:
			app._sql.file_note([note, id])
		except Exception as e:
			app.flash_error(e)
		return redirect(url_for('files', did=did, sdid=sdid))

	# Manual metadata refresh (duration/size) via context menu
	@app.route('/fls' + '/refresh' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_VIEW_PAGE)
	def files_refresh(id: int):
		"""Recompute file duration and size using robust ffprobe strategies and update DB; emits soft refresh."""
		try:
			file_rec = app._sql.file_by_id([id])
			if not file_rec:
				return abort(404)
			# Determine target media path: prefer converted mp4, fallback to original webm
			base = path.join(file_rec.path, path.splitext(file_rec.real_name)[0])
			target = path.join(file_rec.path, file_rec.real_name)
			if not os.path.exists(target):
				target = base + '.webm'
			# Allow owner or users with edit_any/mark_viewed to refresh
			owner_name = (file_rec.owner or '')
			is_owner = (current_user.name + ' (') in owner_name
			if not (is_owner or current_user.has('files.edit_any') or current_user.has('files.mark_viewed')):
				return abort(403)

			length_seconds = 0
			size_mb = 0.0
			# size
			try:
				size_bytes = os.path.getsize(target)
				size_mb = round(size_bytes / (1024*1024), 1) if size_bytes else 0.0
			except Exception:
				pass
			# 1) format.duration
			try:
				import subprocess, json
				p = subprocess.Popen(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", target], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
				sout, _ = p.communicate(timeout=10)
				length_seconds = int(float((sout or '0').strip()) or 0)
			except Exception:
				pass
			# 2) stream.duration
			if not length_seconds:
				try:
					p = subprocess.Popen(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "default=noprint_wrappers=1:nokey=1", target], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
					sout, _ = p.communicate(timeout=10)
					length_seconds = int(float((sout or '0').strip()) or 0)
				except Exception:
					pass
			# 3) nb_frames / r_frame_rate
			if not length_seconds:
				try:
					p = subprocess.Popen(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames,nb_frames,r_frame_rate", "-of", "json", target], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
					sout, _ = p.communicate(timeout=10)
					data = json.loads(sout or '{}')
					streams = data.get('streams') or []
					frames = 0
					fps = 0.0
					if streams:
						st = streams[0]
						frames_str = st.get('nb_read_frames') or st.get('nb_frames') or '0'
						try:
							frames = int(frames_str)
						except Exception:
							frames = int(float(frames_str) or 0)
						rate_str = st.get('r_frame_rate') or '0/1'
						try:
							num, den = rate_str.split('/')
							den_v = float(den) if float(den) != 0 else 1.0
							fps = float(num) / den_v
						except Exception:
							fps = 0.0
					if frames > 0 and fps > 0:
						length_seconds = int(frames / fps)
				except Exception:
					pass
			try:
				app._sql.file_update_metadata([length_seconds, size_mb, id])
			except Exception:
				pass
			# Notify clients
			if socketio:
				try:
					socketio.emit('files:changed', {'reason': 'metadata', 'id': id, 'meta': {'length': length_seconds, 'size': size_mb}}, broadcast=True)
				except Exception:
					pass
			return {'ok': 1}
		except Exception as e:
			app.flash_error(e)
			return {'error': str(e)}, 400

	@app.route('/fls' + '/rec' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
	@require_permissions(FILES_UPLOAD)
	def record(did: int = 0, sdid: int = 1):
		"""Serve the video recorder UI (optionally embedded for modal usage)."""
		id = 3
		resp = Response(render_template('record.j2.html', id=id, did=did, sdid=sdid))
		resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
		resp.headers["Pragma"] = "no-cache"
		resp.headers["Expires"] = "0"
		resp.headers['Cache-Control'] = 'public, max-age=0'
		return resp

	@app.route('/fls' + '/rec/save' + "/<name>/<desc>/<int:did>/<int:sdid>", methods=['POST'])
	def save(name: str, desc: str, did: int = 0, sdid: int = 1):
		"""Save recorded video from the recorder iframe and start conversion."""
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
			real_name = hash_str(dt.now().strftime('%Y-%m-%d_%H:%M:%S.f') + str(randint(1000, 9999)))
			fname = path.join(dir, real_name)
			request.files.get(name + '.webm').save(fname + '.webm')
			id = app._sql.file_add([name, real_name + '.mp4', dir, f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})', desc, dt.now().strftime('%Y-%m-%d %H:%M'), 0])
			media_service.convert_async(fname + '.webm', fname + '.mp4', ('file', id))
			return {200: 'OK'}
		except Exception as e:
			app.flash_error(e)
			return {421: 'Can not process data'}


