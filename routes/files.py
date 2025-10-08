from flask import render_template, url_for, request, send_from_directory, redirect, Response, abort, request, jsonify, make_response
from flask_login import current_user
from datetime import datetime as dt
from os import path, remove
from utils.common import make_dir, hash_str
from utils.dir_utils import validate_directory_params
from services.permissions import dirs_by_permission
from modules.permissions import require_permissions, FILES_VIEW_PAGE, FILES_UPLOAD, FILES_EDIT_ANY, FILES_DELETE_ANY, FILES_MARK_VIEWED, FILES_NOTES
from modules.logging import get_logger, log_access, log_action
import time
from functools import wraps
import os
from typing import Any, Dict, Tuple, Optional, List
from random import randint

_log = get_logger(__name__)


def register(app, media_service, socketio=None) -> None:
	"""Регистрация всех маршрутов `/files`.

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
	# validate_directory_params импортирован из utils.dir_utils

	# Простой rate limiter (IP+эндпоинт, скользящее окно)
	_RATE_BUCKET = {}
	def rate_limit(max_calls: int = 60, window_sec: int = 60):
		def decorator(fn):
			@wraps(fn)
			def wrapper(*args, **kwargs):
				try:
					key = (request.remote_addr or 'unknown', fn.__name__)
					now = time.time()
					bucket = _RATE_BUCKET.get(key, [])
					bucket = [t for t in bucket if now - t < window_sec]
					if len(bucket) >= max_calls:
						return jsonify({'error': 'Слишком много запросов, попробуйте позже'}), 429
					bucket.append(now)
					_RATE_BUCKET[key] = bucket
				except Exception:
					pass
				return fn(*args, **kwargs)
			return wrapper
		return decorator

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
		
		# Check file extension (video + audio)
		video_ext = {'.mp4', '.webm', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.m4v'}
		audio_ext = {'.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga', '.wma', '.mka', '.opus'}
		allowed_extensions = video_ext | audio_ext
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

	def _is_audio_filename(filename: str) -> bool:
		try:
			ext = os.path.splitext((filename or '').lower())[1]
			return ext in {'.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga', '.wma', '.mka', '.opus'}
		except Exception:
			return False

	@app.route('/files' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
	@app.route('/files' + '/<int:did>', methods=['GET'])
	@app.route('/files', methods=['GET'])
	@require_permissions(FILES_VIEW_PAGE)
	def files(did: int = 0, sdid: int = 1):
		"""Render files page for the selected directory.

		Args:
			did: Directory index (root category).
			sdid: Subdirectory index within the selected root.
		"""
		id = 3
		# Read once to avoid UnboundLocalError on early returns
		try:
			max_file_size_mb = int(app._sql.config['files'].get('max_file_size_mb', app._sql.config['files'].get('max_size_mb', 500)))
		except Exception:
			max_file_size_mb = 500
		_dirs = dirs_by_permission(app, id, 'f')
		# Guard: no available directories for this user
		if not _dirs or len(_dirs) == 0:
			from flask import make_response
			resp = make_response(render_template('files.j2.html', title='Файлы — Заявки-Наряды-Файлы', id=id, dirs=_dirs, files=None, did=0, sdid=0, max_file_size_mb=max_file_size_mb))
			resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
			resp.headers['Pragma'] = 'no-cache'
			resp.headers['Expires'] = '0'
			return resp

		did, sdid = validate_directory_params(did, sdid, _dirs)
		dirs = list(_dirs[did].keys()) if (did is not None and did < len(_dirs)) else []
		# Guard: if no subdirectories present, render with empty file list
		if not dirs or len(dirs) <= 1:
			from flask import make_response
			resp = make_response(render_template('files.j2.html', title='Файлы — Заявки-Наряды-Файлы', id=id, dirs=_dirs, files=None, did=did, sdid=0, max_file_size_mb=max_file_size_mb))
			resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
			resp.headers['Pragma'] = 'no-cache'
			resp.headers['Expires'] = '0'
			return resp

		# Safe access to subdir index
		files = None
		if 1 <= sdid < len(dirs):
			files = app._sql.file_by_path([path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid])])
			# Sort files by date descending (newest first)
			if files:
				files.sort(key=lambda f: f.date, reverse=True)
		from flask import make_response
		resp = make_response(render_template('files.j2.html', title='Файлы — Заявки-Наряды-Файлы', id=id, dirs=_dirs, files=files, did=did, sdid=sdid, max_file_size_mb=max_file_size_mb))
		resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
		resp.headers['Pragma'] = 'no-cache'
		resp.headers['Expires'] = '0'
		return resp

	@app.route('/files' + '/add' + '/<int:did>' + '/<int:sdid>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	@rate_limit(40, 60)
	def files_add(did: int = 0, sdid: int = 1):
		"""Single-phase upload: save original, create DB record (ready=0), start conversion."""
		try:
			log_action('FILE_UPLOAD_START', current_user.name, f'start upload to did={did} sdid={sdid}', request.remote_addr)
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
			
			# Save original as temporary .webm path (ffmpeg detects format by content)
			uploaded_file.save(fpath + '.webm')
			# initial metadata: length=0, size in MB from uploaded file size
			try:
				uploaded_file.seek(0, os.SEEK_END)
				size_bytes = uploaded_file.tell()
				uploaded_file.seek(0)
			except Exception:
				size_bytes = 0
			size_mb = round(size_bytes / (1024*1024), 1) if size_bytes else 0
			# Decide target extension by uploaded file type
			is_audio = _is_audio_filename(uploaded_file.filename)
			target_ext = '.m4a' if is_audio else '.mp4'
			id = app._sql.file_add([name, real_name + target_ext, dir, f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})', desc, dt.now().strftime('%Y-%m-%d %H:%M'), 0, 0, size_mb, None])
			# try to detect duration from original .webm and notify clients
			try:
				import subprocess
				p = subprocess.Popen(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", fpath + '.webm'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
				sout, _ = p.communicate(timeout=10)
				length_seconds = int(float((sout or '0').strip()) or 0)
				app._sql.file_update_metadata([length_seconds, size_mb, id])
				if socketio:
					try:
								socketio.emit('files:changed', {'reason': 'metadata', 'id': id, 'meta': {'length': length_seconds, 'size': size_mb}})
					except Exception:
						pass
			except Exception:
				pass
			log_action('FILE_UPLOAD', current_user.name, f'uploaded file {name} to {dirs[0]}/{dirs[sdid]}', request.remote_addr)
			# notify all clients about new pending file
			if socketio:
				try:
						socketio.emit('files:changed', {'reason': 'added', 'id': id})
				except Exception:
					pass
			
			# Start background conversion to the chosen target
			media_service.convert_async(fpath + '.webm', fpath + ('.m4a' if is_audio else '.mp4'), ('file', id))
			log_action('FILE_UPLOAD_END', current_user.name, f'uploaded file {name} as {real_name}.webm (id={id})', request.remote_addr)
		except Exception as e:
			app.flash_error(e)
			log_action('FILE_UPLOAD', current_user.name, f'failed to upload file {name}: {str(e)}', request.remote_addr, success=False)
		finally:
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				return {'status': 'success', 'message': 'File uploaded successfully'}, 200
			return redirect(url_for('files', did=did, sdid=sdid))

	# Phase 1: init record (for large uploads to appear immediately)
	@app.route('/files' + '/add/init' + '/<int:did>' + '/<int:sdid>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	@rate_limit(60, 60)
	def files_add_init(did: int = 0, sdid: int = 1):
		"""Two-phase upload (init): create DB record before uploading large files.

		Returns a JSON object with the created record id and `upload_url` for the
		second phase.
		"""
		try:
			log_action('FILE_UPLOAD_INIT_START', current_user.name, f'start init upload to did={did} sdid={sdid}', request.remote_addr)
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
						socketio.emit('files:changed', {'reason': 'init', 'id': fid})
				except Exception:
					pass
			log_action('FILE_UPLOAD_INIT_END', current_user.name, f'init created id={fid} real={real_name}', request.remote_addr)
			return {'id': fid, 'real_name': real_name, 'upload_url': url_for('files_upload', did=did, sdid=sdid, id=fid)}
		except Exception as e:
			app.flash_error(e)
			return {'error': str(e)}, 400

	# Phase 2: upload binary and start conversion
	@app.route('/files' + '/upload' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	@rate_limit(120, 60)
	def files_upload(id: int, did: int = 0, sdid: int = 1):
		"""Two-phase upload (upload): receive binary, save original, start conversion."""
		try:
			log_action('FILE_UPLOAD_BIN_START', current_user.name, f'start upload binary id={id}', request.remote_addr)
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
			# probe duration from original (works for audio/video)
				import subprocess
				p = subprocess.Popen(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", base + '.webm'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
				sout, _ = p.communicate(timeout=10)
				length_seconds = int(float((sout or '0').strip()) or 0)
				app._sql.file_update_metadata([length_seconds, size_mb, id])
				if socketio:
					try:
								socketio.emit('files:changed', {'reason': 'metadata', 'id': id, 'meta': {'length': length_seconds, 'size': size_mb}})
					except Exception:
						pass
			except Exception:
				pass
			# Choose target by final real_name extension
			target_ext = (path.splitext(file_rec.real_name)[1] or '.mp4').lower()
			media_service.convert_async(base + '.webm', base + ('.m4a' if target_ext == '.m4a' else '.mp4'), ('file', id))
			if socketio:
				try:
						socketio.emit('files:changed', {'reason': 'uploaded', 'id': id})
				except Exception:
					pass
			log_action('FILE_UPLOAD_BIN_END', current_user.name, f'uploaded binary for id={id} size_mb={size_mb}', request.remote_addr)
			return {200: 'OK'}
		except Exception as e:
			app.flash_error(e)
			return {'error': str(e)}, 400

	@app.route('/files' + '/edit' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	@rate_limit(80, 60)
	def files_edit(id: int, did: int = 0, sdid: int = 1):
		"""Edit file metadata (name, description). Only owner or privileged users."""
		file = app._sql.file_by_id([id])
		if not (current_user.has('files.edit_any') or current_user.name + ' (' in file.owner):
			return abort(403)
		try:
			name = (request.form.get('name') or '').strip()
			desc = (request.form.get('description') or '').strip()
			app._sql.file_edit([name, desc, id])
			log_action('FILE_EDIT', current_user.name, f'edited file {file.name} (id={id})', request.remote_addr)
			if socketio:
				try:
						socketio.emit('files:changed', {'reason': 'edited', 'id': id})
				except Exception:
					pass
		except Exception as e:
			app.flash_error(e)
			log_action('FILE_EDIT', current_user.name, f'failed to edit file {file.name}: {str(e)}', request.remote_addr, success=False)
		finally:
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				return {'status': 'success', 'message': 'File updated successfully'}, 200
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/files' + '/delete' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	@rate_limit(40, 60)
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
				os.remove(path.join(file.path, file.real_name))
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
					# server-originated event, no originClientId so all clients refresh
					socketio.emit('files:changed', {'reason': 'deleted', 'id': id})
				except Exception:
					pass
		except Exception as e:
			app.flash_error(e)
			log_action('FILE_DELETE', current_user.name, f'failed to delete file {file.name}: {str(e)}', request.remote_addr, success=False)
		finally:
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				return {'status': 'success', 'message': 'File deleted successfully'}, 200
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/files' + '/show' + '/<int:did>' + '/<int:sdid>' + '/<name>', methods=['GET'])
	@require_permissions(FILES_VIEW_PAGE)
	def files_show(did: int, sdid: int, name: str):
		"""Serve converted media file (.mp4) from the selected directory."""
		try:
			_dirs = dirs_by_permission(app, 3, 'f')
			did, sdid = validate_directory_params(did, sdid, _dirs)
			dirs = list(_dirs[did].keys())
			# Detect explicit download intent via query flag `dl=1`
			is_download = (request.args.get('dl') == '1')
			if is_download:
				log_action('FILE_DOWNLOAD', current_user.name, f'download file {name} from {dirs[0]}/{dirs[sdid]}', request.remote_addr)
			else:
				log_action('FILE_OPEN', current_user.name, f'open file {name} in {dirs[0]}/{dirs[sdid]}', request.remote_addr)
			return send_from_directory(
				path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid]),
				name,
				as_attachment=is_download
			)
		except Exception as e:
			app.flash_error(e)
			return redirect(url_for('files', did=did, sdid=sdid))

	# Serve original uploaded file (.webm) when processing
	@app.route('/files' + '/orig' + '/<int:did>' + '/<int:sdid>' + '/<name>', methods=['GET'])
	@require_permissions(FILES_VIEW_PAGE)
	def files_orig(did: int, sdid: int, name: str):
		"""Serve original uploaded file (.webm) while conversion is in progress."""
		try:
			# name here is real_name.mp4 => map to .webm
			base, _ = os.path.splitext(name)
			_dirs = dirs_by_permission(app, 3, 'f')
			did, sdid = validate_directory_params(did, sdid, _dirs)
			dirs = list(_dirs[did].keys())
			log_action('FILE_DOWNLOAD', current_user.name, f'download original {base}.webm from {dirs[0]}/{dirs[sdid]}', request.remote_addr)
			return send_from_directory(path.join(app._sql.config['files']['root'], 'video', dirs[0], dirs[sdid]), base + '.webm', as_attachment=True)
		except Exception as e:
			app.flash_error(e)
		return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/files' + '/view' + '/<int:id>' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
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
		
		# Update file existence status before processing
		file.update_exists_status()
		if not file.exists:
			app.flash_error('Файл не найден на диске')
			return redirect(url_for('files', did=did, sdid=sdid))
			
		try:
			# Build updated viewers string: append current user if not already present
			current_name = (current_user.name or '').strip()
			existing = (file.viewed or '').strip()
			if existing:
				# Split by comma and normalize whitespace
				parts = [p.strip() for p in existing.split(',') if p is not None]
				if current_name and (current_name not in parts):
					parts.append(current_name)
				new_value = ', '.join([p for p in parts if p])
			else:
				new_value = current_name
			# Persist if we have something to write
			if new_value:
				app._sql.file_view([new_value, id])
			log_action('FILE_MARK_VIEWED', current_user.name, f'marked viewed id={id} (viewers updated)', request.remote_addr)
		except Exception as e:
			app.flash_error(e)
			log_action('FILE_MARK_VIEWED', current_user.name, f'failed to mark viewed id={id}: {str(e)}', request.remote_addr, success=False)
		return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/files' + '/move' + '/<int:did>' + '/<int:sdid>' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	@rate_limit(60, 60)
	def files_move(id: int, did: int = 0, sdid: int = 1):
		"""Move file to another allowed directory and update DB path."""
		# Only owner or users with edit rights can move
		file = app._sql.file_by_id([id])
		if not file:
			app.flash_error('File not found')
			# AJAX-aware error response
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				return {'status': 'error', 'message': 'File not found'}, 404
			return redirect(url_for('files', did=did, sdid=sdid))
		if not (current_user.has('files.edit_any') or current_user.name + ' (' in file.owner):
			return abort(403)
		ok = True
		error_message = ''
		try:
			# Determine target directory within the same root/category
			_dirs = dirs_by_permission(app, 3, 'f')
			did, sdid = validate_directory_params(did, sdid, _dirs)
			dirs = list(_dirs[did].keys())
			selected_root = (request.form.get('target_root') or '').strip()
			selected_sub = (request.form.get('target_sub') or '').strip()
			# Validate selected root exists in allowed dirs (match values as used in template)
			valid_roots = [list(d.values())[0] for d in _dirs]
			if selected_root not in valid_roots:
				raise ValueError('Неверная категория назначения')
			# Find its sub list to validate subcategory
			root_index = valid_roots.index(selected_root)
			valid_subs = list(_dirs[root_index].values())[1:]
			if selected_sub not in valid_subs:
				raise ValueError('Неверная подкатегория назначения')
			new_dir = os.path.join(app._sql.config['files']['root'], 'video', selected_root, selected_sub)
			# Ensure destination directory exists
			make_dir(os.path.join(app._sql.config['files']['root'], 'video'), selected_root, selected_sub)
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
			
			# Refresh file object to update exists status
			file.path = new_dir
			file.update_exists_status()
			
			# Notify clients
			if socketio:
				try:
						socketio.emit('files:changed', {'reason': 'moved', 'id': id, 'file_exists': file.exists})
				except Exception:
					pass
		except Exception as e:
			ok = False
			error_message = str(e)
			app.flash_error(e)
		finally:
			try:
				if ok:
					log_action('FILE_MOVE', current_user.name, f'moved id={id} to {new_dir}', request.remote_addr)
				else:
					log_action('FILE_MOVE', current_user.name, f'failed move id={id}: {error_message}', request.remote_addr, success=False)
			except Exception:
				pass
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				if ok:
					return {'status': 'success', 'message': 'File moved successfully', 'new_path': new_dir}, 200
				else:
					return {'status': 'error', 'message': error_message or 'Failed to move file'}, 400
			return redirect(url_for('files', did=did, sdid=sdid))

	@app.route('/files' + '/note' + '/<int:did>' + '/<int:sdid>' + '/<int:id>' , methods=['POST'])
	@require_permissions(FILES_NOTES)
	@rate_limit(60, 60)
	def files_note(did: int = 0, sdid: int = 1, id: int = 1):
		"""Save or update a note for the file (AJAX-aware)."""
		
		if id <= 0:
			app.flash_error('Invalid file ID')
			return redirect(url_for('files', did=did, sdid=sdid))
			
		note = request.form.get('note', '').strip()
		try:
			app._sql.file_note([note, id])
			log_action('FILE_NOTE', current_user.name, f'updated note for file (id={id})', request.remote_addr)
			# Notify clients about note update
			if socketio:
				try:
					payload = {'reason': 'note', 'id': id}
					socketio.emit('files:changed', payload)
					try:
						socketio.emit('files:changed', payload, namespace='/')
					except Exception:
						pass
				except Exception as e:
					pass
		except Exception as e:
			app.flash_error(e)
			log_action('FILE_NOTE', current_user.name, f'failed to update note for file (id={id}): {str(e)}', request.remote_addr, success=False)
			# AJAX: return error to client
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				return {'status': 'error', 'message': str(e)}, 400
			# Traditional form: redirect back
			return redirect(url_for('files', did=did, sdid=sdid))
		# Success responses
		if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
			return {'status': 'success', 'message': 'Note updated successfully'}, 200
		return redirect(url_for('files', did=did, sdid=sdid))

	# Manual metadata refresh (duration/size) via context menu
	@app.route('/files' + '/refresh' + '/<int:id>', methods=['POST'])
	@require_permissions(FILES_VIEW_PAGE)
	@rate_limit(120, 60)
	def files_refresh(id: int):
		"""Recompute file duration and size using robust ffprobe strategies and update DB; emits soft refresh."""
		try:
			file_rec = app._sql.file_by_id([id])
			if not file_rec:
				return abort(404)
			
			# Update file existence status
			file_rec.update_exists_status()
			
			# Check if file exists on disk
			if not file_rec.exists:
				# Notify clients that file is missing
				if socketio:
					try:
								socketio.emit('files:changed', {'reason': 'metadata', 'id': id, 'file_exists': False})
					except Exception:
						pass
				# Return 200 so UI can update gracefully even when file is missing
				if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
					return {'status': 'success', 'message': 'File not found', 'file_exists': False}, 200
				return {'ok': 1, 'file_exists': False}
			# Allow owner or users with edit_any/mark_viewed to refresh
			owner_name = (file_rec.owner or '')
			is_owner = (current_user.name + ' (') in owner_name
			if not (is_owner or current_user.has('files.edit_any') or current_user.has('files.mark_viewed')):
				return abort(403)

			# Get the appropriate file path for the current state
			target = file_rec.get_file_path()
			
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
			# Update file existence status after successful metadata refresh
			file_rec.update_exists_status()
			
			# Notify clients
			if socketio:
				try:
						socketio.emit('files:changed', {'reason': 'metadata', 'id': id, 'meta': {'length': length_seconds, 'size': size_mb}, 'file_exists': file_rec.exists})
				except Exception:
					pass
			# Return JSON for AJAX requests, simple response for traditional requests
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				return {'status': 'success', 'message': 'File metadata refreshed successfully', 'file_exists': file_rec.exists}, 200
			# Log success after refresh
			try:
				log_action('FILE_REFRESH', current_user.name, f'refreshed metadata for id={id} length={length_seconds}s size_mb={size_mb}', request.remote_addr)
			except Exception:
				pass
			return {'ok': 1}
		except Exception as e:
			app.flash_error(e)
			try:
				log_action('FILE_REFRESH', current_user.name, f'failed to refresh metadata for id={id}: {str(e)}', request.remote_addr, success=False)
			except Exception:
				pass
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				return {'status': 'error', 'message': str(e)}, 500
			return {'error': str(e)}, 400

	@app.route('/files' + '/rec' + '/<int:did>' + '/<int:sdid>', methods=['GET'])
	@require_permissions(FILES_UPLOAD)
	def record(did: int = 0, sdid: int = 1):
		"""Serve the video recorder UI (optionally embedded for modal usage)."""
		# Only allow embedded usage from the files modal
		if request.args.get('embed') != '1':
			return redirect(url_for('files', did=did, sdid=sdid))
		id = 3
		from flask import make_response
		# Log opening of recorder UI
		try:
			log_action('RECORD_UI_OPEN', current_user.name, f'open recorder did={did} sdid={sdid}', request.remote_addr)
		except Exception:
			pass
		html = render_template('components/record.j2.html', id=id, did=did, sdid=sdid)
		resp = make_response(html)
		resp.headers['Content-Type'] = 'text/html; charset=utf-8'
		resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
		resp.headers["Pragma"] = "no-cache"
		resp.headers["Expires"] = "0"
		return resp

	@app.route('/files' + '/rec/save' + "/<name>/<desc>/<int:did>/<int:sdid>", methods=['POST'])
	@require_permissions(FILES_UPLOAD)
	@rate_limit(60, 60)
	def save(name: str, desc: str, did: int = 0, sdid: int = 1):
		"""Save recorded media from the recorder iframe and start conversion."""
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
			# Determine recording type from the provided name (suffix convention from frontend)
			rec_type = 'unknown'
			try:
				if name.endswith('_screen'):
					rec_type = 'screen'
				elif name.endswith('_cam'):
					rec_type = 'camera'
				elif name.endswith('_audio'):
					rec_type = 'audio'
				else:
					rec_type = 'single'
			except Exception:
				pass
			# Log start of recording save
			try:
				log_action('RECORD_SAVE_START', current_user.name, f'type={rec_type} name="{name}" did={did} sdid={sdid}', request.remote_addr)
			except Exception:
				pass
			request.files.get(name + '.webm').save(fname + '.webm')
			# Choose target extension based on recording type
			if rec_type == 'audio':
				real_target = real_name + '.m4a'
				convert_dst = fname + '.m4a'
			else:
				real_target = real_name + '.mp4'
				convert_dst = fname + '.mp4'
			# Args need to match file_add signature: [display_name, real_name, path, owner, description, date, ready, length_seconds, size_mb]
			id = app._sql.file_add([name, real_target, dir, f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})', desc, dt.now().strftime('%Y-%m-%d %H:%M'), 0, 0, 0.0])
			media_service.convert_async(fname + '.webm', convert_dst, ('file', id))
			# Log successful end of recording save
			try:
				log_action('RECORD_SAVE_END', current_user.name, f'type={rec_type} name="{name}" id={id} status=SUCCESS', request.remote_addr)
			except Exception:
				pass
			# Notify clients about new file
			if socketio:
				try:
						socketio.emit('files:changed', {'reason': 'recorded', 'id': id})
						# Also emit with explicit namespace for some clients
						try:
							socketio.emit('files:changed', {'reason': 'recorded', 'id': id}, namespace='/')
						except Exception:
							pass
				except Exception:
					pass
			return {200: 'OK'}
		except Exception as e:
			app.flash_error(e)
			# Log failed save
			try:
				log_action('RECORD_SAVE_END', current_user.name, f'type=unknown name="{name}" status=FAILED error={str(e)}', request.remote_addr, success=False)
			except Exception:
				pass
			return {421: 'Can not process data'}

	@app.route('/files/page/<int:did>/<int:sdid>')
	@require_permissions(FILES_VIEW_PAGE)
	def files_page(did: int = 0, sdid: int = 1):
		"""Return a page of files rows as HTML (tbody content) with pagination meta."""
		try:
			# Redirect direct HTML requests to the full Files page to avoid landing on JSON after login
			accept = (request.headers.get('Accept') or '')
			is_ajax = (request.headers.get('X-Requested-With') == 'XMLHttpRequest')
			if ('text/html' in accept) and (not is_ajax):
				return redirect(url_for('files', did=did, sdid=sdid))
			page = int(request.args.get('page', 1))
			page_size = int(request.args.get('page_size', 15))
			if page < 1: page = 1
			if page_size < 1: page_size = 15
			dirs = dirs_by_permission(app, 3, 'f')
			if not dirs or len(dirs) == 0:
				# Return empty successful response so UI degrades gracefully
				html = render_template('components/files_rows.j2.html', files=[], did=did, sdid=sdid, dirs=[])
				resp = make_response(jsonify({ 'html': html, 'total': 0, 'page': page, 'page_size': page_size }))
				resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
				resp.headers['Pragma'] = 'no-cache'
				resp.headers['Expires'] = '0'
				return resp
			did, sdid = validate_directory_params(did, sdid, dirs)
			dirs_list = list(dirs[did].keys()) if (did is not None and did < len(dirs)) else []
			if not dirs_list or len(dirs_list) <= 1 or not (1 <= sdid < len(dirs_list)):
				# Return empty successful page
				html = render_template('components/files_rows.j2.html', files=[], did=did, sdid=sdid, dirs=dirs)
				resp = make_response(jsonify({ 'html': html, 'total': 0, 'page': page, 'page_size': page_size }))
				resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
				resp.headers['Pragma'] = 'no-cache'
				resp.headers['Expires'] = '0'
				return resp
			fs = app._sql.file_by_path([path.join(app._sql.config['files']['root'], 'video', dirs_list[0], dirs_list[sdid])])
			# Sort files by date descending (newest first)
			if fs:
				fs.sort(key=lambda f: f.date, reverse=True)
			total = len(fs or [])
			start = (page - 1) * page_size
			end = start + page_size
			files_slice = fs[start:end] if fs else []
			html = render_template('components/files_rows.j2.html', files=files_slice, did=did, sdid=sdid, dirs=dirs)
			resp = make_response(jsonify({ 'html': html, 'total': total, 'page': page, 'page_size': page_size }))
			resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
			resp.headers['Pragma'] = 'no-cache'
			resp.headers['Expires'] = '0'
			return resp
		except Exception as e:
			_log.error(f"Files page error: {e}")
			return jsonify({ 'error': str(e) }), 400

	@app.route('/files/search/<int:did>/<int:sdid>')
	@require_permissions(FILES_VIEW_PAGE)
	def files_search(did: int = 0, sdid: int = 1):
		"""Global search across all files in the selected category/subcategory; server-paginated."""
		try:
			# Redirect direct HTML requests to the full Files page to avoid landing on JSON after login
			accept = (request.headers.get('Accept') or '')
			is_ajax = (request.headers.get('X-Requested-With') == 'XMLHttpRequest')
			if ('text/html' in accept) and (not is_ajax):
				return redirect(url_for('files', did=did, sdid=sdid))
			q = (request.args.get('q') or '').strip()
			page = int(request.args.get('page', 1))
			page_size = int(request.args.get('page_size', 30))
			if page < 1: page = 1
			if page_size < 1: page_size = 30
			dirs = dirs_by_permission(app, 3, 'f')
			if not dirs or len(dirs) == 0:
				# Return empty successful response for better UX
				html = render_template('components/files_rows.j2.html', files=[], did=did, sdid=sdid, dirs=[])
				resp = make_response(jsonify({ 'html': html, 'total': 0, 'page': page, 'page_size': page_size }))
				resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
				resp.headers['Pragma'] = 'no-cache'
				resp.headers['Expires'] = '0'
				return resp
			did, sdid = validate_directory_params(did, sdid, dirs)
			dirs_list = list(dirs[did].keys()) if (did is not None and did < len(dirs)) else []
			if not dirs_list or len(dirs_list) <= 1 or not (1 <= sdid < len(dirs_list)):
				# Return empty page for search gracefully
				html = render_template('components/files_rows.j2.html', files=[], did=did, sdid=sdid, dirs=dirs)
				resp = make_response(jsonify({ 'html': html, 'total': 0, 'page': page, 'page_size': page_size }))
				resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
				resp.headers['Pragma'] = 'no-cache'
				resp.headers['Expires'] = '0'
				return resp
			fs = app._sql.file_by_path([path.join(app._sql.config['files']['root'], 'video', dirs_list[0], dirs_list[sdid])]) or []
			if q:
				q_cf = q.casefold()
				def matches(file):
					# name
					name = (getattr(file, 'display_name', '') or getattr(file, 'name', '') or getattr(file, 'real_name', '') or '')
					# description
					desc = getattr(file, 'description', '') or ''
					# creator/owner
					owner = getattr(file, 'owner', '') or ''
					# creation date (string as shown in table)
					date = getattr(file, 'date', '') or ''
					try:
						return (
							q_cf in str(name).casefold() or
							q_cf in str(desc).casefold() or
							q_cf in str(owner).casefold() or
							q_cf in str(date).casefold()
						)
					except Exception:
						return False
				fs = [f for f in fs if matches(f)]
			# Sort files by date descending (newest first)
			if fs:
				fs.sort(key=lambda f: f.date, reverse=True)
			total = len(fs)
			start = (page - 1) * page_size
			end = start + page_size
			files_slice = fs[start:end]
			html = render_template('components/files_rows.j2.html', files=files_slice, did=did, sdid=sdid, dirs=dirs)
			resp = make_response(jsonify({ 'html': html, 'total': total, 'page': page, 'page_size': page_size }))
			resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
			resp.headers['Pragma'] = 'no-cache'
			resp.headers['Expires'] = '0'
			return resp
		except Exception as e:
			_log.error(f"Files search error: {e}")
			return jsonify({ 'error': str(e) }), 400
