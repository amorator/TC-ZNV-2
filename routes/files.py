from flask import (abort, flash, jsonify, make_response, redirect, request,
                   render_template, Response, send_from_directory, url_for)
from flask_login import current_user
from datetime import datetime as dt
from os import path, remove
from utils.common import make_dir, hash_str
from utils.dir_utils import validate_directory_params
from services.permissions import dirs_by_permission
from modules.SQLUtils import SQLUtils
from modules.permissions import require_permissions, FILES_VIEW_PAGE, FILES_UPLOAD, FILES_EDIT_ANY, FILES_DELETE_ANY, FILES_MARK_VIEWED, FILES_NOTES
from modules.logging import get_logger, log_access, log_action
from flask import request, jsonify
import time
import threading
import requests


def get_file_location_info(file, app):
    """Get category and subcategory names for file logging."""
    try:
        if hasattr(file, 'category_id') and hasattr(file, 'subcategory_id'):
            cat_id = getattr(file, 'category_id', None)
            sub_id = getattr(file, 'subcategory_id', None)
            if cat_id and sub_id:
                cat = app._sql.category_by_id([cat_id])
                sub = app._sql.subcategory_by_id([sub_id])
                cat_name = cat.name if cat else f"cat_id={cat_id}"
                sub_name = sub.name if sub else f"sub_id={sub_id}"
                return f" in {cat_name}/{sub_name}"
        return ""
    except Exception:
        return ""


from modules.sync_manager import emit_files_changed
from flask_socketio import join_room
import time
from functools import wraps
import os
from typing import Any, Dict, Tuple, Optional, List
from random import randint
import subprocess
import json

_log = get_logger(__name__)


