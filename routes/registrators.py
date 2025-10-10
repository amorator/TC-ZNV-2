from flask import render_template, request, jsonify, Response
from flask_login import current_user
from modules.permissions import require_permissions, CATEGORIES_VIEW, CATEGORIES_MANAGE
from modules.logging import get_logger
from modules.registrators import Registrator, parse_directory_listing
from datetime import datetime
import time
from functools import wraps

_log = get_logger(__name__)


def register(app, socketio=None):
	def _can_view_registrator(app, rid: int) -> bool:
		try:
			# Admin bypass
			is_auth_attr = getattr(current_user, 'is_authenticated', False)
			is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
			if not is_authenticated:
				return False
			from modules.permissions import ADMIN_ANY
			if hasattr(current_user, 'has') and current_user.has(ADMIN_ANY):
				return True
			import json
			key = f"registrator_permissions:{rid}"
			val = app._sql.setting_get([key])
			data = json.loads(val) if val else {}
			uid = str(getattr(current_user, 'id', 0))
			gid = str(getattr(current_user, 'gid', 0))
			umap = (data.get('user') or {}) if isinstance(data, dict) else {}
			gmap = (data.get('group') or {}) if isinstance(data, dict) else {}
			if uid in umap and int(umap.get(uid) or 0) == 1:
				return True
			if gid in gmap and int(gmap.get(gid) or 0) == 1:
				return True
		except Exception:
			pass
		return False
	# Ensure DB table for registrators exists with sane constraints
	try:
		app._sql.execute_non_query(
			f"""
			CREATE TABLE IF NOT EXISTS {app._sql.config['db']['prefix']}_registrator (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				url_template TEXT NOT NULL,
				local_folder VARCHAR(255) NOT NULL,
				enabled TINYINT(1) NOT NULL DEFAULT 1,
				UNIQUE KEY uniq_reg_name (name),
				UNIQUE KEY uniq_reg_folder (local_folder)
			);
			""",
			[]
		)
	except Exception:
		pass
	# Simple in-memory rate limiter (IP+endpoint, sliding window)
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

	# --- Registrators API ---
	@app.route('/api/registrators', methods=['GET'])
	@require_permissions(CATEGORIES_VIEW)
	def registrators_list():
		try:
			rows = app._sql.execute_query(
				f"SELECT id, name, url_template, local_folder, enabled FROM {app._sql.config['db']['prefix']}_registrator ORDER BY name;",
				[]
			)
			items = [
				{'id': r[0], 'name': r[1], 'url_template': r[2], 'local_folder': r[3], 'enabled': int(r[4])}
				for r in (rows or []) if r
			]
			return jsonify({'status': 'success', 'items': items})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/registrators', methods=['POST'])
	@require_permissions(CATEGORIES_MANAGE)
	def registrators_create():
		try:
			j = request.get_json(silent=True) or {}
			name = (j.get('name') or '').strip()
			url_template = (j.get('url_template') or '').strip()
			local_folder = (j.get('local_folder') or '').strip()
			enabled = 1 if j.get('enabled') in (1, '1', True, 'true', 'on') else 0
			# Server-side validation
			if not name or not url_template or not local_folder:
				return jsonify({'status': 'error', 'message': 'name, url_template, local_folder required'}), 400
			# local_folder constraints: ascii letters, digits, dash, underscore only
			try:
				import re
				if not re.match(r'^[a-zA-Z0-9_-]+$', local_folder):
					return jsonify({'status': 'error', 'message': 'Некорректная папка. Разрешены только a-z, A-Z, 0-9, -, _'}), 400
			except Exception:
				pass
			# Require file placeholder in url_template at minimum
			if '{file}' not in url_template:
				return jsonify({'status': 'error', 'message': 'В прототипе ссылки должен быть плейсхолдер {file}'}), 400
			# Reject duplicates
			try:
				row = app._sql.execute_scalar(
					f"SELECT id FROM {app._sql.config['db']['prefix']}_registrator WHERE name=%s OR local_folder=%s LIMIT 1;",
					[name, local_folder]
				)
				if row:
					return jsonify({'status': 'error', 'message': 'Регистратор с таким именем или папкой уже существует'}), 409
			except Exception:
				pass
			app._sql.execute_non_query(
				f"INSERT INTO {app._sql.config['db']['prefix']}_registrator (name, url_template, local_folder, enabled) VALUES (%s, %s, %s, %s);",
				[name, url_template, local_folder, enabled]
			)
			# Ensure local folder exists under files_root/registrators/<local_folder>
			try:
				import os
				base = None
				cfg = getattr(app, '_sql', None)
				if cfg and getattr(cfg, 'config', None):
					base = cfg.config.get('storage', {}).get('files_root') or cfg.config.get('paths', {}).get('files_root')
				if not base:
					base = os.path.join(app.root_path, 'files')
				os.makedirs(os.path.join(base, 'registrators', local_folder), exist_ok=True)
			except Exception:
				pass
			return jsonify({'status': 'success'})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/registrators/<int:rid>', methods=['PUT'])
	@require_permissions(CATEGORIES_MANAGE)
	def registrators_update(rid):
		try:
			j = request.get_json(silent=True) or {}
			name = (j.get('name') or '').strip()
			url_template = (j.get('url_template') or '').strip()
			incoming_folder = (j.get('local_folder') or '').strip()
			enabled = 1 if j.get('enabled') in (1, '1', True, 'true', 'on') else 0
			# Load existing
			row = app._sql.execute_query(
				f"SELECT id, name, url_template, local_folder, enabled FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s",
				[rid]
			)
			if not row:
				return jsonify({'status': 'error', 'message': 'not found'}), 404
			current_folder = row[0][3]
			# Forbid folder change
			if incoming_folder and incoming_folder != current_folder:
				return jsonify({'status': 'error', 'message': 'Изменение папки запрещено'}), 400
			# Validate
			if not name or not url_template:
				return jsonify({'status': 'error', 'message': 'name and url_template required'}), 400
			if '{file}' not in url_template:
				return jsonify({'status': 'error', 'message': 'В прототипе ссылки должен быть плейсхолдер {file}'}), 400
			# Uniqueness (excluding self)
			dup = app._sql.execute_scalar(
				f"SELECT id FROM {app._sql.config['db']['prefix']}_registrator WHERE (name=%s) AND id<>%s LIMIT 1;",
				[name, rid]
			)
			if dup:
				return jsonify({'status': 'error', 'message': 'Имя уже занято'}), 409
			app._sql.execute_non_query(
				f"UPDATE {app._sql.config['db']['prefix']}_registrator SET name=%s, url_template=%s, enabled=%s WHERE id=%s;",
				[name, url_template, enabled, rid]
			)
			return jsonify({'status': 'success'})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/registrators/<int:rid>', methods=['DELETE'])
	@require_permissions(CATEGORIES_MANAGE)
	def registrators_delete(rid):
		try:
			# Resolve local folder
			row = app._sql.execute_query(
				f"SELECT local_folder FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s",
				[rid]
			)
			if not row:
				return jsonify({'status': 'error', 'message': 'not found'}), 404
			local_folder = row[0][0]
			# Count files under files_root/registrators/<local_folder>
			files_count = 0
			try:
				import os
				base = None
				cfg = getattr(app, '_sql', None)
				if cfg and getattr(cfg, 'config', None):
					base = cfg.config.get('storage', {}).get('files_root') or cfg.config.get('paths', {}).get('files_root')
				if not base:
					base = os.path.join(app.root_path, 'files')
				root = os.path.join(base, 'registrators', local_folder)
				for _root, _dirs, _files in os.walk(root):
					files_count += len(_files)
			except Exception:
				files_count = 0
			if files_count > 0:
				return jsonify({'status': 'error', 'message': 'Нельзя удалить: есть скачанные файлы', 'files_count': files_count}), 409
			app._sql.execute_non_query(
				f"DELETE FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s;",
				[rid]
			)
			return jsonify({'status': 'success'})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/registrators/<int:rid>/stats', methods=['GET'])
	@require_permissions(CATEGORIES_VIEW)
	def registrators_stats(rid):
		try:
			row = app._sql.execute_query(
				f"SELECT local_folder FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s",
				[rid]
			)
			if not row:
				return jsonify({'status': 'error', 'message': 'not found'}), 404
			local_folder = row[0][0]
			files_count = 0
			try:
				import os
				base = None
				cfg = getattr(app, '_sql', None)
				if cfg and getattr(cfg, 'config', None):
					base = cfg.config.get('storage', {}).get('files_root') or cfg.config.get('paths', {}).get('files_root')
				if not base:
					base = os.path.join(app.root_path, 'files')
				root = os.path.join(base, 'registrators', local_folder)
				for _root, _dirs, _files in os.walk(root):
					files_count += len(_files)
			except Exception:
				files_count = 0
			return jsonify({'status': 'success', 'files_count': files_count})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	# --- Registrators permissions via settings storage ---
	@app.route('/registrators/<int:rid>/permissions', methods=['GET'])
	@require_permissions(CATEGORIES_VIEW)
	def registrators_permissions_get(rid):
		try:
			import json
			key = f"registrator_permissions:{rid}"
			val = app._sql.setting_get([key])
			try:
				data = json.loads(val) if val else {}
			except Exception:
				data = {}
			# default zeros shape like subcategories
			def zeros():
				return {
					'user': {k: 0 for k in (
						'view_own','view_group','view_all',
						'edit_own','edit_group','edit_all',
						'delete_own','delete_group','delete_all'
					)},
					'group': {k: 0 for k in (
						'view_own','view_group','view_all',
						'edit_own','edit_group','edit_all',
						'delete_own','delete_group','delete_all'
					)}
				}
			if not isinstance(data, dict) or 'user' not in data or 'group' not in data:
				data = zeros()
			return jsonify({'status': 'success', 'permissions': data})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/registrators/<int:rid>/permissions', methods=['POST'])
	@require_permissions(CATEGORIES_MANAGE)
	def registrators_permissions_set(rid):
		try:
			import json
			data = request.get_json(silent=True) or {}
			perms = data.get('permissions') or {}
			key = f"registrator_permissions:{rid}"
			app._sql.setting_set([key, json.dumps(perms, ensure_ascii=False)])
			try:
				if socketio:
					socketio.emit('registrator_permissions_updated', {'registrator_id': rid}, broadcast=True)
			except Exception:
				pass
			return jsonify({'status': 'success'})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/registrators/<int:rid>/browse', methods=['GET'])
	@require_permissions(CATEGORIES_VIEW)
	def registrators_browse(rid):
		"""Browse remote structure progressively: ?level=date|user|time|type and ?parent=..."""
		try:
			rows = app._sql.execute_query(
				f"SELECT id, name, url_template, local_folder, enabled FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s;",
				[rid]
			)
			if not rows:
				return jsonify({'status': 'error', 'message': 'not found'}), 404
			name, url_template, local_folder, enabled = rows[0][1], rows[0][2], rows[0][3], int(rows[0][4])
			if not enabled:
				return jsonify({'status': 'error', 'message': 'disabled'}), 400
			level = (request.args.get('level') or 'date').strip()
			parent = (request.args.get('parent') or '').strip()
			r = Registrator(name, url_template, local_folder, True, rid)
			parts = {'date': '', 'user': '', 'time': '', 'type': '', 'file': ''}
			try:
				if parent:
					pp = parent.split('/')
					keys = ['date','user','time','type']
					for i in range(min(len(pp), len(keys))):
						parts[keys[i]] = pp[i]
			except Exception:
				pass
			if level == 'date':
				url = r.build_url(date='', user='', time_s='', type_s='', file_s='')
			elif level == 'user':
				url = r.build_url(date=parts['date'])
			elif level == 'time':
				url = r.build_url(date=parts['date'], user=parts['user'])
			elif level == 'type':
				url = r.build_url(date=parts['date'], user=parts['user'], time_s=parts['time'])
			else:
				url = r.build_url(date=parts['date'], user=parts['user'], time_s=parts['time'], type_s=parts['type'])
			entries = parse_directory_listing(url)
			return jsonify({'status': 'success', 'entries': entries, 'url': url})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	# --- Registrators import selected files ---
	@app.route('/registrators/<int:rid>/import', methods=['POST'])
	@require_permissions(CATEGORIES_MANAGE)
	@rate_limit(30, 60)
	def registrators_import(rid):
		"""Download selected remote files, convert, and store locally under registrators/<sub>.

		Payload JSON:
		{
		  "category_id": int,
		  "subcategory_id": int,
		  "base_parts": {"date": "YYYY-MM-DD", "user": "...", "time": "HH-MM-SS", "type": "VIDEO"},
		  "files": ["filename1.MOV", ...]
		}
		Limits number of files by config files.max_files_upload (default 10).
		"""
		try:
			j = request.get_json(silent=True) or {}
			cat_id = int(j.get('category_id') or 0)
			sub_id = int(j.get('subcategory_id') or 0)
			base_parts = j.get('base_parts') or {}
			file_names = list(j.get('files') or [])
			if not cat_id or not sub_id or not file_names:
				return jsonify({'status': 'error', 'message': 'category_id, subcategory_id, files required'}), 400
			# Enforce max files
			try:
				max_files = int(app._sql.config.get('files', {}).get('max_files_upload', 10))
			except Exception:
				max_files = 10
			if len(file_names) > max_files:
				file_names = file_names[:max_files]
			# Load registrator
			row = app._sql.execute_scalar(
				f"SELECT name, url_template, local_folder, enabled FROM {app._sql.config['db']['prefix']}_registrator WHERE id=%s LIMIT 1;",
				[rid]
			)
			if not row:
				return jsonify({'status': 'error', 'message': 'registrator not found'}), 404
			name, url_template, local_folder, enabled = row[0], row[1], row[2], int(row[3] or 0)
			if not enabled:
				return jsonify({'status': 'error', 'message': 'registrator disabled'}), 400
			r = Registrator(name, url_template, local_folder, True, rid)
			# Resolve storage dir
			storage_dir = app._sql._build_storage_dir(cat_id, sub_id)
			import os
			os.makedirs(storage_dir, exist_ok=True)
			import hashlib, urllib.request
			created_ids = []
			for fname in file_names:
				try:
					url = r.build_url(
						date=str(base_parts.get('date') or ''),
						user=str(base_parts.get('user') or ''),
						time_s=str(base_parts.get('time') or ''),
						type_s=str(base_parts.get('type') or ''),
						file_s=str(fname or '')
					)
					# Generate internal name (unique, collision-resistant)
					seed = f"{rid}:{cat_id}:{sub_id}:{fname}:{time.time()}"
					real_base = hashlib.md5(seed.encode('utf-8')).hexdigest()
					is_audio = fname.lower().endswith(('.aac','.m4a','.mp3','.wav','.oga','.ogg','.wma','.opus','.mka'))
					target_ext = '.m4a' if is_audio else '.mp4'
					base_path = os.path.join(storage_dir, real_base)
					# Download remote file to .webm temp (ffmpeg detects container)
					try:
						with urllib.request.urlopen(url, timeout=20) as resp, open(base_path + '.webm', 'wb') as out:
							out.write(resp.read())
					except Exception:
						# skip this file on network error
						continue
					# Probe size and duration for metadata
					size_mb = 0.0
					try:
						size_bytes = os.path.getsize(base_path + '.webm')
						size_mb = round(size_bytes / (1024*1024), 1)
					except Exception:
						pass
					length_seconds = 0
					try:
						import subprocess
						p = subprocess.Popen(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", base_path + '.webm'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
						sout, _ = p.communicate(timeout=10)
						length_seconds = int(float((sout or '0').strip()) or 0)
					except Exception:
						pass
					# Create DB record via new schema with non-editable description marker
					owner = f"{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})"
					desc = f"Регистратор — {name}"
					file_id = app._sql.file_add2([
						fname, real_base + target_ext, cat_id, sub_id, owner, desc, datetime.utcnow().strftime('%Y-%m-%d %H:%M'), 0, 0, size_mb, None
					])
					# Update probed metadata if available
					try:
						if length_seconds or size_mb:
							app._sql.file_update_metadata([length_seconds, size_mb, file_id])
							if socketio:
								try:
									socketio.emit('files:changed', {'reason': 'metadata', 'id': file_id, 'meta': {'length': length_seconds, 'size': size_mb}})
								except Exception:
									pass
					except Exception:
						pass
					created_ids.append(file_id)
					# Schedule conversion
					try:
						app.media_service.convert_async(base_path + '.webm', base_path + target_ext, ('file', file_id))
					except Exception:
						pass
				except Exception:
					continue
			# Soft refresh for clients
			try:
				if socketio:
					socketio.emit('files:changed', {'reason': 'registrators-import', 'ids': created_ids})
			except Exception:
				pass
			return jsonify({'status': 'success', 'created': len(created_ids), 'ids': created_ids})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	# --- Registrators UI page ---
	@app.route('/registrators', methods=['GET'], endpoint='registrators_page')
	@require_permissions(CATEGORIES_VIEW)
	def admin_registrators_page():
		try:
			return render_template('admin/registrators.j2.html', title='Регистраторы — ЗНВ')
		except Exception as e:
			app.flash_error(e)
			return Response(str(e), status=500, mimetype='text/plain; charset=utf-8')