def clear_all_uploads_on_startup():
    """Clear all upload jobs from Redis on server startup."""
    try:
        import redis
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)

        # Clear all upload jobs and active uploads set
        keys = redis_client.keys('upload_job:*')
        cleaned_count = 0

        if keys and isinstance(keys, list):
            for key in keys:
                redis_client.delete(key)
                cleaned_count += 1

        # Clear active uploads set
        redis_client.delete('active_uploads')

        # Only log upload cleanup once across all workers
        if redis_client.set('upload_cleanup_logged', '1', nx=True, ex=20):
            _log.info(
                f"Server startup: Cleared {cleaned_count} upload jobs from Redis"
            )

    except Exception as e:
        _log.error(f"Error clearing uploads on startup: {e}")


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
    # Clear all uploads on server startup
    clear_all_uploads_on_startup()

    # validate_directory_params импортирован из utils.dir_utils

    # Socket.IO room join for files page
    try:
        if hasattr(app, 'socketio') and app.socketio:

            @app.socketio.on('files:join')
            def _files_join(_data=None):
                try:
                    join_room('files')
                except Exception:
                    pass
    except Exception:
        pass

    # Get rate limiter from app
    rate_limit = app.rate_limiters.get(
        'files',
        app.rate_limiters.get('default', lambda *args, **kwargs: lambda f: f))

    def get_allowed_extensions_from_config(app):
        """Get allowed file extensions from config.ini."""
        try:
            allowed_types = app._sql.config['files'].get(
                'allowed_types', 'audio/*,video/*')
            # Parse comma-separated MIME types
            mime_types = [t.strip() for t in allowed_types.split(',')]

            # Map MIME types to extensions
            mime_to_ext = {
                'audio/*': {
                    '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga',
                    '.wma', '.mka', '.opus'
                },
                'video/*': {
                    '.mp4', '.webm', '.avi', '.mov', '.mkv', '.wmv', '.flv',
                    '.m4v'
                },
                # Specific MIME types
                'audio/mpeg': {'.mp3'},
                'audio/wav': {'.wav'},
                'audio/flac': {'.flac'},
                'audio/aac': {'.aac'},
                'audio/mp4': {'.m4a'},
                'audio/ogg': {'.ogg', '.oga'},
                'audio/x-ms-wma': {'.wma'},
                'audio/x-matroska': {'.mka'},
                'audio/opus': {'.opus'},
                'video/mp4': {'.mp4'},
                'video/webm': {'.webm'},
                'video/x-msvideo': {'.avi'},
                'video/quicktime': {'.mov'},
                'video/x-matroska': {'.mkv'},
                'video/x-ms-wmv': {'.wmv'},
                'video/x-flv': {'.flv'},
                'video/x-m4v': {'.m4v'},
            }

            allowed_extensions = set()
            for mime_type in mime_types:
                if mime_type in mime_to_ext:
                    allowed_extensions.update(mime_to_ext[mime_type])

            return allowed_extensions if allowed_extensions else {
                '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga',
                '.wma', '.mka', '.opus', '.mp4', '.webm', '.avi', '.mov',
                '.mkv', '.wmv', '.flv', '.m4v'
            }
        except Exception:
            # Fallback to default audio/video extensions
            return {
                '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga',
                '.wma', '.mka', '.opus', '.mp4', '.webm', '.avi', '.mov',
                '.mkv', '.wmv', '.flv', '.m4v'
            }

    def get_accept_attribute_from_config(app):
        """Get accept attribute for file input from config.ini."""
        try:
            allowed_types = app._sql.config['files'].get(
                'allowed_types', 'audio/*,video/*')
            # Parse comma-separated MIME types
            mime_types = [t.strip() for t in allowed_types.split(',')]

            # Convert MIME types to accept attribute format
            accept_parts = []
            for mime_type in mime_types:
                if mime_type.endswith('/*'):
                    accept_parts.append(mime_type)
                else:
                    accept_parts.append(mime_type)

            # Add specific extensions for better browser support
            allowed_extensions = get_allowed_extensions_from_config(app)
            accept_parts.extend(sorted(allowed_extensions))

            return ','.join(accept_parts)
        except Exception:
            # Fallback to default
            return 'audio/*,video/*,.mp3,.wav,.flac,.aac,.m4a,.ogg,.oga,.wma,.mka,.opus,.mp4,.webm,.avi,.mov,.mkv,.wmv,.flv,.m4v'

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

        # Check file extension from config
        allowed_extensions = get_allowed_extensions_from_config(app)
        file_ext = os.path.splitext(file.filename.lower())[1]
        if file_ext not in allowed_extensions:
            raise ValueError(
                f'Неподдерживаемый формат файла. Разрешены: {", ".join(sorted(allowed_extensions))}'
            )

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
                raise ValueError(
                    f'Файл слишком большой. Максимальный размер: {max_size_mb}MB'
                )
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

    def _is_audio_filename(filename: str, app) -> bool:
        try:
            ext = os.path.splitext((filename or '').lower())[1]
            allowed_extensions = get_allowed_extensions_from_config(app)
            audio_extensions = {
                '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga',
                '.wma', '.mka', '.opus'
            }
            return ext in allowed_extensions and ext in audio_extensions
        except Exception:
            return False

    @app.route('/files/<int:did>/<int:sdid>', methods=['GET'])
    @app.route('/files/<int:did>', methods=['GET'])
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
            max_file_size_mb = int(app._sql.config['files'].get(
                'max_file_size_mb',
                app._sql.config['files'].get('max_size_mb', 500)))
            accept_attribute = get_accept_attribute_from_config(app)
        except Exception:
            max_file_size_mb = 500
            accept_attribute = 'audio/*,video/*,.mp3,.wav,.flac,.aac,.m4a,.ogg,.oga,.wma,.mka,.opus,.mp4,.webm,.avi,.mov,.mkv,.wmv,.flv,.m4v'
        _dirs = dirs_by_permission(app, id, 'f')
        # Guard: no available directories for this user
        if not _dirs or len(_dirs) == 0:
            resp = make_response(
                render_template('files.j2.html',
                                title='Файлы — Заявки-Наряды-Файлы',
                                id=id,
                                dirs=_dirs,
                                files=None,
                                did=0,
                                sdid=0,
                                max_file_size_mb=max_file_size_mb,
                                accept_attribute=accept_attribute))
            resp.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp

        did, sdid = validate_directory_params(did, sdid, _dirs)
        dirs = list(_dirs[did].keys()) if (did is not None
                                           and did < len(_dirs)) else []

        # Блокируем доступ к подкатегориям отключённой категории:
        # если категория выключена, но пытаются открыть её подкатегорию (sdid != 0)
        try:
            root_key = list(_dirs[did].keys())[0]
            cat_id = app._sql.category_id_by_folder(root_key)
            cat = app._sql.category_by_id([cat_id])
            if cat and int(getattr(cat, 'enabled',
                                   1)) != 1 and sdid and sdid != 0:
                flash('Доступ к подкатегориям отключённой категории запрещён',
                      'error')
                try:
                    log_action(
                        'FILES_CATEGORY_ACCESS_BLOCKED',
                        current_user.name,
                        f'disabled category id={cat_id}, did={did}, sdid={sdid}',
                        (request.remote_addr or ''),
                        success=False)
                except Exception:
                    pass
                return redirect(url_for('files', did=did, sdid=0))
        except Exception:
            pass

        # Блокируем доступ к выключенной подкатегории (даже если категория включена)
        try:
            if sdid and sdid != 0:
                root_key = list(_dirs[did].keys())[0]
                dirs_list = list(_dirs[did].keys())
                cat_id = app._sql.category_id_by_folder(root_key)
                sub_id = app._sql.subcategory_id_by_folder(
                    cat_id, dirs_list[sdid]) if cat_id else None
                if sub_id:
                    sub = app._sql.subcategory_by_id([sub_id])
                    if sub and int(getattr(sub, 'enabled', 1)) != 1:
                        flash('Подкатегория отключена для доступа', 'error')
                        try:
                            log_action(
                                'FILES_SUBCATEGORY_ACCESS_BLOCKED',
                                current_user.name,
                                f'disabled subcategory id={sub_id}, cat_id={cat_id}, did={did}, sdid={sdid}',
                                (request.remote_addr or ''),
                                success=False)
                        except Exception:
                            pass
                        return redirect(url_for('files', did=did, sdid=0))
        except Exception:
            pass

        # Normalize potential duplicate-protected keys back to real folder names
        def _unsuffix(k: str) -> str:
            try:
                if isinstance(k, str) and k.endswith(')') and '__dup_' in k:
                    # not expected format; fallback
                    return k
                if isinstance(k, str) and '__dup_' in k:
                    return k.split('__dup_')[0]
            except Exception:
                pass
            return k

        dirs = [_unsuffix(k) for k in dirs]
        # Guard: if no subdirectories present, render with empty file list
        if not dirs or len(dirs) <= 1:
            resp = make_response(
                render_template('files.j2.html',
                                title='Файлы — Заявки-Наряды-Файлы',
                                id=id,
                                dirs=_dirs,
                                files=None,
                                did=did,
                                sdid=0,
                                max_file_size_mb=max_file_size_mb,
                                accept_attribute=accept_attribute))
            resp.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp

        # Safe access to subdir index
        files = None
        current_category_id = None
        current_subcategory_id = None
        if 1 <= sdid < len(dirs):
            # Prefer new schema when available
            try:
                cat_id = app._sql.category_id_by_folder(dirs[0]) if hasattr(
                    app._sql, 'category_id_by_folder') else None
                sub_id = app._sql.subcategory_id_by_folder(
                    cat_id, dirs[sdid]) if (cat_id and hasattr(
                        app._sql, 'subcategory_id_by_folder')) else None
                current_category_id = cat_id
                current_subcategory_id = sub_id
                # Block access to disabled subcategory
                try:
                    if sub_id:
                        sub = app._sql.subcategory_by_id([sub_id])
                        if sub and int(getattr(sub, 'enabled', 1)) != 1:
                            flash('Подкатегория отключена для доступа',
                                  'error')
                            try:
                                log_action(
                                    'FILES_SUB_ACCESS_BLOCKED',
                                    current_user.name,
                                    f'disabled subcategory id={sub_id} (did={did}, sdid={sdid})',
                                    (request.remote_addr or ''),
                                    success=False)
                            except Exception:
                                pass
                            return redirect(url_for('files', did=did, sdid=0))
                except Exception:
                    pass
                if cat_id and sub_id and hasattr(
                        app._sql, 'file_by_category_and_subcategory'):
                    files = app._sql.file_by_category_and_subcategory(
                        [cat_id, sub_id])
                else:
                    files = app._sql.file_by_path([
                        path.join(app._sql.config['files']['root'], 'files',
                                  dirs[0], dirs[sdid])
                    ])
            except Exception:
                files = app._sql.file_by_path([
                    path.join(app._sql.config['files']['root'], 'files',
                              dirs[0], dirs[sdid])
                ])
            # Update exists status for all files and sort by date descending (newest first)
            if files:
                for file in files:
                    file.update_exists_status()
                    # Update the database with the new exists status
                    app._sql.file_update_exists_status(file.id, file.exists)
                files.sort(key=lambda f: f.created_at, reverse=True)
        # Determine whether to show "Загрузить с регистратора" controls
        can_reg_import = False
        try:
            rows = app._sql.execute_query(
                f"SELECT id, enabled FROM {app._sql.config['db']['prefix']}_registrator WHERE enabled=1;",
                [])
            can_reg_import = bool(rows and len(rows) > 0)
        except Exception:
            can_reg_import = False
        # Pre-compute category/subcategory ID mappings for move modal
        move_categories = []
        try:
            for i, dir_entry in enumerate(_dirs):
                try:
                    keys = list(dir_entry.keys())
                    vals = list(dir_entry.values())
                    if not keys or not vals:
                        continue
                    root_key = keys[0]
                    root_name = vals[0]
                    cat_id = app._sql.category_id_by_folder(root_key)

                    # Build subcategory mapping
                    subs = {}
                    for j in range(1, len(keys)):
                        try:
                            sub_key = keys[j]
                            sub_name = vals[j]
                            sub_id = app._sql.subcategory_id_by_folder(
                                cat_id, sub_key) if cat_id else None
                            # Only include valid subcategory IDs (not None)
                            if sub_id is not None:
                                subs[sub_id] = sub_name
                        except Exception:
                            continue

                    # Only add categories with valid IDs
                    if cat_id is not None:
                        move_categories.append({
                            'id': cat_id,
                            'name': root_name,
                            'key': root_key,
                            'subs': subs
                        })
                except Exception:
                    continue
        except Exception:
            move_categories = []

        resp = make_response(
            render_template('files.j2.html',
                            title='Файлы — Заявки-Наряды-Файлы',
                            id=id,
                            dirs=_dirs,
                            files=files,
                            did=did,
                            sdid=sdid,
                            max_file_size_mb=max_file_size_mb,
                            accept_attribute=accept_attribute,
                            can_reg_import=can_reg_import,
                            current_category_id=current_category_id or 0,
                            current_subcategory_id=current_subcategory_id or 0,
                            move_categories=move_categories))
        resp.headers[
            'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
        return resp

    @app.route('/files/add', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    @rate_limit
    def files_add():
        """Single-phase upload: save original, create DB record (ready=0), start conversion."""
        # Pre-read fields used in error logging to avoid UnboundLocalError in except
        name = (request.form.get('name') or '').strip()
        try:
            log_action('FILE_UPLOAD_START', current_user.name, f'start upload',
                       (request.remote_addr or ''))
            # Resolve destination by explicit ids only
            cat_id = request.args.get('cat_id', type=int) or request.form.get(
                'cat_id', type=int)
            sub_id = request.args.get('sub_id', type=int) or request.form.get(
                'sub_id', type=int)
            if not (cat_id and sub_id):
                raise ValueError(
                    'Не удалось определить категорию/подкатегорию для загрузки'
                )
            try:
                dir = app._sql.get_file_storage_path(cat_id, sub_id)
            except Exception:
                dir = path.join(app._sql.config['files']['root'], 'files')

            # Validate form data (name was pre-read above for logging safety)
            if not name:
                raise ValueError('Название файла не может быть пустым')

            desc = request.form.get('description', '').strip()
            registrator_name = request.form.get('registrator_name', '').strip()

            # Add registrator info to description if provided
            if registrator_name:
                if desc:
                    desc = f"[Регистратор - {registrator_name}] {desc}"
                else:
                    desc = f"[Регистратор - {registrator_name}]"

            # Validate uploaded file (support alternate field names)
            file_part = request.files.get('file') or request.files.get(name +
                                                                       '.webm')
            validate_uploaded_file(file_part, app)

            real_name = hash_str(dt.now().strftime('%Y-%m-%d_%H:%M:%S.f'))
            # Ensure directory exists and writable
            try:
                os.makedirs(dir, exist_ok=True)
            except Exception:
                pass
            if not os.access(dir, os.W_OK):
                raise PermissionError(f"Нет прав записи в каталог: {dir}")
            fpath = path.join(dir, real_name)
            # Directory ensured above with os.makedirs(dir, exist_ok=True)

            # Save original as temporary .webm path (ffmpeg detects format by content)
            file_part = file_part or request.files.get(
                'file') or request.files.get(name + '.webm')
            if not file_part:
                raise ValueError('Файл не получен')
            file_part.save(fpath + '.webm')
            # initial metadata: length=0, size in MB from uploaded file size
            try:
                file_part.seek(0, os.SEEK_END)
                size_bytes = file_part.tell()
                file_part.seek(0)
            except Exception:
                size_bytes = 0
            size_mb = round(size_bytes / (1024 * 1024), 1) if size_bytes else 0
            # Decide target extension by uploaded file type
            is_audio = _is_audio_filename(file_part.filename or '', app)
            target_ext = '.m4a' if is_audio else '.mp4'
            # Insert using new schema only
            id = app._sql.file_add2([
                name, real_name + target_ext, cat_id, sub_id,
                f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})',
                desc,
                dt.now().strftime('%Y-%m-%d %H:%M'), 0, 0, size_mb, None
            ])
            # try to detect duration from original .webm and notify clients
            try:
                p = subprocess.Popen([
                    "ffprobe", "-v", "error", "-show_entries",
                    "format=duration", "-of",
                    "default=noprint_wrappers=1:nokey=1", fpath + '.webm'
                ],
                                     stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE,
                                     universal_newlines=True)
                sout, _ = p.communicate(timeout=10)
                length_seconds = int(float((sout or '0').strip()) or 0)
                app._sql.file_update_metadata([length_seconds, size_mb, id])
                if socketio:
                    try:
                        origin = (request.headers.get('X-Client-Id')
                                  or '').strip()
                        emit_files_changed(
                            app.socketio,
                            'metadata',
                            id=id,
                            originClientId=origin,
                            meta={
                                'length': length_seconds,
                                'size': size_mb,
                            },
                        )
                    except Exception:
                        pass
            except Exception:
                pass
            log_action(
                'FILE_UPLOAD', current_user.name,
                f'uploaded file {name} to cat_id={cat_id} sub_id={sub_id}',
                (request.remote_addr or ''))
            # notify all clients about new pending file
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'added',
                                       id=id,
                                       originClientId=origin)
                except Exception:
                    pass

            # Start background conversion to the chosen target
            media_service.convert_async(
                fpath + '.webm', fpath + ('.m4a' if is_audio else '.mp4'),
                ('file', id))
            log_action('FILE_UPLOAD_END', current_user.name,
                       f'uploaded file {name} as {real_name}.webm (id={id})',
                       (request.remote_addr or ''))
            # Return JSON for AJAX requests, redirect for traditional forms
            if request.headers.get(
                    'Content-Type'
            ) == 'application/json' or request.headers.get(
                    'X-Requested-With') == 'XMLHttpRequest':
                return {
                    'status': 'success',
                    'message': 'Файл успешно загружен',
                    'id': int(id) if id else None
                }, 200
            return redirect(url_for('files'))
        except Exception as e:
            app.flash_error(e)
            log_action('FILE_UPLOAD',
                       current_user.name,
                       f'failed to upload file {name}: {str(e)}',
                       (request.remote_addr or ''),
                       success=False)
            # Error response for AJAX / forms
            accept_hdr = (request.headers.get('Accept') or '').lower()
            xrw_hdr = request.headers.get('X-Requested-With')
            if 'application/json' in accept_hdr or xrw_hdr == 'XMLHttpRequest':
                return {'status': 'error', 'message': str(e)}, 400
            flash(str(e), 'error')
            return redirect(url_for('files'))

    # Phase 1: init record (for large uploads to appear immediately)
    @app.route('/files/add/init', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    @rate_limit
    def files_add_init():
        """Two-phase upload (init): create DB record before uploading large files.

		Returns a JSON object with the created record id and `upload_url` for the
		second phase.
		"""
        try:
            log_action('FILE_UPLOAD_INIT_START', current_user.name,
                       f'start init upload', (request.remote_addr or ''))
            cat_id = request.args.get('cat_id', type=int)
            sub_id = request.args.get('sub_id', type=int)
            if not (cat_id and sub_id):
                return {
                    'error':
                    'Не удалось определить категорию/подкатегорию для загрузки'
                }, 400
            try:
                dir = app._sql.get_file_storage_path(cat_id, sub_id)
            except Exception:
                dir = path.join(app._sql.config['files']['root'], 'files')
            # ensure leaf exists best-effort
            try:
                os.makedirs(dir, exist_ok=True)
            except Exception:
                pass
            name = (request.form.get('name') or '').strip()
            desc = (request.form.get('description') or '').strip()
            if not name:
                raise ValueError('Название файла не может быть пустым')
            real_name = hash_str(dt.now().strftime('%Y-%m-%d_%H:%M:%S.f'))
            # Insert using new schema only
            try:
                fid = app._sql.file_add2([
                    name, real_name + '.mp4', cat_id, sub_id,
                    f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})',
                    desc,
                    dt.now().strftime('%Y-%m-%d %H:%M'), 0, 0, 0
                ])
                if not fid:
                    raise RuntimeError('ID созданной записи пуст')
            except Exception as e:
                _log.error(f'files_add_init DB insert failed: {e}')
                return {'error': 'Не удалось создать запись файла'}, 400
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'init',
                                       id=fid,
                                       originClientId=origin)
                except Exception:
                    pass
            log_action('FILE_UPLOAD_INIT_END', current_user.name,
                       f'init created id={fid} real={real_name}',
                       (request.remote_addr or ''))
            return {
                'id': fid,
                'real_name': real_name,
                'upload_url': url_for('files_upload', id=fid)
            }
        except Exception as e:
            app.flash_error(e)
            return {'error': str(e)}, 400

    # Phase 2: upload binary and start conversion
    @app.route('/files/upload/<int:id>', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    @rate_limit
    def files_upload(id: int):
        """Two-phase upload (upload): receive binary, save original, start conversion."""
        try:
            log_action('FILE_UPLOAD_BIN_START', current_user.name,
                       f'start upload binary id={id}',
                       (request.remote_addr or ''))
            file_rec = app._sql.file_by_id([id])
            if not file_rec:
                return abort(404)
            # Validate uploaded file (support alternate field names)
            file_part = request.files.get('file') or request.files.get(
                'upload')
            validate_uploaded_file(file_part, app)
            # Save to original and begin conversion
            base = path.join(file_rec.path,
                             path.splitext(file_rec.real_name)[0])
            # Save original
            if not file_part:
                return {'error': 'Файл не получен'}, 400
            file_part.save(base + '.webm')
            # update size from uploaded file
            try:
                file_part.seek(0, os.SEEK_END)
                size_bytes = file_part.tell()
                file_part.seek(0)
            except Exception:
                size_bytes = 0
            size_mb = round(size_bytes / (1024 * 1024), 1) if size_bytes else 0
            try:
                # probe duration from original (works for audio/video)
                p = subprocess.Popen([
                    "ffprobe", "-v", "error", "-show_entries",
                    "format=duration", "-of",
                    "default=noprint_wrappers=1:nokey=1", base + '.webm'
                ],
                                     stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE,
                                     universal_newlines=True)
                sout, _ = p.communicate(timeout=10)
                length_seconds = int(float((sout or '0').strip()) or 0)
                app._sql.file_update_metadata([length_seconds, size_mb, id])
                if socketio:
                    try:
                        emit_files_changed(app.socketio,
                                           'metadata',
                                           id=id,
                                           meta={
                                               'length': length_seconds,
                                               'size': size_mb
                                           })
                    except Exception:
                        pass
            except Exception:
                pass
            # Choose target by final real_name extension
            target_ext = (path.splitext(file_rec.real_name)[1]
                          or '.mp4').lower()
            media_service.convert_async(
                base + '.webm',
                base + ('.m4a' if target_ext == '.m4a' else '.mp4'),
                ('file', id))
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'uploaded',
                                       id=id,
                                       originClientId=origin)
                except Exception:
                    pass
            log_action('FILE_UPLOAD_BIN_END', current_user.name,
                       f'uploaded binary for id={id} size_mb={size_mb}',
                       (request.remote_addr or ''))
            return {'status': 'success', 'id': id}, 200
        except Exception as e:
            app.flash_error(e)
            return {'status': 'error', 'message': str(e)}, 400

    @app.route('/files/edit/<int:id>', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    @rate_limit
    def files_edit(id: int):
        """Edit file metadata (name, description). Only owner or privileged users."""
        file = app._sql.file_by_id([id])
        if not (current_user.has('files.edit_any')
                or current_user.name + ' (' in file.owner):
            return abort(403)
        try:
            name = (request.form.get('name') or '').strip()
            desc = (request.form.get('description') or '').strip()
            _log.info(
                f"[files] edit processing id={id} name='{name}' desc='{desc[:50]}...'"
            )
            # Preserve registrator info in description
            try:
                if file and isinstance(file.description, str):
                    # Check if original description contains registrator info
                    import re
                    registrator_match = re.search(
                        r'\[Регистратор\s*-\s*[^\]]+\]', file.description)
                    if registrator_match:
                        registrator_info = registrator_match.group(0)
                        # If user provided description, prepend registrator info
                        if desc and desc.strip():
                            desc = f"{registrator_info} {desc.strip()}"
                        else:
                            desc = registrator_info
            except Exception:
                pass
            app._sql.file_edit([name, desc, id])
            log_action(
                'FILE_EDIT', current_user.name,
                f'edited file {name} (id={id}){get_file_location_info(file, app)}',
                (request.remote_addr or ''))
            _log.info(f"[files] edit success id={id}")
        except Exception as e:
            _log.error(f"[files] edit error id={id}: {e}")
            app.flash_error(e)
            log_action(
                'FILE_EDIT',
                current_user.name,
                f'failed to edit file {file.name}: {str(e)}{get_file_location_info(file, app)}',
                (request.remote_addr or ''),
                success=False)
        finally:
            # Emit sync event (always, regardless of success/failure)
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    _log.info(
                        f"[files] edit emitting files:changed id={id} origin={origin}"
                    )
                    emit_files_changed(app.socketio,
                                       'edited',
                                       id=id,
                                       originClientId=origin)
                except Exception as e:
                    _log.error(f"[files] edit emit error: {e}")

            # Return JSON for AJAX requests, redirect for traditional forms
            try:
                accept = (request.headers.get('Accept') or '').lower()
                xrw = (request.headers.get('X-Requested-With') or '').lower()
                _log.info(
                    f"[files] edit headers: accept='{accept}' xrw='{xrw}'")
                if 'application/json' in accept or xrw in ('xmlhttprequest',
                                                           'fetch'):
                    _log.info(f"[files] edit returning JSON response")
                    return {
                        'status': 'success',
                        'message': 'File updated successfully'
                    }, 200
                else:
                    _log.info(f"[files] edit returning redirect (not AJAX)")
            except Exception as e:
                _log.error(f"[files] edit header check error: {e}")
            return redirect(url_for('files'))

    @app.route('/files/delete/<int:id>', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    @rate_limit
    def files_delete(id: int):
        """Delete file: remove DB record and any existing media files (.mp4, .webm)."""
        if id <= 0:
            app.flash_error('Invalid file ID')
            return redirect(url_for('files'))

        file = app._sql.file_by_id([id])
        if not file:
            app.flash_error('File not found')
            return redirect(url_for('files'))

        if not (current_user.has('files.delete_any')
                or current_user.name + ' (' in file.owner):
            return abort(403)
        try:
            app._sql.file_delete([id])
            # Distinguish cleanup-initiated deletes for better tracing
            if request.headers.get('X-Upload-Cleanup') == '1':
                log_action(
                    'FILE_DELETE_CLEANUP', current_user.name,
                    f'cleanup deleted file {file.name} (id={id}){get_file_location_info(file, app)}',
                    (request.remote_addr or ''))
            else:
                log_action(
                    'FILE_DELETE', current_user.name,
                    f'deleted file {file.name} (id={id}){get_file_location_info(file, app)}',
                    (request.remote_addr or ''))
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
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'deleted',
                                       id=id,
                                       originClientId=origin)
                except Exception:
                    pass
        except Exception as e:
            app.flash_error(e)
            log_action(
                'FILE_DELETE',
                current_user.name,
                f'failed to delete file {file.name}: {str(e)}{get_file_location_info(file, app)}',
                (request.remote_addr or ''),
                success=False)
        finally:
            # Return JSON for AJAX requests, redirect for traditional forms
            if request.headers.get(
                    'Content-Type'
            ) == 'application/json' or request.headers.get(
                    'X-Requested-With') == 'XMLHttpRequest':
                return {
                    'status': 'success',
                    'message': 'File deleted successfully'
                }, 200
            return redirect(url_for('files'))

    @app.route('/files/show/<int:did>/<int:sdid>/<name>', methods=['GET'])
    @require_permissions(FILES_VIEW_PAGE)
    def files_show(did: int, sdid: int, name: str):
        """Serve converted media file (.mp4) from the selected directory."""
        try:
            _dirs = dirs_by_permission(app, 3, 'f')
            did, sdid = validate_directory_params(did, sdid, _dirs)
            # Block direct access to subcategory media if category is disabled
            try:
                root_key = list(_dirs[did].keys())[0]
                cat_id = app._sql.category_id_by_folder(root_key)
                cat = app._sql.category_by_id([cat_id])
                if cat and int(getattr(cat, 'enabled',
                                       1)) != 1 and sdid and sdid != 0:
                    flash(
                        'Доступ к подкатегориям отключённой категории запрещён',
                        'error')
                    try:
                        log_action(
                            'FILES_ACCESS_BLOCKED',
                            current_user.name,
                            f'disabled category id={cat_id}, sdid={sdid}, file={name}',
                            (request.remote_addr or ''),
                            success=False)
                    except Exception:
                        pass
                    return redirect(url_for('files', did=did, sdid=0))
                # Also block when subcategory itself is disabled
                try:
                    dirs_list = list(_dirs[did].keys())
                    sub_id = app._sql.subcategory_id_by_folder(
                        cat_id, dirs_list[sdid]) if cat_id else None
                    if sub_id:
                        sub = app._sql.subcategory_by_id([sub_id])
                        if sub and int(getattr(sub, 'enabled', 1)) != 1:
                            flash('Подкатегория отключена для доступа',
                                  'error')
                            try:
                                log_action(
                                    'FILES_SUB_ACCESS_BLOCKED',
                                    current_user.name,
                                    f'disabled subcategory id={sub_id}, file={name}',
                                    (request.remote_addr or ''),
                                    success=False)
                            except Exception:
                                pass
                            return redirect(url_for('files', did=did, sdid=0))
                except Exception:
                    pass
            except Exception:
                pass
            dirs = list(_dirs[did].keys())
            # Compute path via DB helpers when possible
            try:
                cat_id = app._sql.category_id_by_folder(dirs[0])
                sub_id = app._sql.subcategory_id_by_folder(
                    cat_id, dirs[sdid]) if cat_id else None
                if cat_id and sub_id:
                    file_dir = app._sql.get_file_storage_path(cat_id, sub_id)
                else:
                    file_dir = path.join(app._sql.config['files']['root'],
                                         'files', dirs[0], dirs[sdid])
            except Exception:
                file_dir = path.join(app._sql.config['files']['root'], 'files',
                                     dirs[0], dirs[sdid])
            # Detect explicit download intent via query flag `dl=1`
            is_download = (request.args.get('dl') == '1')
            if is_download:
                log_action(
                    'FILE_DOWNLOAD', current_user.name,
                    f'download file {name} from {dirs[0]}/{dirs[sdid]}',
                    (request.remote_addr or ''))
            else:
                log_action('FILE_OPEN', current_user.name,
                           f'open file {name} in {dirs[0]}/{dirs[sdid]}',
                           (request.remote_addr or ''))
            return send_from_directory(file_dir,
                                       name,
                                       as_attachment=is_download)
        except Exception as e:
            app.flash_error(e)
            return redirect(url_for('files'))

    @app.route('/files/file/<int:file_id>', methods=['GET'])
    @require_permissions(FILES_VIEW_PAGE)
    def files_show_by_id(file_id: int):
        """Serve converted media file (.mp4) by file ID."""
        try:
            file = app._sql.file_by_id([file_id])
            if not file:
                flash('Файл не найден', 'error')
                return redirect(url_for('files'))

            # Check if user has permission to access this file
            if not (current_user.has('files.edit_any')
                    or current_user.name + ' (' in file.owner):
                # Check category/subcategory permissions
                try:
                    cat = app._sql.category_by_id([file.category_id])
                    sub = app._sql.subcategory_by_id([file.subcategory_id])
                    if not cat or not sub:
                        flash('Файл недоступен', 'error')
                        return redirect(url_for('files'))
                    if int(getattr(cat, 'enabled', 1)) != 1 or int(
                            getattr(sub, 'enabled', 1)) != 1:
                        flash('Файл недоступен', 'error')
                        return redirect(url_for('files'))
                except Exception:
                    flash('Файл недоступен', 'error')
                    return redirect(url_for('files'))

            # Get file storage path
            file_dir = app._sql.get_file_storage_path(file.category_id,
                                                      file.subcategory_id)

            # Detect explicit download intent via query flag `dl=1`
            is_download = (request.args.get('dl') == '1')
            if is_download:
                log_action(
                    'FILE_DOWNLOAD', current_user.name,
                    f'download file {file.file_name} from category {file.category_id}/{file.subcategory_id}',
                    (request.remote_addr or ''))
            else:
                log_action(
                    'FILE_OPEN', current_user.name,
                    f'open file {file.file_name} in category {file.category_id}/{file.subcategory_id}',
                    (request.remote_addr or ''))

            return send_from_directory(file_dir,
                                       file.file_name,
                                       as_attachment=is_download)
        except Exception as e:
            app.flash_error(e)
            return redirect(url_for('files'))

    # Serve original uploaded file (.webm) when processing
    @app.route('/files/orig/<int:did>/<int:sdid>/<name>', methods=['GET'])
    @require_permissions(FILES_VIEW_PAGE)
    def files_orig(did: int, sdid: int, name: str):
        """Serve original uploaded file (.webm) while conversion is in progress."""
        try:
            # name here is real_name.mp4 => map to .webm
            base, _ = os.path.splitext(name)
            _dirs = dirs_by_permission(app, 3, 'f')
            did, sdid = validate_directory_params(did, sdid, _dirs)
            # Block direct access to subcategory media if category is disabled
            try:
                root_key = list(_dirs[did].keys())[0]
                cat_id = app._sql.category_id_by_folder(root_key)
                cat = app._sql.category_by_id([cat_id])
                if cat and int(getattr(cat, 'enabled',
                                       1)) != 1 and sdid and sdid != 0:
                    flash(
                        'Доступ к подкатегориям отключённой категории запрещён',
                        'error')
                    try:
                        log_action(
                            'FILES_ACCESS_BLOCKED',
                            current_user.name,
                            f'disabled category id={cat_id}, sdid={sdid}, file(orig)={name}',
                            (request.remote_addr or ''),
                            success=False)
                    except Exception:
                        pass
                    return redirect(url_for('files', did=did, sdid=0))
                # Also block when subcategory itself is disabled
                try:
                    dirs_list = list(_dirs[did].keys())
                    sub_id = app._sql.subcategory_id_by_folder(
                        cat_id, dirs_list[sdid]) if cat_id else None
                    if sub_id:
                        sub = app._sql.subcategory_by_id([sub_id])
                        if sub and int(getattr(sub, 'enabled', 1)) != 1:
                            flash('Подкатегория отключена для доступа',
                                  'error')
                            try:
                                log_action(
                                    'FILES_SUB_ACCESS_BLOCKED',
                                    current_user.name,
                                    f'disabled subcategory id={sub_id}, file(orig)={name}',
                                    (request.remote_addr or ''),
                                    success=False)
                            except Exception:
                                pass
                            return redirect(url_for('files', did=did, sdid=0))
                except Exception:
                    pass
            except Exception:
                pass
            dirs = list(_dirs[did].keys())
            # Compute path via DB helpers when possible
            try:
                cat_id = app._sql.category_id_by_folder(dirs[0])
                sub_id = app._sql.subcategory_id_by_folder(
                    cat_id, dirs[sdid]) if cat_id else None
                if cat_id and sub_id:
                    file_dir = app._sql.get_file_storage_path(cat_id, sub_id)
                else:
                    file_dir = path.join(app._sql.config['files']['root'],
                                         'files', dirs[0], dirs[sdid])
            except Exception:
                file_dir = path.join(app._sql.config['files']['root'], 'files',
                                     dirs[0], dirs[sdid])
            log_action(
                'FILE_DOWNLOAD', current_user.name,
                f'download original {base}.webm from {dirs[0]}/{dirs[sdid]}',
                (request.remote_addr or ''))
            return send_from_directory(file_dir,
                                       base + '.webm',
                                       as_attachment=True)
        except Exception as e:
            app.flash_error(e)
        return redirect(url_for('files'))

    @app.route('/files/orig/file/<int:file_id>', methods=['GET'])
    @require_permissions(FILES_VIEW_PAGE)
    def files_orig_by_id(file_id: int):
        """Serve original uploaded file (.webm) by file ID."""
        try:
            file = app._sql.file_by_id([file_id])
            if not file:
                flash('Файл не найден', 'error')
                return redirect(url_for('files'))

            # Check if user has permission to access this file
            if not (current_user.has('files.edit_any')
                    or current_user.name + ' (' in file.owner):
                # Check category/subcategory permissions
                try:
                    cat = app._sql.category_by_id([file.category_id])
                    sub = app._sql.subcategory_by_id([file.subcategory_id])
                    if not cat or not sub:
                        flash('Файл недоступен', 'error')
                        return redirect(url_for('files'))
                    if int(getattr(cat, 'enabled', 1)) != 1 or int(
                            getattr(sub, 'enabled', 1)) != 1:
                        flash('Файл недоступен', 'error')
                        return redirect(url_for('files'))
                except Exception:
                    flash('Файл недоступен', 'error')
                    return redirect(url_for('files'))

            # Get file storage path
            file_dir = app._sql.get_file_storage_path(file.category_id,
                                                      file.subcategory_id)

            # Convert .mp4 filename to .webm for original file
            base, _ = os.path.splitext(file.file_name)

            log_action(
                'FILE_DOWNLOAD', current_user.name,
                f'download original {base}.webm from category {file.category_id}/{file.subcategory_id}',
                (request.remote_addr or ''))

            return send_from_directory(file_dir,
                                       base + '.webm',
                                       as_attachment=True)
        except Exception as e:
            app.flash_error(e)
            return redirect(url_for('files'))

    @app.route('/files/view/<int:id>', methods=['GET'])
    @require_permissions(FILES_MARK_VIEWED)
    def files_view(id: int):
        """Mark a file as viewed by the current user once (permission 'm')."""
        if id <= 0:
            app.flash_error('Invalid file ID')
            return redirect(url_for('files'))

        file = app._sql.file_by_id([id])
        if not file:
            app.flash_error('File not found')
            return redirect(url_for('files'))

        # Update file existence status before processing
        file.update_exists_status()
        if not file.exists:
            app.flash_error('Файл не найден на диске')
            return redirect(url_for('files'))

        try:
            # Build updated viewers string: append current user if not already present
            current_name = (current_user.name or '').strip()
            existing = (file.viewed or '').strip()
            if existing:
                # Split by comma and normalize whitespace
                parts = [
                    p.strip() for p in existing.split(',') if p is not None
                ]
                if current_name and (current_name not in parts):
                    parts.append(current_name)
                new_value = ', '.join([p for p in parts if p])
            else:
                new_value = current_name
            # Persist if we have something to write
            if new_value:
                app._sql.file_view([new_value, id])
            log_action(
                'FILE_MARK_VIEWED', current_user.name,
                f'marked viewed id={id} (viewers updated){get_file_location_info(file, app)}',
                (request.remote_addr or ''))
            # Broadcast change so other tabs refresh
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(socketio,
                                       'edited',
                                       id=id,
                                       originClientId=origin)
                except Exception:
                    pass
        except Exception as e:
            app.flash_error(e)
            log_action(
                'FILE_MARK_VIEWED',
                current_user.name,
                f'failed to mark viewed id={id}: {str(e)}{get_file_location_info(file, app)}',
                (request.remote_addr or ''),
                success=False)
        # Return JSON for AJAX/fetch callers; otherwise redirect
        try:
            accept = (request.headers.get('Accept') or '').lower()
            xrw = (request.headers.get('X-Requested-With') or '').lower()
            if 'application/json' in accept or xrw in ('xmlhttprequest',
                                                       'fetch'):
                return {
                    'status': 'success',
                    'message': 'marked viewed',
                    'id': id
                }
        except Exception:
            pass
        return redirect(url_for('files'))

    @app.route('/files/move/<int:id>', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    @rate_limit
    def files_move(id: int):
        """Move file to another allowed directory and update DB path."""
        # Only owner or users with edit rights can move
        file = app._sql.file_by_id([id])
        if not file:
            app.flash_error('File not found')
            # AJAX-aware error response
            if request.headers.get(
                    'Content-Type'
            ) == 'application/json' or request.headers.get(
                    'X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'error', 'message': 'File not found'}, 404
            return redirect(url_for('files'))
        if not (current_user.has('files.edit_any')
                or current_user.name + ' (' in file.owner):
            return abort(403)
        ok = True
        error_message = ''
        try:
            # Determine target directory within the same root/category
            _dirs = dirs_by_permission(app, 3, 'f')
            dirs = list(_dirs[0].keys()) if _dirs else []
            # Prefer new id-based fields
            target_cat_id = 0
            target_sub_id = 0
            try:
                target_cat_id = int(
                    request.form.get('target_category_id') or 0)
                target_sub_id = int(
                    request.form.get('target_subcategory_id') or 0)
            except Exception:
                pass
            if not (target_cat_id and target_sub_id):
                # Fallback to legacy folder fields
                selected_root = (request.form.get('target_root') or '').strip()
                selected_sub = (request.form.get('target_sub') or '').strip()
                # Validate legacy names against allowed
                valid_roots = [list(d.values())[0] for d in _dirs]
                if selected_root not in valid_roots:
                    raise ValueError('Неверная категория назначения')
                root_index = valid_roots.index(selected_root)
                valid_subs = list(_dirs[root_index].values())[1:]
                if selected_sub not in valid_subs:
                    raise ValueError('Неверная подкатегория назначения')
                # Resolve ids
                target_cat_id = app._sql.category_id_by_folder(selected_root)
                target_sub_id = app._sql.subcategory_id_by_folder(
                    target_cat_id, selected_sub) if target_cat_id else None

            if not (target_cat_id and target_sub_id):
                raise ValueError(
                    'Не выбрана категория/подкатегория назначения')

            # Compute destination dir via DB helpers when possible
            try:
                new_dir = app._sql.get_file_storage_path(
                    target_cat_id, target_sub_id)
            except Exception:
                # Fallback to legacy path compose (requires legacy fields)
                new_dir = os.path.join(app._sql.config['files']['root'],
                                       'files', selected_root, selected_sub)
            # Ensure destination directory exists
            try:
                # Best effort: ensure leaf exists
                os.makedirs(new_dir, exist_ok=True)
            except Exception:
                pass
            # Move files on disk: file_name without extension combines with mp4/webm if exist
            # Get current file path from category/subcategory
            current_dir = app._sql.get_file_storage_path(
                file.category_id, file.subcategory_id)
            old_base = os.path.join(current_dir,
                                    os.path.splitext(file.file_name)[0])
            new_base = os.path.join(new_dir,
                                    os.path.splitext(file.file_name)[0])

            for ext in ('.mp4', '.webm'):
                old_path = old_base + ext
                new_path = new_base + ext
                if os.path.exists(old_path):
                    os.replace(old_path, new_path)
            # Update DB category/subcategory
            if target_cat_id and target_sub_id:
                app._sql.file_move_to_subcategory(
                    [target_cat_id, target_sub_id, id])

            # Refresh file object to update exists status
            # Update file object with new path and check if files exist
            file.category_id = target_cat_id
            file.subcategory_id = target_sub_id
            file.update_exists_status()

            # Update the database with the new exists status
            app._sql.file_update_exists_status(file.id, file.exists)

            # Notify clients
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'moved',
                                       id=id,
                                       file_exists=file.exists,
                                       originClientId=origin)
                except Exception:
                    pass
        except Exception as e:
            ok = False
            error_message = str(e)
            app.flash_error(e)
        finally:
            try:
                if ok:
                    log_action(
                        'FILE_MOVE', current_user.name,
                        f'moved id={id} to {new_dir}{get_file_location_info(file, app)}',
                        (request.remote_addr or ''))
                else:
                    log_action(
                        'FILE_MOVE',
                        current_user.name,
                        f'failed move id={id}: {error_message}{get_file_location_info(file, app)}',
                        (request.remote_addr or ''),
                        success=False)
            except Exception:
                pass
            # Return JSON for AJAX requests, redirect for traditional forms
            if request.headers.get(
                    'Content-Type'
            ) == 'application/json' or request.headers.get(
                    'X-Requested-With') == 'XMLHttpRequest':
                if ok:
                    return {
                        'status': 'success',
                        'message': 'File moved successfully',
                        'new_path': new_dir
                    }, 200
                else:
                    return {
                        'status': 'error',
                        'message': error_message or 'Failed to move file'
                    }, 400
            return redirect(url_for('files'))

    @app.route('/files/note/<int:id>', methods=['POST'])
    @require_permissions(FILES_NOTES)
    @rate_limit
    def files_note(id: int = 1):
        """Save or update a note for the file (AJAX-aware)."""

        if id <= 0:
            app.flash_error('Invalid file ID')
            return redirect(url_for('files'))

        note = request.form.get('note', '').strip()
        file = app._sql.file_by_id([id])
        try:
            app._sql.file_note([note, id])
            log_action(
                'FILE_NOTE', current_user.name,
                f'updated note for file (id={id}){get_file_location_info(file, app)}',
                (request.remote_addr or ''))
            # Notify clients about note update via SyncManager
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'note',
                                       id=id,
                                       originClientId=origin)
                except Exception:
                    pass
        except Exception as e:
            app.flash_error(e)
            log_action(
                'FILE_NOTE',
                current_user.name,
                f'failed to update note for file (id={id}): {str(e)}{get_file_location_info(file, app)}',
                (request.remote_addr or ''),
                success=False)
            # AJAX: return error to client
            if request.headers.get(
                    'Content-Type'
            ) == 'application/json' or request.headers.get(
                    'X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'error', 'message': str(e)}, 400
            # Traditional form: redirect back
            return redirect(url_for('files'))
        # Success responses
        if request.headers.get(
                'Content-Type') == 'application/json' or request.headers.get(
                    'X-Requested-With') == 'XMLHttpRequest':
            return {
                'status': 'success',
                'message': 'Note updated successfully'
            }, 200
        return redirect(url_for('files'))

    # Manual metadata refresh (duration/size) via context menu
    @app.route('/files/refresh/<int:id>', methods=['POST'])
    @require_permissions(FILES_VIEW_PAGE)
    @rate_limit
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
                        emit_files_changed(app.socketio,
                                           'metadata',
                                           id=id,
                                           file_exists=False)
                    except Exception:
                        pass
                # Return 200 so UI can update gracefully even when file is missing
                if request.headers.get(
                        'Content-Type'
                ) == 'application/json' or request.headers.get(
                        'X-Requested-With') == 'XMLHttpRequest':
                    return {
                        'status': 'success',
                        'message': 'File not found',
                        'file_exists': False
                    }, 200
                return {'ok': 1, 'file_exists': False}
            # Allow owner or users with edit_any/mark_viewed to refresh
            owner_name = (file_rec.owner or '')
            is_owner = (current_user.name + ' (') in owner_name
            if not (is_owner or current_user.has('files.edit_any')
                    or current_user.has('files.mark_viewed')):
                return abort(403)

            # Get the appropriate file path for the current state
            target = file_rec.get_file_path()

            length_seconds = 0
            size_mb = 0.0
            # size
            try:
                size_bytes = os.path.getsize(target)
                size_mb = round(size_bytes /
                                (1024 * 1024), 1) if size_bytes else 0.0
            except Exception:
                pass
            # 1) format.duration
            try:
                p = subprocess.Popen([
                    "ffprobe", "-v", "error", "-show_entries",
                    "format=duration", "-of",
                    "default=noprint_wrappers=1:nokey=1", target
                ],
                                     stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE,
                                     universal_newlines=True)
                sout, _ = p.communicate(timeout=10)
                length_seconds = int(float((sout or '0').strip()) or 0)
            except Exception:
                pass
            # 2) stream.duration
            if not length_seconds:
                try:
                    p = subprocess.Popen([
                        "ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=duration", "-of",
                        "default=noprint_wrappers=1:nokey=1", target
                    ],
                                         stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE,
                                         universal_newlines=True)
                    sout, _ = p.communicate(timeout=10)
                    length_seconds = int(float((sout or '0').strip()) or 0)
                except Exception:
                    pass
            # 3) nb_frames / r_frame_rate
            if not length_seconds:
                try:
                    p = subprocess.Popen([
                        "ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-count_frames", "-show_entries",
                        "stream=nb_read_frames,nb_frames,r_frame_rate", "-of",
                        "json", target
                    ],
                                         stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE,
                                         universal_newlines=True)
                    sout, _ = p.communicate(timeout=10)
                    data = json.loads(sout or '{}')
                    streams = data.get('streams') or []
                    frames = 0
                    fps = 0.0
                    if streams:
                        st = streams[0]
                        frames_str = st.get('nb_read_frames') or st.get(
                            'nb_frames') or '0'
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
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'metadata',
                                       id=id,
                                       originClientId=origin,
                                       meta={
                                           'length': length_seconds,
                                           'size': size_mb
                                       },
                                       file_exists=file_rec.exists)
                except Exception:
                    pass
            # Return JSON for AJAX requests, simple response for traditional requests
            if request.headers.get(
                    'Content-Type'
            ) == 'application/json' or request.headers.get(
                    'X-Requested-With') == 'XMLHttpRequest':
                return {
                    'status': 'success',
                    'message': 'File metadata refreshed successfully',
                    'file_exists': file_rec.exists
                }, 200
            # Log success after refresh
            try:
                log_action(
                    'FILE_REFRESH', current_user.name,
                    f'refreshed metadata for id={id} length={length_seconds}s size_mb={size_mb}',
                    (request.remote_addr or ''))
            except Exception:
                pass
            return {'ok': 1}
        except Exception as e:
            app.flash_error(e)
            try:
                log_action('FILE_REFRESH',
                           current_user.name,
                           f'failed to refresh metadata for id={id}: {str(e)}',
                           (request.remote_addr or ''),
                           success=False)
            except Exception:
                pass
            if request.headers.get(
                    'Content-Type'
            ) == 'application/json' or request.headers.get(
                    'X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'error', 'message': str(e)}, 500
            return {'error': str(e)}, 400

    # Simplified recorder UI route: rely on cat_id/sub_id via query
    @app.route('/files/rec', methods=['GET'])
    @require_permissions(FILES_UPLOAD)
    def record(did: int = 0, sdid: int = 1):
        """Serve the video recorder UI (optionally embedded for modal usage)."""
        # Only allow embedded usage from the files modal
        if request.args.get('embed') != '1':
            return redirect(url_for('files', did=did, sdid=sdid))
        id = 3
        # Log opening of recorder UI (no did/sdid in URL anymore)
        try:
            cat_q = request.args.get('cat_id')
            sub_q = request.args.get('sub_id')
            log_action('RECORD_UI_OPEN', current_user.name,
                       f'open recorder cat_id={cat_q} sub_id={sub_q}',
                       (request.remote_addr or ''))
        except Exception:
            pass
        # Keep did/sdid context values for template compatibility (not used for save)
        html = render_template('components/record.j2.html',
                               id=id,
                               did=did,
                               sdid=sdid)
        resp = make_response(html)
        resp.headers['Content-Type'] = 'text/html; charset=utf-8'
        resp.headers[
            "Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

    # New simplified route: no did/sdid in path; prefer cat_id/sub_id via query
    @app.route('/files/rec/save/<name>/<desc>', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    @rate_limit
    def save(name: str, desc: str, did: int = 0, sdid: int = 1):
        """Save recorded media from the recorder iframe and start conversion."""
        try:
            desc = desc[1:]
            # Map did/sdid (indices) to actual folder names like in files page
            _dirs = dirs_by_permission(app, 3, 'f')
            if did >= len(_dirs):
                did = 0
            if sdid >= len(_dirs[did]):
                sdid = 1
            # values(): [root_folder, sub_folder_1, sub_folder_2, ...]
            try:
                values_list = list(_dirs[did].values())
            except Exception:
                values_list = []
            root_folder = values_list[0] if values_list else ''
            sub_folder = values_list[sdid] if values_list and sdid < len(
                values_list) else ''
            # Prefer explicit category/subcategory IDs if provided (avoid index mismatches due to disabled entries)
            cat_id = request.args.get('cat_id', type=int)
            sub_id = request.args.get('sub_id', type=int)
            # Compute path via DB helpers when possible
            if not (cat_id and sub_id):
                try:
                    cat_id = app._sql.category_id_by_folder(root_folder)
                    sub_id = app._sql.subcategory_id_by_folder(
                        cat_id, sub_folder) if cat_id else None
                except Exception:
                    pass
            try:
                if cat_id and sub_id:
                    dir = app._sql.get_file_storage_path(cat_id, sub_id)
                else:
                    dir = path.join(app._sql.config['files']['root'], 'files',
                                    root_folder, sub_folder)
            except Exception:
                dir = path.join(app._sql.config['files']['root'], 'files',
                                root_folder, sub_folder)
            # Ensure target directory tree exists
            make_dir(path.join(app._sql.config['files']['root'], 'files'),
                     root_folder, sub_folder)
            real_name = hash_str(dt.now().strftime('%Y-%m-%d_%H:%M:%S.f') +
                                 str(randint(1000, 9999)))
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
                log_action(
                    'RECORD_SAVE_START', current_user.name,
                    f'type={rec_type} name="{name}" did={did} sdid={sdid}',
                    (request.remote_addr or ''))
            except Exception:
                pass
            file_part = request.files.get(name +
                                          '.webm') or request.files.get('file')
            if not file_part:
                raise ValueError('Данные записи не получены')
            file_part.save(fname + '.webm')
            # Choose target extension based on recording type
            if rec_type == 'audio':
                real_target = real_name + '.m4a'
                convert_dst = fname + '.m4a'
            else:
                real_target = real_name + '.mp4'
                convert_dst = fname + '.mp4'
            # Insert using new schema only
            try:
                if not (cat_id and sub_id):
                    raise ValueError(
                        'Не удалось определить категорию/подкатегорию для записи'
                    )
                id = app._sql.file_add2([
                    name, real_target, cat_id, sub_id,
                    f'{current_user.name} ({app._sql.group_name_by_id([current_user.gid])})',
                    desc,
                    dt.now().strftime('%Y-%m-%d %H:%M'), 0, 0, 0.0
                ])
            except Exception:
                return {"error": "Не удалось создать запись файла"}, 400
            media_service.convert_async(fname + '.webm', convert_dst,
                                        ('file', id))
            # Log successful end of recording save
            try:
                log_action(
                    'RECORD_SAVE_END', current_user.name,
                    f'type={rec_type} name="{name}" id={id} status=SUCCESS',
                    (request.remote_addr or ''))
            except Exception:
                pass
            # Notify clients about new file via SyncManager
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'recorded',
                                       id=id,
                                       originClientId=origin)
                except Exception:
                    pass
            return {200: 'OK'}
        except Exception as e:
            app.flash_error(e)
            # Log failed save
            try:
                log_action(
                    'RECORD_SAVE_END',
                    current_user.name,
                    f'type=unknown name="{name}" status=FAILED error={str(e)}',
                    (request.remote_addr or ''),
                    success=False)
            except Exception:
                pass
            return {421: 'Can not process data'}

    @app.route('/files/page')
    @require_permissions(FILES_VIEW_PAGE)
    def files_page():
        """Return a page of files rows for the given cat_id/sub_id with pagination meta."""
        try:
            # Redirect direct HTML requests to the full Files page to avoid landing on JSON after login
            accept = (request.headers.get('Accept') or '')
            is_ajax = (
                request.headers.get('X-Requested-With') == 'XMLHttpRequest')
            if ('text/html' in accept) and (not is_ajax):
                return redirect(url_for('files'))
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 15))
            if page < 1: page = 1
            if page_size < 1: page_size = 15
            # Require explicit DB ids only (no legacy)
            cat_id = request.args.get('cat_id', type=int)
            sub_id = request.args.get('sub_id', type=int)
            if not (cat_id and sub_id):
                return jsonify({
                    'html': '',
                    'total': 0,
                    'page': page,
                    'page_size': page_size
                }), 200
            fs = []
            try:
                # SQL API expects a single arg list in this deployment
                fs = app._sql.file_by_category_and_subcategory(
                    [cat_id, sub_id])
            except Exception:
                fs = []
            dirs = dirs_by_permission(app, 3, 'f')
            # Update exists status for all files and sort by date descending (newest first)
            if fs:
                for file in fs:
                    file.update_exists_status()
                    # Update the database with the new exists status
                    app._sql.file_update_exists_status(file.id, file.exists)
                fs.sort(key=lambda f: f.created_at, reverse=True)
            total = len(fs or [])
            start = (page - 1) * page_size
            end = start + page_size
            files_slice = fs[start:end] if fs else []
            html = render_template('components/files_rows.j2.html',
                                   files=files_slice,
                                   did=0,
                                   sdid=1,
                                   dirs=dirs)
            resp = make_response(
                jsonify({
                    'html': html,
                    'total': total,
                    'page': page,
                    'page_size': page_size
                }))
            resp.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp
        except Exception as e:
            _log.error(f"Files page error: {e}")
            return jsonify({'error': str(e)}), 400

    @app.route('/files/search')
    @require_permissions(FILES_VIEW_PAGE)
    def files_search():
        """Global search across files in the given category/subcategory; server-paginated."""
        try:
            # Redirect direct HTML requests to the full Files page to avoid landing on JSON after login
            accept = (request.headers.get('Accept') or '')
            is_ajax = (
                request.headers.get('X-Requested-With') == 'XMLHttpRequest')
            if ('text/html' in accept) and (not is_ajax):
                return redirect(url_for('files'))
            q = (request.args.get('q') or '').strip()
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 30))
            if page < 1: page = 1
            if page_size < 1: page_size = 30
            # Require explicit DB ids only (no legacy)
            cat_id = request.args.get('cat_id', type=int)
            sub_id = request.args.get('sub_id', type=int)
            if not (cat_id and sub_id):
                return jsonify({
                    'html': '',
                    'total': 0,
                    'page': page,
                    'page_size': page_size
                }), 200
            fs = []
            try:
                fs = app._sql.file_search_by_category_and_subcategory(
                    [q, cat_id, sub_id])
            except TypeError:
                fs = app._sql.file_search_by_category_and_subcategory(
                    q, cat_id, sub_id)
            except Exception:
                fs = []
            dirs = dirs_by_permission(app, 3, 'f')
            fs = fs or []
            if q:
                q_cf = q.casefold()

                def matches(file):
                    # name
                    name = (getattr(file, 'display_name', '')
                            or getattr(file, 'name', '')
                            or getattr(file, 'real_name', '') or '')
                    # description
                    desc = getattr(file, 'description', '') or ''
                    # creator/owner
                    owner = getattr(file, 'owner', '') or ''
                    # creation date (string as shown in table)
                    date = getattr(file, 'date', '') or ''
                    try:
                        return (q_cf in str(name).casefold()
                                or q_cf in str(desc).casefold()
                                or q_cf in str(owner).casefold()
                                or q_cf in str(date).casefold())
                    except Exception:
                        return False

                fs = [f for f in fs if matches(f)]
            # Sort files by date descending (newest first)
            if fs:
                fs.sort(key=lambda f: f.created_at, reverse=True)
            total = len(fs)
            start = (page - 1) * page_size
            end = start + page_size
            files_slice = fs[start:end]
            html = render_template('components/files_rows.j2.html',
                                   files=files_slice,
                                   did=0,
                                   sdid=1,
                                   dirs=dirs)
            resp = make_response(
                jsonify({
                    'html': html,
                    'total': total,
                    'page': page,
                    'page_size': page_size
                }))
            resp.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp
        except Exception as e:
            _log.error(f"Files search error: {e}")
            return jsonify({'error': str(e)}), 400

    @app.route('/api/log-action', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    def api_log_action():
        """API endpoint for logging actions from JavaScript."""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No JSON data provided'}), 400

            action = data.get('action')
            details = data.get('details', '')
            status = data.get('status', 'SUCCESS')

            if not action:
                return jsonify({'error': 'Action is required'}), 400

            # Log the action
            log_action(action,
                       current_user.name,
                       details, (request.remote_addr or ''),
                       success=(status == 'SUCCESS'))

            return jsonify({'status': 'success'}), 200

        except Exception as e:
            _log.error(f"API log action error: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/registrator-upload', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    def api_registrator_upload():
        """API endpoint for background registrator file upload."""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No JSON data provided'}), 400

            file_urls = data.get('file_urls', [])
            file_names = data.get('file_names', [])
            registrator_name = data.get('registrator_name', '')
            registrator_id = data.get('registrator_id')
            cat_id = data.get('cat_id')
            sub_id = data.get('sub_id')

            if not all([
                    file_urls, file_names, registrator_name, registrator_id,
                    cat_id, sub_id
            ]):
                return jsonify({'error': 'Missing required parameters'}), 400

            # Check parallel upload limit using atomic Redis operation
            can_start, active_uploads, max_parallel = can_start_new_upload()

            if not can_start:
                return jsonify({
                    'error':
                    f'Maximum parallel uploads limit reached ({active_uploads}/{max_parallel})',
                    'active_uploads': active_uploads,
                    'max_parallel': max_parallel
                }), 429

            # Create upload job
            upload_id = f"upload_{int(time.time() * 1000)}_{current_user.id}"
            upload_job = {
                'id': upload_id,
                'user_id': current_user.id,
                'user_name': current_user.name,
                'file_urls': file_urls,
                'file_names': file_names,
                'registrator_name': registrator_name,
                'registrator_id': registrator_id,
                'cat_id': cat_id,
                'sub_id': sub_id,
                'total_files': len(file_urls),
                'completed_files': 0,
                'error_count': 0,
                'status': 'running',
                'start_time': time.time(),
                # ensure persistence/cleanup logic can rely on a stable timestamp
                'created_at': time.time(),
                'progress': 0,
                'ip': request.remote_addr or ''
            }

            # Save upload job to Redis
            save_upload_job(upload_job)

            # Log detailed start information
            _log.info(f"📊 Performance Debug - Starting registrator import")
            _log.info(f"📊 Performance Debug - Registrator: {registrator_name}")
            _log.info(f"📊 Performance Debug - Files count: {len(file_urls)}")
            _log.info(f"📊 Performance Debug - User: {current_user.name}")
            _log.info(f"📊 Performance Debug - Upload ID: {upload_id}")
            _log.info(
                f"📊 Performance Debug - Category ID: {cat_id}, Subcategory ID: {sub_id}"
            )

            # Start background upload
            start_background_upload(upload_job)

            # Log start
            log_action(
                'REGISTRATOR_IMPORT_START', current_user.name,
                f'started background import of {len(file_urls)} files from registrator "{registrator_name}"',
                (request.remote_addr or ''))

            return jsonify({
                'status':
                'success',
                'upload_id':
                upload_id,
                'message':
                f'Upload started in background. {active_uploads + 1}/{max_parallel} slots used.'  # type: ignore
            }), 200

        except Exception as e:
            _log.error(f"API registrator upload error: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/upload-status/<upload_id>', methods=['GET'])
    @require_permissions(FILES_UPLOAD)
    def api_upload_status(upload_id):
        """Get upload status by ID."""
        try:
            upload_job = get_upload_job(upload_id)
            if not upload_job:
                return jsonify({'error': 'Upload not found'}), 404

            # Check if user can access this upload
            if upload_job[
                    'user_id'] != current_user.id and not current_user.has(
                        'admin'):
                return jsonify({'error': 'Access denied'}), 403

            return jsonify({'status': 'success', 'upload': upload_job}), 200

        except Exception as e:
            _log.error(f"API upload status error: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/active-uploads', methods=['GET'])
    @require_permissions(FILES_UPLOAD)
    def api_active_uploads():
        """Get active uploads count and limit using improved Redis tracking."""
        try:
            can_start, active_uploads, max_parallel = can_start_new_upload()

            return jsonify({
                'status': 'success',
                'active_uploads': active_uploads,
                'max_parallel': max_parallel,
                'can_start_new': can_start
            }), 200

        except Exception as e:
            _log.error(f"API active uploads error: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/active-uploads-list', methods=['GET'])
    @require_permissions(FILES_UPLOAD)
    def api_active_uploads_list():
        """Get detailed list of active uploads."""
        try:
            active_uploads = get_active_upload_list()

            return jsonify({
                'status': 'success',
                'active_uploads': active_uploads,
                'count': len(active_uploads)
            }), 200

        except Exception as e:
            _log.error(f"API active uploads list error: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/cancel-upload/<upload_id>', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    def api_cancel_upload(upload_id):
        """Cancel an active upload and delete uploaded files."""
        try:
            import redis
            redis_client = redis.Redis(
                unix_socket_path='/var/run/redis/redis.sock',
                password='znf25!',
                db=0)

            # Get upload job data
            job_key = f"upload_job:{upload_id}"
            job_data = redis_client.get(job_key)

            if not job_data:
                return jsonify({
                    'success': False,
                    'error': 'Upload job not found'
                }), 404

            job_info = json.loads(
                job_data.decode('utf-8') if isinstance(job_data, bytes
                                                       ) else str(job_data))

            # Mark job as cancelled
            job_info['status'] = 'cancelled'
            job_info['cancelled_at'] = time.time()
            redis_client.set(job_key, json.dumps(job_info),
                             ex=3600)  # Keep for 1 hour

            # Remove from active uploads set
            redis_client.srem('active_uploads', upload_id)

            # Delete uploaded files from database and filesystem
            deleted_files = []
            if 'uploaded_files' in job_info:
                for file_info in job_info['uploaded_files']:
                    try:
                        # Delete from database
                        file_id = file_info.get('file_id')
                        if file_id:
                            app._sql.delete_file(file_id)
                            deleted_files.append(
                                file_info.get('filename', 'unknown'))

                        # Delete from filesystem
                        file_path = file_info.get('file_path')
                        if file_path and os.path.exists(file_path):
                            os.remove(file_path)

                    except Exception as e:
                        _log.error(f"Error deleting file {file_info}: {e}")

            # Log the cancellation
            log_action(
                f"Cancelled upload {upload_id}",
                f"Deleted {len(deleted_files)} files: {', '.join(deleted_files[:5])}{'...' if len(deleted_files) > 5 else ''}",
                current_user.id)

            return jsonify({
                'success': True,
                'message':
                f'Upload cancelled. Deleted {len(deleted_files)} files.',
                'deleted_files': deleted_files
            }), 200

        except Exception as e:
            _log.error(f"API cancel upload error: {e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/config', methods=['GET'])
    def api_config():
        """Get application configuration for frontend."""
        try:
            import configparser
            config = configparser.ConfigParser()
            config.read('/usr/share/znf/config.ini')

            # Convert config to dictionary
            config_dict = {}
            for section in config.sections():
                config_dict[section] = dict(config[section])

            return jsonify(config_dict)
        except Exception as e:
            _log.error(f"API config error: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/cleanup-uploads', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    def api_cleanup_uploads():
        """Clean up inactive upload jobs from Redis."""
        try:
            import redis
            redis_client = redis.Redis(
                unix_socket_path='/var/run/redis/redis.sock',
                password='znf25!',
                db=0)

            keys = redis_client.keys('upload_job:*')
            cleaned_count = 0
            current_time = time.time()

            if keys and isinstance(keys, list):
                for key in keys:
                    job_data = redis_client.get(key)
                    if job_data and isinstance(job_data, bytes):
                        import json
                        job = json.loads(
                            job_data.decode('utf-8'))  # type: ignore
                        job_status = job.get('status', 'unknown')
                        job_created = job.get('created_at', 0)

                        # Очищаем старые или завершенные загрузки
                        if (job_status in ['completed', 'failed', 'cancelled']
                                or (current_time - job_created)
                                > 3600):  # Старше 1 часа
                            redis_client.delete(key)
                            cleaned_count += 1

            # Получаем обновленный счетчик активных загрузок
            active_uploads = get_active_upload_count()

            log_action(f"Cleaned up {cleaned_count} inactive upload jobs",
                       f"Remaining active uploads: {active_uploads}",
                       current_user.id)

            return jsonify({
                'success':
                True,
                'cleaned_count':
                cleaned_count,
                'active_uploads':
                active_uploads,
                'message':
                f'Cleaned {cleaned_count} inactive upload jobs'
            }), 200

        except Exception as e:
            _log.error(f"API cleanup uploads error: {e}")
            return jsonify({'success': False, 'error': str(e)}), 500


# Helper functions for background upload management
def get_active_upload_count():
    """Get count of active uploads from Redis with improved tracking."""
    try:
        import redis
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)

        # Use Redis set for active uploads tracking
        active_uploads_set = redis_client.smembers(
            'active_uploads')  # type: ignore  # type: ignore
        if active_uploads_set:
            active_count = len(active_uploads_set)  # type: ignore
        else:
            active_count = 0

        # Clean up inactive uploads
        cleaned_count = 0
        if active_uploads_set:
            current_time = time.time()
            for upload_id in active_uploads_set:  # type: ignore
                upload_id = upload_id.decode('utf-8') if isinstance(
                    upload_id, bytes) else upload_id  # type: ignore
                job_data = redis_client.get(f"upload_job:{upload_id}")

                if not job_data:
                    # Job not found, remove from active set
                    redis_client.srem('active_uploads', upload_id)
                    cleaned_count += 1
                    continue

                try:
                    import json
                    job = json.loads(job_data.decode('utf-8'))  # type: ignore
                    job_status = job.get('status', 'unknown')
                    # use created_at if present, else fall back to start_time
                    job_created = job.get('created_at') or job.get(
                        'start_time') or 0

                    # Remove completed, failed, cancelled or old jobs
                    # Only purge completed/failed/cancelled, or very old running jobs (> 2h)
                    if (job_status in ['completed', 'failed', 'cancelled']
                            or ((current_time - float(job_created)) > 7200)):
                        redis_client.srem('active_uploads', upload_id)
                        redis_client.delete(f"upload_job:{upload_id}")
                        cleaned_count += 1
                except Exception as e:
                    _log.warning(f"Error processing upload {upload_id}: {e}")
                    redis_client.srem('active_uploads', upload_id)
                    cleaned_count += 1

        if cleaned_count > 0:
            _log.info(
                f"Cleaned {cleaned_count} inactive upload jobs from Redis")

        return active_count
    except Exception as e:
        _log.error(f"Error getting active upload count: {e}")
        return 0


def save_upload_job(upload_job):
    """Save upload job to Redis and add to active uploads set."""
    try:
        import redis
        import json
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)

        # Save job data
        redis_client.setex(f"upload_job:{upload_job['id']}", 3600,
                           json.dumps(upload_job))  # 1 hour TTL

        # Add to active uploads set if status is running
        if upload_job.get('status') == 'running':
            redis_client.sadd('active_uploads', upload_job['id'])

    except Exception as e:
        _log.error(f"Error saving upload job: {e}")


def get_upload_job(upload_id):
    """Get upload job from Redis."""
    try:
        import redis
        import json
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)
        job_data = redis_client.get(f"upload_job:{upload_id}")
        if job_data:
            try:
                payload = job_data.decode('utf-8') if isinstance(
                    job_data, bytes) else str(job_data)
                job = json.loads(payload)
                # Defensive: inject created_at if missing (older jobs)
                if 'created_at' not in job:
                    job['created_at'] = job.get('start_time', time.time())
                return job
            except Exception as _e:
                _log.error(f"Error decoding upload job {upload_id}: {_e}")
                return None
        return None
    except Exception as e:
        _log.error(f"Error getting upload job: {e}")
        return None


def update_upload_job(upload_id, updates):
    """Update upload job in Redis and manage active uploads set."""
    try:
        import redis
        import json
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)
        job_data = redis_client.get(f"upload_job:{upload_id}")
        if not job_data:
            return
        payload = job_data.decode('utf-8') if isinstance(
            job_data, bytes) else str(job_data)
        job = json.loads(payload)

        old_status = job.get('status')
        job.update(updates)
        new_status = job.get('status')

        # Update job data
        redis_client.setex(f"upload_job:{upload_id}", 3600, json.dumps(job))

        # Manage active uploads set based on status change
        if old_status != new_status:
            if new_status == 'running':
                redis_client.sadd('active_uploads', upload_id)
            elif new_status in ['completed', 'failed', 'cancelled']:
                redis_client.srem('active_uploads', upload_id)

    except Exception as e:
        _log.error(f"Error updating upload job: {e}")


def can_start_new_upload():
    """Atomically check if we can start a new upload (respects max_parallel_uploads)."""
    try:
        import redis
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)

        # Get max parallel uploads from config (default to 3)
        max_parallel = 3

        # Use Redis pipeline for atomic operation
        pipe = redis_client.pipeline()
        pipe.scard('active_uploads')
        pipe.smembers('active_uploads')
        results = pipe.execute()  # type: ignore

        active_count = results[0]
        active_uploads = results[1]

        # Clean up inactive uploads and recount
        if active_uploads:
            current_time = time.time()
            cleaned_count = 0
            for upload_id in active_uploads:
                upload_id = upload_id.decode('utf-8') if isinstance(
                    upload_id, bytes) else upload_id  # type: ignore
                job_data = redis_client.get(f"upload_job:{upload_id}")

                if not job_data:
                    redis_client.srem('active_uploads', upload_id)
                    cleaned_count += 1
                    continue

                try:
                    import json
                    job = json.loads(job_data.decode('utf-8'))  # type: ignore
                    job_status = job.get('status', 'unknown')
                    job_created = job.get('created_at', 0)

                    if (job_status in ['completed', 'failed', 'cancelled']
                            or (current_time - job_created) > 3600):
                        redis_client.srem('active_uploads', upload_id)
                        redis_client.delete(f"upload_job:{upload_id}")
                        cleaned_count += 1
                except Exception:
                    redis_client.srem('active_uploads', upload_id)
                    cleaned_count += 1

            if cleaned_count > 0:
                # Recount after cleanup
                active_count = redis_client.scard(
                    'active_uploads')  # type: ignore

        return active_count < max_parallel, active_count, max_parallel  # type: ignore

    except Exception as e:
        _log.error(f"Error checking upload limit: {e}")
        return False, 0, 3  # Default to not allowing if error


def get_active_upload_list():
    """Get list of active uploads with details."""
    try:
        import redis
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)

        active_uploads_set = redis_client.smembers(
            'active_uploads')  # type: ignore
        active_uploads = []

        if active_uploads_set:
            for upload_id in active_uploads_set:  # type: ignore
                upload_id = upload_id.decode('utf-8') if isinstance(
                    upload_id, bytes) else upload_id  # type: ignore
                job_data = redis_client.get(f"upload_job:{upload_id}")

                if job_data:
                    try:
                        import json
                        job = json.loads(
                            job_data.decode('utf-8'))  # type: ignore
                        if job.get('status') == 'running':
                            active_uploads.append({
                                'id':
                                upload_id,
                                'user_id':
                                job.get('user_id'),
                                'registrator_name':
                                job.get('registrator_name'),
                                'total_files':
                                job.get('total_files', 0),
                                'completed_files':
                                job.get('completed_files', 0),
                                'created_at':
                                job.get('created_at'),
                                'progress':
                                job.get('progress', 0)
                            })
                    except Exception as e:
                        _log.warning(
                            f"Error processing upload {upload_id}: {e}")
                        # Remove invalid upload from active set
                        redis_client.srem('active_uploads', upload_id)

        return active_uploads

    except Exception as e:
        _log.error(f"Error getting active upload list: {e}")
        return []


def increment_upload_error(upload_id):
    """Atomically increment error_count for an upload job."""
    try:
        import redis
        import json
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)
        job_key = f"upload_job:{upload_id}"
        job_data = redis_client.get(job_key)
        if job_data and isinstance(job_data, bytes):
            job = json.loads(job_data.decode('utf-8'))
            current_errors = int(job.get('error_count') or 0)
            job['error_count'] = current_errors + 1  # type: ignore
            redis_client.setex(job_key, 3600, json.dumps(job))
    except Exception as e:
        _log.error(f"Error incrementing upload job error_count: {e}")


def start_background_upload(upload_job):
    """Start background upload in separate thread."""

    def background_upload_worker():
        try:
            upload_id = upload_job['id']
            _log.info(f"Starting background upload {upload_id}")

            for i, (file_url, file_name) in enumerate(
                    zip(upload_job['file_urls'], upload_job['file_names'])):
                try:
                    # Update progress - mark file as started
                    update_upload_job(
                        upload_id, {
                            'completed_files': i,
                            'current_file': file_name,
                            'current_file_progress': 0,
                            'status': 'running'
                        })

                    # Download file directly from registrator
                    _log.info(
                        f"Downloading directly from registrator: {file_url}")

                    # Try different approaches for downloading
                    headers = {
                        'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': '*/*',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding':
                        'identity',  # Disable compression for large files
                        'Connection': 'keep-alive'
                    }

                    _log.info(
                        f"Starting download of {file_name} from {file_url}")

                    import time
                    start_time = time.time()

                    # Log additional debug info for performance analysis
                    _log.info(
                        f"📊 Performance Debug - File: {file_name}, URL: {file_url}"
                    )
                    _log.info(f"📊 Performance Debug - Headers: {headers}")
                    response = requests.get(file_url,
                                            timeout=300,
                                            verify=False,
                                            stream=True,
                                            headers=headers)

                    _log.info(
                        f"Download response status: {response.status_code}")

                    # Log response headers for debugging
                    _log.info(
                        f"📊 Performance Debug - Response headers: {dict(response.headers)}"
                    )

                    if response.status_code == 200:
                        # Download file with progress tracking
                        content_length = int(
                            response.headers.get('content-length', 0))
                        downloaded_size = 0
                        file_content = b''

                        _log.info(
                            f"Starting to download {file_name}, content-length: {content_length}"
                        )

                        # Log additional performance metrics
                        _log.info(
                            f"📊 Performance Debug - File size: {content_length / 1024 / 1024:.2f} MB"
                        )
                        _log.info(
                            f"📊 Performance Debug - Chunk size: 65536 bytes (64KB)"
                        )

                        download_start = time.time()
                        chunk_count = 0
                        last_logged_progress = -1  # Track last logged progress to avoid duplicates
                        for chunk in response.iter_content(
                                chunk_size=65536):  # 64KB chunks
                            if chunk:
                                file_content += chunk
                                downloaded_size += len(chunk)
                                chunk_count += 1
                                # Log progress every 100 chunks to avoid spam (64KB * 100 = 6.4MB)
                                if chunk_count % 100 == 0:
                                    _log.info(
                                        f"Downloaded {downloaded_size}/{content_length} bytes for {file_name}"
                                    )

                                # Update progress every 1MB or when complete
                                if content_length > 0:
                                    progress = int(
                                        (downloaded_size / content_length) *
                                        100)
                                    # Update progress more frequently for better UX
                                    if progress % 2 == 0 or downloaded_size == content_length:  # Update every 2%
                                        update_upload_job(
                                            upload_id,
                                            {
                                                'current_file_progress':
                                                progress,
                                                'status': 'running',
                                                'completed_files':
                                                i  # Update completed files count during download
                                            })
                                        # Reduced logging - only log significant progress updates
                                        if progress % 10 == 0 and progress != last_logged_progress:  # Log every 10% but only once per percentage
                                            _log.info(
                                                f"Upload progress: {i} files completed, {progress}% current file"
                                            )
                                            last_logged_progress = progress

                        # Log download performance
                        download_time = time.time() - download_start
                        download_speed = (
                            downloaded_size / 1024 /
                            1024) / download_time if download_time > 0 else 0

                        # Enhanced performance logging
                        _log.info(
                            f"📊 Performance Debug - Download completed: {downloaded_size} bytes in {download_time:.2f}s"
                        )
                        _log.info(
                            f"📊 Performance Debug - Download speed: {download_speed:.2f} MB/s"
                        )
                        _log.info(
                            f"📊 Performance Debug - Total chunks processed: {chunk_count}"
                        )
                        _log.info(
                            f"📊 Performance Debug - Average chunk time: {download_time/chunk_count*1000:.2f}ms per chunk"
                            if chunk_count >
                            0 else "📊 Performance Debug - No chunks processed")

                        # Upload file
                        files = {
                            'file': (file_name, file_content,
                                     'application/octet-stream')
                        }
                        data = {
                            'name': file_name,
                            'description':
                            f"[Регистратор - {upload_job['registrator_name']}]",
                            'cat_id': upload_job['cat_id'],
                            'sub_id': upload_job['sub_id']
                        }

                        # Log upload start
                        upload_start_time = time.time()
                        _log.info(
                            f"📊 Performance Debug - Starting upload to localhost:8080"
                        )

                        upload_response = requests.post(
                            f"http://localhost:8080/files/add?cat_id={upload_job['cat_id']}&sub_id={upload_job['sub_id']}",
                            files=files,
                            data=data,
                            timeout=300)

                        upload_time = time.time() - upload_start_time
                        _log.info(
                            f"📊 Performance Debug - Upload completed in {upload_time:.2f}s"
                        )

                        if upload_response.status_code == 200:
                            _log.info(f"Successfully uploaded {file_name}")
                            _log.info(
                                f"📊 Performance Debug - Upload successful: {upload_response.status_code}"
                            )
                            # Update completed files count after successful upload
                            update_upload_job(
                                upload_id, {
                                    'completed_files': i + 1,
                                    'current_file_progress': 100
                                })
                        else:
                            _log.error(
                                f"Failed to upload {file_name}: {upload_response.status_code}"
                            )
                            _log.error(
                                f"📊 Performance Debug - Upload failed: {upload_response.status_code}, Response: {upload_response.text[:200]}"
                            )
                            increment_upload_error(upload_id)
                    else:
                        _log.error(
                            f"Failed to download {file_url}: {response.status_code}"
                        )
                        increment_upload_error(upload_id)

                except Exception as e:
                    _log.error(f"Error processing file {file_name}: {e}")
                    increment_upload_error(upload_id)

            # Mark as completed
            total_time = time.time() - start_time
            update_upload_job(
                upload_id, {
                    'status': 'completed',
                    'completed_files': upload_job['total_files'],
                    'end_time': time.time()
                })

            # Log completion with performance summary
            log_action(
                'REGISTRATOR_IMPORT_END', upload_job['user_name'],
                f'completed background import of {upload_job["total_files"]} files from registrator "{upload_job["registrator_name"]}"',
                upload_job['ip'])

            _log.info(f"Completed background upload {upload_id}")
            _log.info(
                f"📊 Performance Summary - Total time: {total_time:.2f}s for {upload_job['total_files']} files"
            )
            _log.info(
                f"📊 Performance Summary - Average time per file: {total_time/upload_job['total_files']:.2f}s"
            )
            _log.info(
                f"📊 Performance Summary - Registrator: {upload_job['registrator_name']}"
            )

        except Exception as e:
            _log.error(f"Background upload error: {e}")
            update_upload_job(upload_job['id'], {
                'status': 'failed',
                'error': str(e),
                'end_time': time.time()
            })

    # Start background thread
    thread = threading.Thread(target=background_upload_worker)
    thread.daemon = True
    thread.start()
