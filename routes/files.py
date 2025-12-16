from flask import (abort, flash, jsonify, make_response, redirect, request,
                   render_template, Response, send_from_directory, url_for, jsonify)
from flask_login import current_user
from datetime import datetime as dt
from os import path, remove
from utils.common import make_dir, hash_str
from utils.dir_utils import validate_directory_params
from services.permissions import dirs_by_permission
from modules.SQLUtils import SQLUtils
from modules.permissions import require_permissions, FILES_VIEW_PAGE, FILES_UPLOAD, FILES_EDIT_ANY, FILES_DELETE_ANY, FILES_MARK_VIEWED, FILES_NOTES, ORDERS_EDIT_APPROVED
from modules.logging import get_logger, log_access, log_action
from flask import request, jsonify
from datetime import datetime
import time
import logging
import threading
import requests
import urllib3
import signal
import sys
import os
import redis
import re
import tempfile
from flask import current_app

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# Global list to track active upload threads
active_upload_threads = []
shutdown_flag = threading.Event()

def cleanup_upload_threads():
    """Gracefully shutdown all active upload threads."""
    global active_upload_threads, shutdown_flag
    if active_upload_threads:
        _log.info(f"Shutting down {len(active_upload_threads)} active upload threads...")
        shutdown_flag.set()
        active_upload_threads.clear()
        _log.info("Shutdown signal sent to all upload threads")

def signal_handler(signum, frame):
    """Handle shutdown signals."""
    cleanup_upload_threads()
    sys.exit(0)

# Register signal handlers for graceful shutdown
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

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
# Ensure logger propagates to root logger (which writes to app.log)
try:
    _log.propagate = True
    _log.setLevel(logging.INFO)
except Exception:
    pass


def clear_all_uploads_on_startup():
    """Clear all upload jobs from Redis on server startup."""
    try:
        # moved imports to top
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
        # Hide system category 'orders' (Наряды) from generic Files UI; keep visible only in embed/direct view
        try:
            is_embed = (str(request.args.get('embed', '')).strip() == '1')
        except Exception:
            is_embed = False
        if _dirs and not is_embed:
            try:
                filtered = []
                for d in _dirs:
                    try:
                        keys = list(d.keys())
                        if keys and str(keys[0]).strip().lower() == 'orders':
                            continue
                    except Exception:
                        pass
                    filtered.append(d)
                if filtered:
                    _dirs = filtered
            except Exception:
                pass
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
                                accept_attribute=accept_attribute,
                                embed=bool(request.args.get('embed'))))
            resp.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp

        # Optional: deep link by explicit cat_id/sub_id – build direct view limited to one subcategory
        direct_view = False
        direct_view_is_orders = False
        computed_can_manage = False
        computed_can_add = False
        computed_can_notes = False
        try:
            cat_id_arg = request.args.get('cat_id', type=int)
            sub_id_arg = request.args.get('sub_id', type=int)
            if cat_id_arg and sub_id_arg:
                cat_folder = app._sql._get_category_folder_by_id(int(cat_id_arg))
                sub_folder = app._sql._get_subcategory_folder_by_id(int(sub_id_arg))
                if cat_folder and sub_folder:
                    # Enforce: only allow orders system category and order-<id> subfolders
                    try:
                        orders_cat_id = app._sql.category_id_by_folder('orders')
                    except Exception:
                        orders_cat_id = None
                    if orders_cat_id and int(cat_id_arg) == int(orders_cat_id) and str(sub_folder or '').startswith('order-'):
                        # Replace dirs with a minimal structure limited to requested cat/sub
                        _dirs = [{cat_folder: cat_folder, sub_folder: sub_folder}]
                        did, sdid = 0, 1
                        direct_view = True
                        direct_view_is_orders = True
                        # Compute permissions server-side; ignore any force_* in query
                        # Admin or orders.files_edit -> full
                        try:
                            is_admin = current_user.has('admin.any')
                        except Exception:
                            is_admin = False
                        try:
                            can_orders_edit = current_user.has('orders.files_edit')
                        except Exception:
                            can_orders_edit = False
                        try:
                            can_orders_view = current_user.has('orders.files_view')
                        except Exception:
                            can_orders_view = False
                        # Derive order id from sub_folder
                        order_id_str = str(sub_folder)[len('order-'):] if str(sub_folder).startswith('order-') else ''
                        try:
                            order_id_val = int(order_id_str)
                        except Exception:
                            order_id_val = None
                        # Group ownership: creators' group full access
                        has_group_full = False
                        try:
                            if order_id_val:
                                prefix = app._sql.config['db']['prefix']
                                row = app._sql.execute_query(f'SELECT service FROM {prefix}_order WHERE id=%s', [order_id_val])
                                service = row[0][0] if row else ''
                                groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
                                service_gid = None
                                for gid, name in groups:
                                    if name == service:
                                        service_gid = int(gid)
                                        break
                                if service_gid and getattr(current_user, 'gid', None) and int(current_user.gid) == int(service_gid):
                                    has_group_full = True
                        except Exception:
                            has_group_full = False
                        # Final permissions
                        if is_admin or can_orders_edit or has_group_full:
                            computed_can_manage = True
                            computed_can_add = True
                            computed_can_notes = True
                        elif can_orders_view:
                            computed_can_manage = False
                            computed_can_add = False
                            computed_can_notes = False
                        else:
                            # Not authorized to view this order's files
                            return abort(403)
        except Exception:
            direct_view = False

        if not direct_view:
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
                                accept_attribute=accept_attribute,
                                embed=bool(request.args.get('embed'))))
            resp.headers[
                'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp

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
        
        # Safe access to subdir index
        files = None
        current_category_id = None
        current_subcategory_id = None
        if direct_view:
            # Fetch strictly by provided IDs
            current_category_id = request.args.get('cat_id', type=int)
            current_subcategory_id = request.args.get('sub_id', type=int)
            if current_category_id and current_subcategory_id:
                files = app._sql.file_by_category_and_subcategory([int(current_category_id), int(current_subcategory_id)])
        elif 1 <= sdid < len(dirs) and did is not None and did < len(_dirs):
            # Prefer new schema when available
            try:
                # Get root key from selected category (did), not from first category
                dirs_keys = list(_dirs[did].keys()) if _dirs and did < len(_dirs) else []
                if dirs_keys:
                    root_key = dirs_keys[0]
                    root_key_clean = _unsuffix(root_key)
                    cat_id = app._sql.category_id_by_folder(root_key_clean) if hasattr(
                        app._sql, 'category_id_by_folder') else None
                    # Get subcategory key from selected subcategory (sdid) from original _dirs structure
                    if sdid < len(dirs_keys):
                        sub_key = dirs_keys[sdid]
                        sub_key_clean = _unsuffix(sub_key)
                        sub_id = app._sql.subcategory_id_by_folder(
                            cat_id, sub_key_clean) if (cat_id and hasattr(
                                app._sql, 'subcategory_id_by_folder')) else None
                    else:
                        sub_id = None
                else:
                    cat_id = None
                    sub_id = None
                current_category_id = cat_id
                current_subcategory_id = sub_id
                # Log determined IDs for debugging
                try:
                    # Log _dirs structure to understand ordering
                    dirs_debug = []
                    for idx, d in enumerate(_dirs[:min(5, len(_dirs))]):
                        keys_list = list(d.keys())
                        if keys_list:
                            dirs_debug.append(f"{idx}:{keys_list[0]}")
                    _log.info(f"[files] Determined IDs: did={did}, sdid={sdid}, cat_id={cat_id}, sub_id={sub_id}, root_key={root_key_clean if 'root_key_clean' in locals() else 'N/A'}, sub_key={sub_key_clean if 'sub_key_clean' in locals() else 'N/A'}, dirs_preview={','.join(dirs_debug)}, user={current_user.name}")
                except Exception:
                    pass
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
            # Also check order completion status for order files
            order_completion_cache = {}  # Cache order status/finalization to avoid repeated queries
            if files:
                for file in files:
                    file.update_exists_status()
                    # Update the database with the new exists status
                    app._sql.file_update_exists_status(file.id, file.exists)
                    # Check if file belongs to a completed order
                    try:
                        if file.category_id and file.subcategory_id:
                            cat = app._sql.category_by_id([file.category_id])
                            sub = app._sql.subcategory_by_id([file.subcategory_id])
                            if cat and sub:
                                cat_folder = getattr(cat, 'folder_name', '') or ''
                                sub_folder = getattr(sub, 'folder_name', '') or ''
                                if cat_folder == 'orders' and str(sub_folder).startswith('order-'):
                                    order_id_str = str(sub_folder)[len('order-'):]
                                    try:
                                        order_id_val = int(order_id_str)
                                        if order_id_val not in order_completion_cache:
                                            prefix = app._sql.config['db']['prefix']
                                            row = app._sql.execute_query(
                                                f'SELECT status, finalized, approved FROM {prefix}_order WHERE id=%s',
                                                [order_id_val]
                                            )
                                            if row:
                                                order_status = (row[0][0] or '').strip().lower()
                                                order_finalized = int(row[0][1]) if row[0][1] is not None else 0
                                                order_approved = int(row[0][2]) if len(row[0]) > 2 and row[0][2] is not None else 0
                                                order_completion_cache[order_id_val] = {
                                                    'completed': (
                                                        order_status in ('done', '1', 'completed') or
                                                        order_finalized == 1
                                                    ),
                                                    'finalized': bool(order_finalized == 1),
                                                    'approved': int(order_approved)
                                                }
                                            else:
                                                order_completion_cache[order_id_val] = {
                                                    'completed': False,
                                                    'finalized': False,
                                                    'approved': 0
                                                }
                                        info = order_completion_cache.get(order_id_val, {})
                                        setattr(file, 'order_completed', bool(info.get('completed')))
                                        setattr(file, 'order_finalized', bool(info.get('finalized')))
                                        setattr(file, 'order_approved', int(info.get('approved', 0)))
                                    except Exception:
                                        setattr(file, 'order_completed', False)
                                        setattr(file, 'order_finalized', False)
                                else:
                                    setattr(file, 'order_completed', False)
                                    setattr(file, 'order_finalized', False)
                            else:
                                setattr(file, 'order_completed', False)
                                setattr(file, 'order_finalized', False)
                        else:
                            setattr(file, 'order_completed', False)
                            setattr(file, 'order_finalized', False)
                    except Exception:
                        setattr(file, 'order_completed', False)
                        setattr(file, 'order_finalized', False)
                # Sort files by robust timestamp (float) to avoid mixed-type comparisons
                def ts_of(f):
                    try:
                        v = getattr(f, 'created_at', None) or getattr(f, 'date', None) or getattr(f, 'created', None)
                        if v is None:
                            return 0.0
                        if isinstance(v, (int, float)):
                            return float(v)
                        try:
                            return float(v.timestamp())
                        except Exception:
                            pass
                        s = str(v)
                        from datetime import datetime
                        for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d.%m.%Y %H:%M:%S', '%d.%m.%Y'):
                            try:
                                return datetime.strptime(s, fmt).timestamp()
                            except Exception:
                                pass
                        try:
                            return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
                        except Exception:
                            return 0.0
                    except Exception:
                        return 0.0

                files.sort(key=ts_of, reverse=True)
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
        # Build from DB to avoid omissions; do not filter by permissions here
        move_categories = []
        try:
            # Fetch all categories
            rows_cats = app._sql.execute_query(
                f"SELECT id, display_name FROM {app._sql.config['db']['prefix']}_file_category ORDER BY display_name;",
                []) or []
            if not rows_cats:
                # Fallback to permission-derived structure
                try:
                    move_dirs = dirs_by_permission(app, 3, 'f') or []
                    for dir_entry in move_dirs:
                        keys = list(dir_entry.keys()); vals = list(dir_entry.values())
                        if not keys or not vals:
                            continue
                        cat_id = app._sql.category_id_by_folder(keys[0])
                        if cat_id is None:
                            continue
                        rows_cats.append((int(cat_id), vals[0]))
                except Exception:
                    pass
            for cid, cname in rows_cats:
                try:
                    cid_int = int(cid)
                    # Load subs
                    subs = {}
                    rows_subs = app._sql.execute_query(
                        f"SELECT id, display_name FROM {app._sql.config['db']['prefix']}_file_subcategory WHERE category_id=%s ORDER BY display_name;",
                        [cid_int]) or []
                    for sid, sname in rows_subs:
                        try:
                            sid_int = int(sid)
                            if cid_int == (current_category_id or 0) and sid_int == (current_subcategory_id or 0):
                                continue
                            subs[sid_int] = sname
                        except Exception:
                            continue
                    move_categories.append({
                        'id': cid_int,
                        'name': cname,
                        'key': '',
                        'subs': subs
                    })
                except Exception:
                    continue
        except Exception:
            move_categories = []

        # Flags for embedded minimal UI; ignore any force_* from query. Compute server-side.
        embed = bool(request.args.get('embed'))
        if embed and direct_view and direct_view_is_orders:
            force_can_manage = computed_can_manage
            force_can_add = computed_can_add
            force_can_notes = computed_can_notes
        else:
            # Non-embed or non-direct view: do not elevate; derive from user global permissions
            try:
                is_admin = current_user.has('admin.any')
            except Exception:
                is_admin = False
            try:
                can_files_manage = current_user.has('files.manage') or current_user.has('files.edit_any') or current_user.has('files.delete_any')
            except Exception:
                can_files_manage = False
            try:
                can_files_upload = current_user.has('files.upload')
            except Exception:
                can_files_upload = False
            try:
                can_files_notes = current_user.has('files.notes')
            except Exception:
                can_files_notes = False
            force_can_manage = bool(is_admin or can_files_manage)
            force_can_add = bool(is_admin or can_files_upload)
            force_can_notes = bool(is_admin or can_files_notes)

        # Check if current user is admin or in admin group
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
                pass
            return False
        
        is_admin_or_admin_group = current_user.has('admin.any') or _is_admin_group_member()
        
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
                            move_categories=move_categories,
                            embed=embed,
                            force_can_manage=force_can_manage,
                            force_can_add=force_can_add,
                            force_can_notes=force_can_notes,
                            is_admin_or_admin_group=is_admin_or_admin_group))
        resp.headers[
            'Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
        return resp
    @app.route('/api/files/subcategories', methods=['GET'])
    @require_permissions(FILES_VIEW_PAGE)
    def api_files_subcategories():
        try:
            cat_id = request.args.get('category_id', type=int)
            if not cat_id:
                return jsonify({'status': 'error', 'message': 'category_id required'}), 400
            rows = app._sql.execute_query(
                f"SELECT id, name FROM {app._sql.config['db']['prefix']}_file_subcategory WHERE category_id=%s ORDER BY name;",
                [cat_id]) or []
            items = [{'id': int(r[0]), 'name': r[1]} for r in rows]
            return jsonify({'status': 'success', 'items': items})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/files/categories', methods=['GET'])
    @require_permissions(FILES_VIEW_PAGE)
    def api_files_categories():
        try:
            cats = app._sql.execute_query(
                f"SELECT id, display_name FROM {app._sql.config['db']['prefix']}_file_category ORDER BY display_name;",
                []) or []
            items = []
            for cid, cname in cats:
                try:
                    rows_subs = app._sql.execute_query(
                        f"SELECT id, display_name FROM {app._sql.config['db']['prefix']}_file_subcategory WHERE category_id=%s ORDER BY display_name;",
                        [cid]) or []
                    subs = [{'id': int(sid), 'name': sname} for sid, sname in rows_subs]
                    items.append({'id': int(cid), 'name': cname, 'subs': subs})
                except Exception:
                    items.append({'id': int(cid), 'name': cname, 'subs': []})
            return jsonify({'status': 'success', 'items': items})
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/files/resolve-ids', methods=['GET'])
    @require_permissions(FILES_UPLOAD)
    def api_files_resolve_ids():
        """Resolve directory indices (did, sdid) to real category_id and subcategory_id."""
        try:
            did = request.args.get('did', type=int)
            sdid = request.args.get('sdid', type=int)
            
            if did is None or sdid is None:
                return jsonify({'status': 'error', 'message': 'did and sdid required'}), 400
            
            # Get directories structure for current user
            _dirs = dirs_by_permission(app, 3, 'f')
            
            if not _dirs or len(_dirs) == 0:
                return jsonify({'status': 'error', 'message': 'No directories available'}), 400
            
            # Validate indices
            if did < 0 or did >= len(_dirs):
                return jsonify({'status': 'error', 'message': 'Invalid category index'}), 400
            
            # Get category folder_name
            cat_keys = list(_dirs[did].keys())
            if not cat_keys:
                return jsonify({'status': 'error', 'message': 'Category not found'}), 400
            
            root_key = cat_keys[0]
            cat_id = app._sql.category_id_by_folder(root_key)
            
            if not cat_id:
                return jsonify({'status': 'error', 'message': 'Category ID not found'}), 400
            
            # Get subcategory folder_name
            sub_keys = list(_dirs[did].keys())
            if sdid < 0 or sdid >= len(sub_keys):
                return jsonify({'status': 'error', 'message': 'Invalid subcategory index'}), 400
            
            sub_key = sub_keys[sdid]
            # Handle duplicate keys (with __dup_ suffix)
            if '__dup_' in sub_key:
                sub_key = sub_key.split('__dup_')[0]
            
            sub_id = app._sql.subcategory_id_by_folder(cat_id, sub_key)
            
            if not sub_id:
                return jsonify({'status': 'error', 'message': 'Subcategory ID not found'}), 400
            
            return jsonify({
                'status': 'success',
                'category_id': int(cat_id),
                'subcategory_id': int(sub_id)
            })
        except Exception as e:
            app.flash_error(e)
            return jsonify({'status': 'error', 'message': str(e)}), 500


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
            # Verify subcategory belongs to the specified category
            try:
                sub = app._sql.subcategory_by_id([sub_id])
                if sub:
                    sub_cat_id = int(getattr(sub, 'category_id', 0))
                    if sub_cat_id != int(cat_id):
                        # Log the mismatch for debugging
                        try:
                            _log.warning(f"[files/add] Category mismatch detected: provided cat_id={cat_id}, sub_id={sub_id}, but sub.category_id={sub_cat_id}. Using correct category_id.")
                            app.logger.warning(f"[files/add] Category mismatch: cat_id={cat_id}, sub_id={sub_id}, sub.category_id={sub_cat_id}, user={current_user.name}")
                        except Exception:
                            pass
                        # Use the correct category_id from the subcategory
                        cat_id = sub_cat_id
            except Exception as e:
                try:
                    _log.error(f"[files/add] Error verifying subcategory: {e}")
                except Exception:
                    pass
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
            os.makedirs(dir, exist_ok=True)
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
            try:
                _log.info(f"[files] File uploaded (single-phase): path={fpath + '.webm'}, user={current_user.name}, size={os.path.getsize(fpath + '.webm')} bytes")
            except Exception as log_err:
                # Fallback to app logger if _log fails
                try:
                    app.logger.info(f"[files] File uploaded (single-phase): path={fpath + '.webm'}, user={current_user.name}")
                except Exception:
                    pass
            # Get file size from saved .webm
            stat = os.stat(fpath + '.webm')
            size_mb = round(stat.st_size / (1024 * 1024), 1)
            # Decide target extension by uploaded file type (using media service detection)
            is_audio = media_service.is_audio_file(fpath + '.webm')
            target_ext = '.m4a' if is_audio else '.mp4'
            # Insert using new schema only
            id = app._sql.file_add2([
                name, real_name + target_ext, cat_id, sub_id,
                current_user.id,  # owner_id should be user ID, not the owner string
                desc,
                None,  # Let MySQL set created_at automatically with CURRENT_TIMESTAMP
                0, 0, size_mb
            ])
            # Probe duration from saved .webm using ffprobe
            length_seconds = 0
            try:
                p = subprocess.Popen(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                     "default=noprint_wrappers=1:nokey=1", fpath + '.webm'],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True
                )
                sout, serr = p.communicate(timeout=10)
                if sout:
                    length_seconds = int(float(sout.strip()) or 0)
                if not length_seconds and is_audio:
                    # Fallback for audio: probe audio stream
                    p = subprocess.Popen(
                        ["ffprobe", "-v", "error", "-select_streams", "a:0",
                         "-show_entries", "stream=duration", "-of",
                         "default=noprint_wrappers=1:nokey=1", fpath + '.webm'],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True
                    )
                    sout, _ = p.communicate(timeout=10)
                    if sout:
                        length_seconds = int(float(sout.strip()) or 0)
            except Exception as e:
                _log.error(f"Failed to probe duration: {e}")
            
            app._sql.file_update_metadata([length_seconds, size_mb, id])
            if socketio:
                origin = (request.headers.get('X-Client-Id') or '').strip()
                emit_files_changed(app.socketio, 'metadata', id=id, originClientId=origin,
                                   meta={'length': length_seconds, 'size': size_mb})
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
            target_path = fpath + ('.m4a' if is_audio else '.mp4')
            _log.info(f"[files] Starting conversion: id={id}, from={fpath + '.webm'}, to={target_path}")
            media_service.convert_async(
                fpath + '.webm', target_path,
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
            # Get category/subcategory IDs from args (URL) or form (POST body)
            cat_id_from_args = request.args.get('cat_id', type=int)
            sub_id_from_args = request.args.get('sub_id', type=int)
            cat_id_from_form = request.form.get('cat_id', type=int)
            sub_id_from_form = request.form.get('sub_id', type=int)
            cat_id = cat_id_from_args or cat_id_from_form
            sub_id = sub_id_from_args or sub_id_from_form
            
            # Log received values for debugging
            try:
                referer = request.headers.get('Referer', '')
                request_url = request.url
                _log.info(f"[files/add/init] Received cat_id: args={cat_id_from_args}, form={cat_id_from_form}, final={cat_id}; sub_id: args={sub_id_from_args}, form={sub_id_from_form}, final={sub_id}, user={current_user.name}, referer={referer}, request_url={request_url}")
            except Exception:
                pass
            
            # Extract did/sdid from referer URL and resolve to cat_id/sub_id
            referer = request.headers.get('Referer', '')
            if referer and ('/files/' in referer):
                try:
                    from urllib.parse import urlparse, parse_qs
                    parsed = urlparse(referer)
                    path_parts = [p for p in parsed.path.split('/') if p]
                    if len(path_parts) >= 3 and path_parts[0] == 'files':
                        try:
                            did = int(path_parts[1])
                            sdid = int(path_parts[2])
                            # Build _dirs structure for current user (same as in files() route)
                            _dirs = dirs_by_permission(app, 3, 'f')
                            # Adjust did if 'orders' category is present at position 0 (hidden in files() but may appear here)
                            did_adjusted = did
                            try:
                                if _dirs and len(_dirs) > 0:
                                    first_dir_keys = list(_dirs[0].keys())
                                    if first_dir_keys and first_dir_keys[0] == 'orders':
                                        did_adjusted = did + 1
                            except Exception:
                                pass
                            if did_adjusted < len(_dirs):
                                dirs_keys = list(_dirs[did_adjusted].keys())
                                if dirs_keys and sdid < len(dirs_keys):
                                    root_key = dirs_keys[0]
                                    if '__dup_' in root_key:
                                        root_key = root_key.split('__dup_')[0]
                                    resolved_cat_id = app._sql.category_id_by_folder(root_key)
                                    if resolved_cat_id:
                                        sub_key = dirs_keys[sdid]
                                        if '__dup_' in sub_key:
                                            sub_key = sub_key.split('__dup_')[0]
                                        resolved_sub_id = app._sql.subcategory_id_by_folder(resolved_cat_id, sub_key)
                                        if resolved_sub_id:
                                            cat_id = resolved_cat_id
                                            sub_id = resolved_sub_id
                        except (ValueError, IndexError, TypeError):
                            pass
                except Exception:
                    pass
            
            if not (cat_id and sub_id):
                return {
                    'error':
                    'Не удалось определить категорию/подкатегорию для загрузки'
                }, 400
            # Verify subcategory belongs to the specified category
            try:
                sub = app._sql.subcategory_by_id([sub_id])
                if sub:
                    sub_cat_id = int(getattr(sub, 'category_id', 0))
                    if sub_cat_id != int(cat_id):
                        # Log the mismatch for debugging
                        try:
                            _log.warning(f"[files/add/init] Category mismatch detected: provided cat_id={cat_id}, sub_id={sub_id}, but sub.category_id={sub_cat_id}. Using correct category_id. user={current_user.name}")
                            app.logger.warning(f"[files/add/init] Category mismatch: cat_id={cat_id}, sub_id={sub_id}, sub.category_id={sub_cat_id}, user={current_user.name}")
                        except Exception:
                            pass
                        # Use the correct category_id from the subcategory
                        cat_id = sub_cat_id
                        try:
                            _log.info(f"[files/add/init] Corrected cat_id to {cat_id} for sub_id={sub_id}, user={current_user.name}")
                        except Exception:
                            pass
            except Exception as e:
                try:
                    _log.error(f"[files/add/init] Error verifying subcategory: {e}")
                except Exception:
                    pass
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
                    current_user.id,  # owner_id should be user ID, not the owner string
                    desc,
                    None,  # Let MySQL set created_at automatically with CURRENT_TIMESTAMP
                    0, 0, 0
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
            
            # Get storage path using category/subcategory IDs
            if hasattr(file_rec, 'category_id') and hasattr(file_rec, 'subcategory_id'):
                storage_dir = app._sql.get_file_storage_path(
                    file_rec.category_id, file_rec.subcategory_id)
            else:
                # Fallback: try to get from file_rec.path or use default
                storage_dir = getattr(file_rec, 'path', '') or path.join(
                    app._sql.config['files']['root'], 'files')
            
            # Ensure directory exists
            try:
                os.makedirs(storage_dir, exist_ok=True)
            except Exception:
                pass
            
            # Build file path: use real_name from DB (which includes .mp4 extension)
            real_name_base = path.splitext(file_rec.real_name or file_rec.file_name)[0]
            base = path.join(storage_dir, real_name_base)
            
            # Save original
            if not file_part:
                return {'error': 'Файл не получен'}, 400
            
            webm_path = base + '.webm'
            file_part.save(webm_path)
            try:
                file_size = os.path.getsize(webm_path)
                _log.info(f"[files] File uploaded: id={id}, path={webm_path}, user={current_user.name}, size={file_size} bytes")
            except Exception as log_err:
                # Fallback to app logger if _log fails
                try:
                    app.logger.info(f"[files] File uploaded: id={id}, path={webm_path}, user={current_user.name}")
                except Exception:
                    pass
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
                    "default=noprint_wrappers=1:nokey=1", webm_path
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
            target_ext = (path.splitext(file_rec.real_name or file_rec.file_name)[1]
                          or '.mp4').lower()
            target_path = base + ('.m4a' if target_ext == '.m4a' else '.mp4')
            _log.info(f"[files] Starting conversion: id={id}, from={webm_path}, to={target_path}")
            media_service.convert_async(
                webm_path,
                target_path,
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
        
        # Check standard permissions
        has_standard_permission = (
            current_user.has('files.edit_any') or
            (file.owner_id and file.owner_id == current_user.id)
        )
        
        # Check order file permissions (if file belongs to an order)
        has_order_permission = False
        if not has_standard_permission:
            try:
                cat = app._sql.category_by_id([file.category_id])
                sub = app._sql.subcategory_by_id([file.subcategory_id])
                if cat and sub:
                    cat_folder = getattr(cat, 'folder_name', '') or ''
                    sub_folder = getattr(sub, 'folder_name', '') or ''
                    if cat_folder == 'orders' and str(sub_folder).startswith('order-'):
                        order_id_str = str(sub_folder)[len('order-'):]
                        try:
                            order_id_val = int(order_id_str)
                            prefix = app._sql.config['db']['prefix']
                            row = app._sql.execute_query(
                                f'SELECT service, creator_gid, approved, finalized FROM {prefix}_order WHERE id=%s',
                                [order_id_val]
                            )
                            if row:
                                service = row[0][0] if row[0][0] else ''
                                creator_gid = int(row[0][1]) if (row and row[0][1] is not None) else None
                                order_approved = int(row[0][2]) if (row and len(row[0]) > 2 and row[0][2] is not None) else 0
                                order_finalized = int(row[0][3]) if (row and len(row[0]) > 3 and row[0][3] is not None) else 0
                                groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
                                service_gid = None
                                for gid, name in groups:
                                    if name == service:
                                        service_gid = int(gid)
                                        break
                                user_gid = int(getattr(current_user, 'gid', 0) or 0)
                                # Check if order is finalized - if so, only admin can edit
                                if order_finalized == 1:
                                    # Only admin can edit finalized orders
                                    if current_user.has('admin.any'):
                                        has_order_permission = True
                                # Check if user has edit_approved permission - allows editing all orders regardless of approved status
                                elif current_user.has('orders.edit_approved'):
                                    # With edit_approved permission, can edit all orders (except finalized=1, already checked above)
                                    has_order_permission = True
                                # Without edit_approved, can only edit when approved != 1
                                elif order_approved != 1:
                                    # For pending (0) or rejected (-1) orders, use standard order permission logic
                                    if (service_gid and user_gid == service_gid) or (creator_gid and user_gid == creator_gid):
                                        has_order_permission = True
                                    elif current_user.has('admin.any') or current_user.has('orders.files_edit'):
                                        has_order_permission = True
                                # If approved == 1 and no edit_approved permission, cannot edit
                        except Exception:
                            pass
            except Exception:
                pass
        
        if not (has_standard_permission or has_order_permission):
            return abort(403)
        try:
            name = (request.form.get('name') or '').strip()
            desc = (request.form.get('description') or '').strip()
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
        except Exception as e:
            app.flash_error(e)
            log_action(
                'FILE_EDIT',
                current_user.name,
                f'failed to edit file {file.display_name}: {str(e)}{get_file_location_info(file, app)}',
                (request.remote_addr or ''),
                success=False)
        finally:
            # Emit sync event (always, regardless of success/failure)
            if socketio:
                try:
                    origin = (request.headers.get('X-Client-Id') or '').strip()
                    emit_files_changed(app.socketio,
                                       'edited',
                                       id=id,
                                       originClientId=origin)
                except Exception:
                    pass

            # Return JSON for AJAX requests, redirect for traditional forms
            try:
                accept = (request.headers.get('Accept') or '').lower()
                xrw = (request.headers.get('X-Requested-With') or '').lower()
                if 'application/json' in accept or xrw in ('xmlhttprequest',
                                                           'fetch'):
                    return {
                        'status': 'success',
                        'message': 'File updated successfully'
                    }, 200
            except Exception:
                pass
            return redirect(url_for('files'))

    @app.route('/files/delete/<int:id>', methods=['POST'])
    @rate_limit
    def files_delete(id: int):
        """Delete file: remove DB record and any existing media files (.mp4, .webm)."""
        #
        if id <= 0:
            # For AJAX/fetch callers return JSON 200 (idempotent), else redirect with flash
            try:
                accept = (request.headers.get('Accept') or '').lower()
                xrw = (request.headers.get('X-Requested-With') or '').lower()
                ctype = (request.headers.get('Content-Type') or '').lower()
                if ('application/json' in accept or ctype == 'application/json' or xrw in ('xmlhttprequest','fetch')):
                    return jsonify({'status': 'success', 'message': 'Already deleted', 'code': 'invalid_id'}), 200
            except Exception:
                pass
            app.flash_error('Invalid file ID')
            return redirect(url_for('files'))

        file = app._sql.file_by_id([id])
        if not file:
            try:
                accept = (request.headers.get('Accept') or '').lower()
                xrw = (request.headers.get('X-Requested-With') or '').lower()
                ctype = (request.headers.get('Content-Type') or '').lower()
                if ('application/json' in accept or ctype == 'application/json' or xrw in ('xmlhttprequest','fetch')):
                    return jsonify({'status': 'success', 'message': 'Already deleted', 'code': 'not_found'}), 200
            except Exception:
                pass
            app.flash_error('File not found')
            return redirect(url_for('files'))

        # Permission: allow delete_any or owner of the file
        try:
            is_owner = bool(file.owner_id and (file.owner_id == current_user.id))
        except Exception:
            is_owner = False
        can_delete = current_user.has('files.delete_any') or is_owner
        
        # Check order file permissions (if file belongs to an order)
        order_is_completed = False
        if not can_delete:
            try:
                cat = app._sql.category_by_id([file.category_id])
                sub = app._sql.subcategory_by_id([file.subcategory_id])
                if cat and sub:
                    cat_folder = getattr(cat, 'folder_name', '') or ''
                    sub_folder = getattr(sub, 'folder_name', '') or ''
                    if cat_folder == 'orders' and str(sub_folder).startswith('order-'):
                        order_id_str = str(sub_folder)[len('order-'):]
                        try:
                            order_id_val = int(order_id_str)
                            prefix = app._sql.config['db']['prefix']
                            row = app._sql.execute_query(
                                f'SELECT service, creator_gid, status, finalized, approved FROM {prefix}_order WHERE id=%s',
                                [order_id_val]
                            )
                            if row:
                                service = row[0][0] if row[0][0] else ''
                                creator_gid = int(row[0][1]) if (row and row[0][1] is not None) else None
                                order_status = (row[0][2] or '').strip().lower() if len(row[0]) > 2 else ''
                                order_finalized = int(row[0][3]) if len(row[0]) > 3 and row[0][3] is not None else 0
                                order_approved = int(row[0][4]) if len(row[0]) > 4 and row[0][4] is not None else 0
                                # Check if order is completed
                                order_is_completed = (
                                    order_status in ('done', '1', 'completed') or
                                    order_finalized == 1
                                )
                                groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
                                service_gid = None
                                for gid, name in groups:
                                    if name == service:
                                        service_gid = int(gid)
                                        break
                                user_gid = int(getattr(current_user, 'gid', 0) or 0)
                                # Check if order is finalized - if so, only admin can delete
                                if order_finalized == 1:
                                    # Only admin can delete files from finalized orders
                                    if current_user.has('admin.any'):
                                        can_delete = True
                                # Check if user has edit_approved permission - allows deleting from all orders regardless of approved status
                                elif current_user.has('orders.edit_approved'):
                                    # With edit_approved permission, can delete from all orders (except finalized=1, already checked above)
                                    can_delete = True
                                # Without edit_approved, can only delete when approved != 1
                                elif order_approved != 1:
                                    # For pending (0) or rejected (-1) orders, use standard order permission logic
                                    if (service_gid and user_gid == service_gid) or (creator_gid and user_gid == creator_gid):
                                        can_delete = True
                                    elif current_user.has('admin.any') or current_user.has('orders.files_edit'):
                                        can_delete = True
                                # If approved == 1 and no edit_approved permission, cannot delete
                        except Exception:
                            pass
            except Exception:
                pass
        
        # If order is completed, only allow deletion for admin or admin group
        if order_is_completed and can_delete:
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
                    pass
                return False
            
            is_admin = current_user.has('admin.any') or _is_admin_group_member()
            if not is_admin:
                can_delete = False
                try:
                    accept = (request.headers.get('Accept') or '').lower()
                    xrw = (request.headers.get('X-Requested-With') or '').lower()
                    ctype = (request.headers.get('Content-Type') or '').lower()
                    if ('application/json' in accept or ctype == 'application/json' or xrw in ('xmlhttprequest','fetch')):
                        return jsonify({'status': 'error', 'error': 'forbidden', 'code': 'order_completed_no_delete'}), 403
                except Exception:
                    pass
                app.flash_error('Нельзя удалять файлы из закрытого наряда')
                return redirect(url_for('files'))
        
        if not can_delete:
            try:
                accept = (request.headers.get('Accept') or '').lower()
                xrw = (request.headers.get('X-Requested-With') or '').lower()
                ctype = (request.headers.get('Content-Type') or '').lower()
                if ('application/json' in accept or ctype == 'application/json' or xrw in ('xmlhttprequest','fetch')):
                    return jsonify({'status': 'error', 'error': 'forbidden', 'code': 'delete_permission_required'}), 403
            except Exception:
                pass
            app.flash_error('Недостаточно прав для удаления файла')
            return redirect(url_for('files'))

        # Set the file path
        try:
            file.path = app._sql.get_file_storage_path(file.category_id, file.subcategory_id)
        except Exception:
            file.path = ""

        try:
            app._sql.file_delete([id])
            # Distinguish cleanup-initiated deletes for better tracing
            if request.headers.get('X-Upload-Cleanup') == '1':
                log_action(
                    'FILE_DELETE_CLEANUP', current_user.name,
                    f'cleanup deleted file {file.display_name} (id={id}){get_file_location_info(file, app)}',
                    (request.remote_addr or ''))
            else:
                log_action(
                    'FILE_DELETE', current_user.name,
                    f'deleted file {file.display_name} (id={id}){get_file_location_info(file, app)}',
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
            _log.error(f"Error deleting file id={id}: {str(e)}")
            app.flash_error(e)
            log_action(
                'FILE_DELETE',
                current_user.name,
                f'failed to delete file {file.display_name}: {str(e)}{get_file_location_info(file, app)}',
                (request.remote_addr or ''),
                success=False)
        finally:
            # Return JSON for AJAX/fetch requests, redirect for traditional forms
            try:
                accept = (request.headers.get('Accept') or '').lower()
                xrw = (request.headers.get('X-Requested-With') or '').lower()
                ctype = (request.headers.get('Content-Type') or '').lower()
                if ('application/json' in accept or ctype == 'application/json'
                        or xrw in ('xmlhttprequest', 'fetch')):
                    from flask import jsonify
                    return jsonify({'status': 'success', 'message': 'File deleted successfully'}), 200
            except Exception:
                pass
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
                # Avoid spamming logs for video range chunk requests
                try:
                    rng = (request.headers.get('Range') or '').strip()
                except Exception:
                    rng = ''
                if not rng:
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
                    pass
                return False

            has_global_access = (
                current_user.has('admin.any') or
                current_user.has('files.display_all') or
                _is_admin_group_member()
            )

            if not (current_user.has('files.edit_any') or
                    (file.owner_id and file.owner_id == current_user.id) or
                    has_global_access):
                # Check category/subcategory permissions (including subcategory permission store)
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
                    
                    # Special handling for order files: check if user's group matches order's service group
                    has_order_access = False
                    try:
                        cat_folder = getattr(cat, 'folder_name', '') or ''
                        sub_folder = getattr(sub, 'folder_name', '') or ''
                        if cat_folder == 'orders' and str(sub_folder).startswith('order-'):
                            order_id_str = str(sub_folder)[len('order-'):]
                            try:
                                order_id_val = int(order_id_str)
                                prefix = app._sql.config['db']['prefix']
                                row = app._sql.execute_query(
                                    f'SELECT service, creator_gid FROM {prefix}_order WHERE id=%s',
                                    [order_id_val]
                                )
                                if row:
                                    service = row[0][0] if row[0][0] else ''
                                    creator_gid = int(row[0][1]) if (row and row[0][1] is not None) else None
                                    groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
                                    service_gid = None
                                    for gid, name in groups:
                                        if name == service:
                                            service_gid = int(gid)
                                            break
                                    user_gid = int(getattr(current_user, 'gid', 0) or 0)
                                    if (service_gid and user_gid == service_gid) or (creator_gid and user_gid == creator_gid):
                                        has_order_access = True
                            except Exception:
                                pass
                    except Exception:
                        pass
                    
                    if has_order_access:
                        # Allow access for order service group members
                        pass
                    else:
                        # Check stored permissions
                        try:
                            key = f"subcategory_permissions:{int(file.subcategory_id)}"
                            raw = app._sql.setting_get(key)
                            allowed = False
                            if raw:
                                import json
                                perms = json.loads(raw)
                                gid = int(getattr(current_user, 'gid', 0) or 0)
                                uid = int(getattr(current_user, 'id', 0) or 0)
                                gmx = perms.get('group_by_id', {}).get(str(gid), {}) if isinstance(perms.get('group_by_id'), dict) else {}
                                umx = perms.get('user_by_id', {}).get(str(uid), {}) if isinstance(perms.get('user_by_id'), dict) else {}
                                if any(int(gmx.get(k, 0)) == 1 for k in ('view_all','view_group','view_own')):
                                    allowed = True
                                if not allowed and any(int(umx.get(k, 0)) == 1 for k in ('view_all','view_group','view_own')):
                                    allowed = True
                                if not allowed and int(perms.get('group', {}).get(str(gid), 0) or 0) == 1:
                                    allowed = True
                                if not allowed:
                                    login = (getattr(current_user, 'login', '') or '').strip()
                                    if login and int(perms.get('user', {}).get(login, 0) or 0) == 1:
                                        allowed = True
                            if not raw:
                                allowed = False
                            if not allowed:
                                flash('Доступ к подкатегории запрещён', 'error')
                                return redirect(url_for('files'))
                        except Exception:
                            flash('Доступ к подкатегории запрещён', 'error')
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
                # Avoid spamming logs for video range chunk requests
                try:
                    rng = (request.headers.get('Range') or '').strip()
                except Exception:
                    rng = ''
                if not rng:
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
                    pass
                return False

            has_global_access = (
                current_user.has('admin.any') or
                current_user.has('files.display_all') or
                _is_admin_group_member()
            )

            if not (current_user.has('files.edit_any') or
                    (file.owner_id and file.owner_id == current_user.id) or
                    has_global_access):
                # Check category/subcategory permissions (including subcategory permission store)
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
                    
                    # Special handling for order files: check if user's group matches order's service group
                    has_order_access = False
                    try:
                        cat_folder = getattr(cat, 'folder_name', '') or ''
                        sub_folder = getattr(sub, 'folder_name', '') or ''
                        if cat_folder == 'orders' and str(sub_folder).startswith('order-'):
                            order_id_str = str(sub_folder)[len('order-'):]
                            try:
                                order_id_val = int(order_id_str)
                                prefix = app._sql.config['db']['prefix']
                                row = app._sql.execute_query(
                                    f'SELECT service, creator_gid FROM {prefix}_order WHERE id=%s',
                                    [order_id_val]
                                )
                                if row:
                                    service = row[0][0] if row[0][0] else ''
                                    creator_gid = int(row[0][1]) if (row and row[0][1] is not None) else None
                                    groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
                                    service_gid = None
                                    for gid, name in groups:
                                        if name == service:
                                            service_gid = int(gid)
                                            break
                                    user_gid = int(getattr(current_user, 'gid', 0) or 0)
                                    if (service_gid and user_gid == service_gid) or (creator_gid and user_gid == creator_gid):
                                        has_order_access = True
                            except Exception:
                                pass
                    except Exception:
                        pass
                    
                    if has_order_access:
                        # Allow access for order service group members
                        pass
                    else:
                        # Check stored permissions
                        try:
                            key = f"subcategory_permissions:{int(file.subcategory_id)}"
                            raw = app._sql.setting_get(key)
                            allowed = False
                            if raw:
                                import json
                                perms = json.loads(raw)
                                gid = int(getattr(current_user, 'gid', 0) or 0)
                                uid = int(getattr(current_user, 'id', 0) or 0)
                                gmx = perms.get('group_by_id', {}).get(str(gid), {}) if isinstance(perms.get('group_by_id'), dict) else {}
                                umx = perms.get('user_by_id', {}).get(str(uid), {}) if isinstance(perms.get('user_by_id'), dict) else {}
                                if any(int(gmx.get(k, 0)) == 1 for k in ('view_all','view_group','view_own')):
                                    allowed = True
                                if not allowed and any(int(umx.get(k, 0)) == 1 for k in ('view_all','view_group','view_own')):
                                    allowed = True
                                if not allowed and int(perms.get('group', {}).get(str(gid), 0) or 0) == 1:
                                    allowed = True
                                if not allowed:
                                    login = (getattr(current_user, 'login', '') or '').strip()
                                    if login and int(perms.get('user', {}).get(login, 0) or 0) == 1:
                                        allowed = True
                            if not raw:
                                allowed = False
                            if not allowed:
                                flash('Доступ к подкатегории запрещён', 'error')
                                return redirect(url_for('files'))
                        except Exception:
                            flash('Доступ к подкатегории запрещён', 'error')
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
        if not (current_user.has('files.edit_any') or
                (file.owner_id and file.owner_id == current_user.id)):
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
                # Return JSON error for AJAX requests
                if request.headers.get(
                        'Content-Type'
                ) == 'application/json' or request.headers.get(
                        'X-Requested-With') == 'XMLHttpRequest':
                    return {'status': 'error', 'message': 'File not found'}, 404
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
            is_owner = (file_rec.owner_id
                        and file_rec.owner_id == current_user.id)
            if not (is_owner or current_user.has('files.edit_any')
                    or current_user.has('files.mark_viewed')):
                # Return JSON error for AJAX requests
                if request.headers.get(
                        'Content-Type'
                ) == 'application/json' or request.headers.get(
                        'X-Requested-With') == 'XMLHttpRequest':
                    return {'status': 'error', 'message': 'Forbidden: insufficient permissions'}, 403
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
            # Diagnostics to investigate duplicate submissions/EOF
            try:
                req_id = request.headers.get('X-Recorder-Request-Id') or request.headers.get('X-Request-ID') or ''
                if not req_id:
                    try:
                        import uuid as _uuid
                        req_id = f'gen-{_uuid.uuid4()}'
                    except Exception:
                        req_id = 'gen-unknown'
                ua = request.headers.get('User-Agent', '')
                clen = request.content_length or -1
                _log.info(f"[rec-save] request:start id={req_id} ua=\"{ua}\" content_length={clen}")
            except Exception:
                pass
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
            # Ensure target directory tree exists (both generic and exact dir)
            try:
                make_dir(path.join(app._sql.config['files']['root'], 'files'),
                         root_folder, sub_folder)
            except Exception:
                pass
            try:
                os.makedirs(dir, exist_ok=True)
            except Exception:
                # If dir resolution failed, fall back to generic path
                try:
                    dir = path.join(app._sql.config['files']['root'], 'files',
                                    root_folder or '', sub_folder or '')
                    os.makedirs(dir, exist_ok=True)
                except Exception:
                    pass
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
            # Get original filename and extension from uploaded file
            original_filename = file_part.filename or ''
            original_ext = os.path.splitext(original_filename)[1] if original_filename else '.webm'
            # Use original extension if present, otherwise default to .webm
            source_ext = original_ext if original_ext else '.webm'
            source_path = fname + source_ext
            # Ensure final directory exists and writable before saving
            try:
                os.makedirs(path.dirname(fname), exist_ok=True)
                if not os.access(path.dirname(fname), os.W_OK):
                    raise PermissionError(f"Нет прав записи в каталог: {path.dirname(fname)}")
            except Exception as e:
                _log.error(f"[rec-save] cannot prepare directory: dir={path.dirname(fname)} err={e}")
                raise
            file_part.save(source_path)
            try:
                stat_sz = 0
                try:
                    stat_sz = os.stat(source_path).st_size
                except Exception:
                    pass
                _log.info(f"[rec-save] request:saved id={req_id} path=\"{source_path}\" size={stat_sz} original_filename=\"{original_filename}\"")
            except Exception:
                pass
            # Determine media type using media service (check for video stream presence)
            # Same approach as file upload: if no video stream, it's audio-only
            is_audio = media_service.is_audio_file(source_path)
            if not is_audio:
                _log.debug(f"[rec-save] Detected video file: {source_path}")
            else:
                _log.debug(f"[rec-save] Detected audio file: {source_path}")
            # Choose target extension based on detected media type
            if is_audio:
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
                    current_user.id,  # owner_id should be user ID, not the owner string
                    desc,
                    None,  # Let MySQL set created_at automatically with CURRENT_TIMESTAMP
                    0, 0, 0.0
                ])
            except Exception:
                return {"error": "Не удалось создать запись файла"}, 400
            _log.info(f"[rec-save] Starting conversion: id={id}, from={source_path}, to={convert_dst}, is_audio={is_audio}")
            media_service.convert_async(source_path, convert_dst,
                                        ('file', id))
            # Probe duration and size from saved source file and notify clients immediately
            try:
                # Size
                try:
                    stat = os.stat(source_path)
                    size_bytes = stat.st_size
                except Exception:
                    size_bytes = 0
                size_mb = round(size_bytes / (1024 * 1024), 1) if size_bytes else 0
                # Duration
                length_seconds = 0
                try:
                    p = subprocess.Popen([
                        "ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of",
                        "default=noprint_wrappers=1:nokey=1", source_path
                    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         universal_newlines=True)
                    sout, _ = p.communicate(timeout=10)
                    length_seconds = int(float((sout or '0').strip()) or 0)
                except Exception:
                    pass
                app._sql.file_update_metadata([length_seconds, size_mb, id])
                if socketio:
                    try:
                        origin = (request.headers.get('X-Client-Id') or '').strip()
                        emit_files_changed(app.socketio, 'metadata', id=id, originClientId=origin,
                                           meta={'length': length_seconds, 'size': size_mb})
                    except Exception:
                        pass
            except Exception:
                pass
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
            page_size = int(request.args.get('page_size', 10))
            if page < 1: page = 1
            if page_size < 1: page_size = 10
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
            # Compute force_can_manage for order files (same logic as in files())
            force_can_manage = False
            try:
                cat = app._sql.category_by_id([cat_id])
                sub = app._sql.subcategory_by_id([sub_id])
                if cat and sub:
                    cat_folder = getattr(cat, 'folder_name', '') or ''
                    sub_folder = getattr(sub, 'folder_name', '') or ''
                    if cat_folder == 'orders' and str(sub_folder).startswith('order-'):
                        order_id_str = str(sub_folder)[len('order-'):]
                        try:
                            order_id_val = int(order_id_str)
                            prefix = app._sql.config['db']['prefix']
                            row = app._sql.execute_query(
                                f'SELECT service, creator_gid FROM {prefix}_order WHERE id=%s',
                                [order_id_val]
                            )
                            if row:
                                service = row[0][0] if row[0][0] else ''
                                creator_gid = int(row[0][1]) if (row and row[0][1] is not None) else None
                                groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
                                service_gid = None
                                for gid, name in groups:
                                    if name == service:
                                        service_gid = int(gid)
                                        break
                                user_gid = int(getattr(current_user, 'gid', 0) or 0)
                                if (service_gid and user_gid == service_gid) or (creator_gid and user_gid == creator_gid):
                                    force_can_manage = True
                                elif current_user.has('admin.any') or current_user.has('orders.files_edit'):
                                    force_can_manage = True
                        except Exception:
                            pass
            except Exception:
                pass
            # Update exists status for all files and sort by date descending (newest first)
            # Also check order completion status for order files
            order_completion_cache = {}
            if fs:
                for file in fs:
                    try:
                        file.update_exists_status()
                        try:
                            app._sql.file_update_exists_status(file.id, file.exists)
                        except Exception:
                            pass
                        # Check if file belongs to a completed order
                        try:
                            if file.category_id and file.subcategory_id:
                                cat = app._sql.category_by_id([file.category_id])
                                sub = app._sql.subcategory_by_id([file.subcategory_id])
                                if cat and sub:
                                    cat_folder = getattr(cat, 'folder_name', '') or ''
                                    sub_folder = getattr(sub, 'folder_name', '') or ''
                                    if cat_folder == 'orders' and str(sub_folder).startswith('order-'):
                                        order_id_str = str(sub_folder)[len('order-'):]
                                        try:
                                            order_id_val = int(order_id_str)
                                            if order_id_val not in order_completion_cache:
                                                prefix = app._sql.config['db']['prefix']
                                                row = app._sql.execute_query(
                                                    f'SELECT status, finalized, approved FROM {prefix}_order WHERE id=%s',
                                                    [order_id_val]
                                                )
                                                if row:
                                                    order_status = (row[0][0] or '').strip().lower()
                                                    order_finalized = int(row[0][1]) if row[0][1] is not None else 0
                                                    order_approved = int(row[0][2]) if len(row[0]) > 2 and row[0][2] is not None else 0
                                                    order_completion_cache[order_id_val] = {
                                                        'completed': bool(order_finalized == 1),
                                                        'finalized': bool(order_finalized == 1),
                                                        'status_done': order_status in ('done', '1', 'completed'),
                                                        'approved': int(order_approved)
                                                    }
                                                else:
                                                    order_completion_cache[order_id_val] = {
                                                        'completed': False,
                                                        'finalized': False,
                                                        'status_done': False,
                                                        'approved': 0
                                                    }
                                            info = order_completion_cache.get(order_id_val, {})
                                            setattr(file, 'order_completed', bool(info.get('completed')))
                                            setattr(file, 'order_finalized', bool(info.get('finalized')))
                                            setattr(file, 'order_approved', int(info.get('approved', 0)))
                                        except Exception:
                                            setattr(file, 'order_completed', False)
                                            setattr(file, 'order_finalized', False)
                                    else:
                                        setattr(file, 'order_completed', False)
                                        setattr(file, 'order_finalized', False)
                                else:
                                    setattr(file, 'order_completed', False)
                                    setattr(file, 'order_finalized', False)
                            else:
                                setattr(file, 'order_completed', False)
                                setattr(file, 'order_finalized', False)
                        except Exception:
                            setattr(file, 'order_completed', False)
                            setattr(file, 'order_finalized', False)
                    except Exception:
                        pass
                # Robust timestamp extractor to ensure proper ordering
                def ts_of(file):
                    try:
                        v = getattr(file, 'created_at', None) or getattr(file, 'date', None) or getattr(file, 'created', None)
                        if v is None:
                            return 0.0
                        if isinstance(v, (int, float)):
                            return float(v)
                        try:
                            return float(v.timestamp())
                        except Exception:
                            pass
                        s = str(v)
                        from datetime import datetime
                        for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d.%m.%Y %H:%M:%S', '%d.%m.%Y'):
                            try:
                                return datetime.strptime(s, fmt).timestamp()
                            except Exception:
                                pass
                        try:
                            return datetime.fromisoformat(s).timestamp()
                        except Exception:
                            return 0.0
                    except Exception:
                        return 0.0
                try:
                    fs.sort(key=ts_of, reverse=True)
                except Exception:
                    pass
            total = len(fs or [])
            start = (page - 1) * page_size
            end = start + page_size
            files_slice = fs[start:end] if fs else []
            # Check if current user is admin or in admin group
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
                    pass
                return False
            
            is_admin_or_admin_group = current_user.has('admin.any') or _is_admin_group_member()
            
            try:
                html = render_template('components/files_rows.j2.html',
                                       files=files_slice,
                                       did=0,
                                       sdid=1,
                                       dirs=dirs,
                                       force_can_manage=force_can_manage,
                                       is_admin_or_admin_group=is_admin_or_admin_group)
            except Exception:
                html = ''
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
            try:
                _log.error(f"Files page error: {e}")
            except Exception:
                pass
            # Be resilient: do not break pagination callers
            page = int(request.args.get('page', 1) or 1)
            page_size = int(request.args.get('page_size', 15) or 15)
            return jsonify({
                'html': '',
                'total': 0,
                'page': page,
                'page_size': page_size
            }), 200

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
            page_size = int(request.args.get('page_size', 10))
            if page < 1: page = 1
            if page_size < 1: page_size = 10
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
                if q:
                    # Use DB-side search when query is non-empty
                    fs = []
                    # Try common call signatures for different deployments
                    try:
                        fs = app._sql.file_search_by_category_and_subcategory([q, cat_id, sub_id])
                    except Exception:
                        pass
                    if not fs:
                        try:
                            fs = app._sql.file_search_by_category_and_subcategory(q, cat_id, sub_id)
                        except Exception:
                            pass
                    if not fs:
                        try:
                            fs = app._sql.file_search_by_category_and_subcategory([cat_id, sub_id, q])
                        except Exception:
                            pass
                    if not fs:
                        try:
                            fs = app._sql.file_search_by_category_and_subcategory(cat_id, sub_id, q)
                        except Exception:
                            pass
                    if fs is None:
                        fs = []
                    # Fallback: if DB search returned nothing, fetch full list and filter in Python
                    if not fs:
                        try:
                            fs_full = app._sql.file_by_category_and_subcategory([cat_id, sub_id])
                        except Exception:
                            fs_full = []
                        fs = fs_full
                else:
                    # No query -> return full list for the category/subcategory
                    fs = app._sql.file_by_category_and_subcategory([cat_id, sub_id])
            except Exception:
                fs = []
            dirs = dirs_by_permission(app, 3, 'f')
            fs = fs or []
            if q:
                q_cf = q.casefold()

                def to_cf(val):
                    try:
                        return str(val or '').casefold()
                    except Exception:
                        return ''

                def getv(obj, *keys):
                    for k in keys:
                        try:
                            v = getattr(obj, k)
                            if v:
                                return v
                        except Exception:
                            pass
                        try:
                            # dict-like
                            v = obj.get(k)  # type: ignore
                            if v:
                                return v
                        except Exception:
                            pass
                    return ''

                def matches(file):
                    try:
                        name = getv(file, 'display_name', 'name', 'real_name')
                        desc = getv(file, 'description')
                        owner = getv(file, 'owner', 'creator', 'created_by', 'owner_name')
                        created_at = getv(file, 'created_at', 'date', 'created')
                        media_type = getv(file, 'media_type', 'type')
                        size_human = getv(file, 'size_human')
                        length_human = getv(file, 'length_human', 'duration_human')
                        size_mb = getv(file, 'size_mb', 'size')
                        note = getv(file, 'note', 'notes')
                        viewed = getv(file, 'viewed')

                        fields = (
                            to_cf(name), to_cf(desc), to_cf(owner), to_cf(created_at),
                            to_cf(media_type), to_cf(size_human), to_cf(length_human),
                            to_cf(size_mb), to_cf(note), to_cf(viewed),
                        )
                        # Partial containment against stringified fields
                        if any(q_cf in fld for fld in fields):
                            return True
                        # Fallback: stringify whole object
                        try:
                            return q_cf in to_cf(file)
                        except Exception:
                            return False
                    except Exception:
                        return False

                fs = [f for f in fs if matches(f)]
            # Sort files by date descending (newest first) using a safe timestamp
            if fs:
                def ts_of(file):
                    try:
                        v = getattr(file, 'created_at', None) or getattr(file, 'date', None) or getattr(file, 'created', None)
                        if v is None:
                            return 0.0
                        if isinstance(v, (int, float)):
                            return float(v)
                        try:
                            # datetime instance
                            return float(v.timestamp())
                        except Exception:
                            pass
                        # Try common string formats
                        s = str(v)
                        for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d.%m.%Y %H:%M:%S', '%d.%m.%Y'):
                            try:
                                return datetime.strptime(s, fmt).timestamp()
                            except Exception:
                                pass
                        try:
                            # ISO 8601
                            return datetime.fromisoformat(s).timestamp()
                        except Exception:
                            return 0.0
                    except Exception:
                        return 0.0
                try:
                    fs.sort(key=ts_of, reverse=True)
                except Exception:
                    pass
            # Compute force_can_manage for order files (same logic as in files())
            force_can_manage = False
            try:
                cat = app._sql.category_by_id([cat_id])
                sub = app._sql.subcategory_by_id([sub_id])
                if cat and sub:
                    cat_folder = getattr(cat, 'folder_name', '') or ''
                    sub_folder = getattr(sub, 'folder_name', '') or ''
                    if cat_folder == 'orders' and str(sub_folder).startswith('order-'):
                        order_id_str = str(sub_folder)[len('order-'):]
                        try:
                            order_id_val = int(order_id_str)
                            prefix = app._sql.config['db']['prefix']
                            row = app._sql.execute_query(
                                f'SELECT service, creator_gid FROM {prefix}_order WHERE id=%s',
                                [order_id_val]
                            )
                            if row:
                                service = row[0][0] if row[0][0] else ''
                                creator_gid = int(row[0][1]) if (row and row[0][1] is not None) else None
                                groups = app._sql.execute_query(f'SELECT id,name FROM {prefix}_group') or []
                                service_gid = None
                                for gid, name in groups:
                                    if name == service:
                                        service_gid = int(gid)
                                        break
                                user_gid = int(getattr(current_user, 'gid', 0) or 0)
                                if (service_gid and user_gid == service_gid) or (creator_gid and user_gid == creator_gid):
                                    force_can_manage = True
                                elif current_user.has('admin.any') or current_user.has('orders.files_edit'):
                                    force_can_manage = True
                        except Exception:
                            pass
            except Exception:
                pass
            total = len(fs)
            start = (page - 1) * page_size
            end = start + page_size
            files_slice = fs[start:end]
            html = render_template('components/files_rows.j2.html',
                                   files=files_slice,
                                   did=0,
                                   sdid=1,
                                   dirs=dirs,
                                   force_can_manage=force_can_manage)
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
            try:
                _log.error(f"Files search error: {e}")
            except Exception:
                pass
            # Be resilient: do not break callers; return empty successful response
            page = int(request.args.get('page', 1) or 1)
            page_size = int(request.args.get('page_size', 10) or 10)
            resp = make_response(jsonify({
                'html': '',
                'total': 0,
                'page': page,
                'page_size': page_size
            }))
            resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
            return resp

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
            can_start, active_uploads, max_parallel = can_start_new_upload(current_user.id)

            if not can_start:
                return jsonify({
                    'error':
                    f'Maximum parallel uploads limit reached ({active_uploads}/{max_parallel})',
                    'active_uploads': active_uploads,
                    'max_parallel': max_parallel
                }), 429

            # Create upload job
            upload_id = f"upload_{int(time.time() * 1000)}_{current_user.id}"
            base_url = request.url_root.rstrip('/')
            
            # Save cookies for internal requests
            cookies_dict = {}
            for cookie_name, cookie_value in request.cookies.items():
                cookies_dict[cookie_name] = cookie_value
            
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
                'base_url': base_url,
                'cookies': cookies_dict,  # Save cookies for internal requests
                'progress': 0,
                'ip': request.remote_addr or '',
                'uploaded_files': []  # Track uploaded files for potential cancellation
            }

            # Save upload job to Redis
            save_upload_job(upload_job)

            # Log detailed start information
            _log.info(f"Starting registrator import from {registrator_name}, {len(file_urls)} files")

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
            can_start, active_uploads, max_parallel = can_start_new_upload(current_user.id)

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

            # Mark job as cancelled and remove from active set immediately
            job_info['status'] = 'cancelled'
            job_info['cancelled_at'] = time.time()
            try:
                redis_client.set(job_key, json.dumps(job_info), ex=300)
            except Exception:
                pass
            # Remove from active uploads; also delete job key so workers see cancellation
            redis_client.srem('active_uploads', upload_id)
            try:
                redis_client.delete(job_key)
            except Exception:
                pass

            # Delete only partially uploaded files (not fully completed ones)
            deleted_files = []
            if 'uploaded_files' in job_info:
                # Get current progress to determine which files are partially uploaded
                current_file_index = job_info.get('current_file_index', 0)
                completed_files = job_info.get('completed_files', 0)
                
                for i, file_info in enumerate(job_info['uploaded_files']):
                    # Only delete files that were uploaded but not fully completed
                    # (i.e., files that are in uploaded_files but not in completed_files)
                    if i >= completed_files:
                        try:
                            # Delete from database
                            file_id = file_info.get('file_id')
                            if file_id:
                                try:
                                    app._sql.file_delete([int(file_id)])
                                except Exception:
                                    # Fallback signature without list (legacy)
                                    try:
                                        app._sql.file_delete(int(file_id))
                                    except Exception:
                                        pass
                                deleted_files.append(file_info.get('filename', 'unknown'))

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
                f'Upload cancelled. Deleted {len(deleted_files)} partially uploaded files.',
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
            active_uploads = get_active_upload_count(current_user.id)

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

    @app.route('/api/cleanup-inactive-uploads', methods=['POST'])
    @require_permissions(FILES_UPLOAD)
    def api_cleanup_inactive_uploads():
        """Clean up inactive upload jobs from Redis (alias for cleanup-uploads)."""
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
                                or (current_time - job_created) > 3600):  # 1 hour
                            upload_id = job.get('id', '')
                            if upload_id:
                                redis_client.srem('active_uploads', upload_id)
                            redis_client.delete(key)
                            cleaned_count += 1

            return jsonify({
                'status': 'success',
                'cleaned_count': cleaned_count,
                'message': f'Cleaned up {cleaned_count} inactive uploads'
            }), 200

        except Exception as e:
            _log.error(f"API cleanup inactive uploads error: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/mark-viewed', methods=['POST'])
    def api_mark_viewed():
        """Mark file as viewed by user."""
        try:
            if not current_user.is_authenticated:
                return jsonify({
                    'status': 'error',
                    'message': 'Not authenticated'
                }), 401

            data = request.get_json()
            if not data or 'file_id' not in data:
                return jsonify({
                    'status': 'error',
                    'message': 'Missing file_id'
                }), 400

            file_id = data['file_id']

            # Check if file exists and user has permission to view it
            try:
                file_obj = app._sql.file_by_id([file_id])
                if not file_obj:
                    return jsonify({
                        'status': 'error',
                        'message': 'File not found'
                    }), 404

                # Check permissions (user can view if they own the file or have admin permissions)
                can_view = (file_obj.owner_id == current_user.id
                            or has_permission(current_user, 'ADMIN_VIEW_PAGE'))

                if not can_view:
                    return jsonify({
                        'status': 'error',
                        'message': 'Permission denied'
                    }), 403

                # Update the file's viewed status (you might want to add a viewed_at field to the database)
                # For now, we'll just log the action
                log_action('FILE_VIEWED', current_user.name,
                           f'Viewed file: {file_obj.file_name}',
                           request.remote_addr)

                return jsonify({
                    'status': 'success',
                    'message': 'File marked as viewed',
                    'file_id': file_id
                }), 200

            except Exception as e:
                _log.error(f"Error marking file as viewed: {e}")
                return jsonify({
                    'status': 'error',
                    'message': 'Database error'
                }), 500

        except Exception as e:
            _log.error(f"API mark-viewed error: {e}")
            return jsonify({'status': 'error', 'message': 'Server error'}), 500


# Helper functions for background upload management
def get_active_upload_count(user_id=None):
    """Get count of active uploads from Redis for specific user."""
    try:
        import redis
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)

        # If no user_id provided, get from current user
        if user_id is None:
            from flask_login import current_user
            user_id = current_user.id if current_user.is_authenticated else None

        if not user_id:
            return 0

        # Use Redis set for active uploads tracking
        active_uploads_set = redis_client.smembers(
            'active_uploads')  # type: ignore
        if not active_uploads_set:
            return 0

        # Count active uploads for this specific user
        user_active_count = 0
        current_time = time.time()
        
        for upload_id in active_uploads_set:  # type: ignore
            upload_id = upload_id.decode('utf-8') if isinstance(
                upload_id, bytes) else upload_id  # type: ignore
            job_data = redis_client.get(f"upload_job:{upload_id}")

            if not job_data:
                redis_client.srem('active_uploads', upload_id)
                continue

            try:
                import json
                job = json.loads(job_data.decode('utf-8'))  # type: ignore
                job_status = job.get('status', 'unknown')
                job_created = job.get('created_at') or job.get('start_time') or 0
                job_user_id = job.get('user_id')

                # Clean up old or completed uploads
                if (job_status in ['completed', 'failed', 'cancelled']
                        or ((current_time - float(job_created)) > 7200)):
                    redis_client.srem('active_uploads', upload_id)
                    redis_client.delete(f"upload_job:{upload_id}")
                    continue

                # Count only running uploads for this user
                if job_user_id == user_id and job_status == 'running':
                    user_active_count += 1

            except Exception as e:
                _log.warning(f"Error processing upload {upload_id}: {e}")
                redis_client.srem('active_uploads', upload_id)
                continue

        return user_active_count

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
        
        _log.info(f"[redis] Saved upload job: id={upload_job['id']}, status={upload_job.get('status')}")

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
            _log.info(f"[redis] Upload job status changed: id={upload_id}, {old_status} -> {new_status}")
            if new_status == 'running':
                redis_client.sadd('active_uploads', upload_id)
            elif new_status in ['completed', 'failed', 'cancelled']:
                redis_client.srem('active_uploads', upload_id)

    except Exception as e:
        _log.error(f"Error updating upload job: {e}")


def can_start_new_upload(user_id=None):
    """Atomically check if we can start a new upload (respects max_parallel_uploads per user)."""
    try:
        import redis
        redis_client = redis.Redis(
            unix_socket_path='/var/run/redis/redis.sock',
            password='znf25!',
            db=0)

        # Get max parallel uploads from config (default to 3)
        from flask import current_app
            # Handle both dict and configparser.ConfigParser
        config = current_app._sql.config
        if hasattr(config, 'get'):  # ConfigParser
            max_parallel = int(config.get('files', 'max_parallel_uploads', fallback=3))

        # If no user_id provided, get from current user
        if user_id is None:
            from flask_login import current_user
            user_id = current_user.id if current_user.is_authenticated else None

        if not user_id:
            return False, 0, max_parallel

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
                    job_user_id = job.get('user_id')

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

        # Count active uploads for this specific user
        user_active_count = 0
        if active_uploads:
            for upload_id in active_uploads:
                upload_id = upload_id.decode('utf-8') if isinstance(
                    upload_id, bytes) else upload_id  # type: ignore
                job_data = redis_client.get(f"upload_job:{upload_id}")
                if job_data:
                    try:
                        import json
                        job = json.loads(job_data.decode('utf-8'))  # type: ignore
                        if job.get('user_id') == user_id and job.get('status') == 'running':
                            user_active_count += 1
                    except Exception:
                        continue

        return user_active_count < max_parallel, user_active_count, max_parallel

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
        completed_uploads = []  # Track completed uploads for cleanup

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
                        job_status = job.get('status', 'unknown')
                        job_created = job.get('created_at', 0)
                        current_time = time.time()
                        
                        # Check if upload is completed, failed, cancelled, or too old
                        if (job_status in ['completed', 'failed', 'cancelled'] or 
                            (current_time - job_created) > 3600):  # 1 hour timeout
                            completed_uploads.append(upload_id)
                        elif job_status == 'running':
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

        # Clean up completed uploads
        if completed_uploads:
            _log.info(f"Cleaning up {len(completed_uploads)} completed uploads")
            for upload_id in completed_uploads:
                redis_client.srem('active_uploads', upload_id)
                redis_client.delete(f"upload_job:{upload_id}")

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

            completed_files_count = 0  # Track actual completed files count
            for i, (file_url, file_name) in enumerate(
                    zip(upload_job['file_urls'], upload_job['file_names'])):
                # Check for shutdown signal
                if shutdown_flag.is_set():
                    _log.info(f"Shutdown signal received, stopping upload {upload_id}")
                    update_upload_job(upload_id, {
                        'status': 'cancelled',
                        'error': 'Server shutdown',
                        'end_time': time.time()
                    })
                    return
                # Respect external cancellation via Redis
                try:
                    job_state = get_upload_job(upload_id)
                except Exception:
                    job_state = None
                if job_state is None or job_state.get('status') == 'cancelled':
                    _log.info(f"Cancellation detected for {upload_id}, stopping before file {i+1}")
                    update_upload_job(upload_id, {
                        'status': 'cancelled',
                        'end_time': time.time()
                    })
                    return
                
                try:
                    # Update progress - mark file as started (don't update completed_files yet)
                    update_upload_job(
                        upload_id, {
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

                    _log.info(f"Starting download of {file_name} from {file_url}")

                    import time
                    start_time = time.time()

                    response = requests.get(file_url,
                                            timeout=300,
                                            verify=False,
                                            stream=True,
                                            headers=headers)

                    _log.info(
                        f"Download response status: {response.status_code}")


                    if response.status_code == 200:
                        # Download file directly to temporary file to avoid memory issues
                        import tempfile
                        import os
                        
                        content_length = int(
                            response.headers.get('content-length', 0))

                        _log.info(f"Starting to download {file_name}, content-length: {content_length}")


                        # Create temporary file
                        with tempfile.NamedTemporaryFile(delete=False, suffix='.tmp') as temp_file:
                            temp_file_path = temp_file.name
                            
                            download_start = time.time()
                            downloaded_size = 0
                            chunk_count = 0
                            last_logged_progress = -1
                            
                            # Stream directly to file to avoid memory consumption
                            # Using 8MB chunks optimized for 700MB/s network
                            chunk_size_bytes = 8388608  # 8MB chunks
                            
                            
                            for chunk in response.iter_content(chunk_size=chunk_size_bytes):
                                if chunk:
                                    temp_file.write(chunk)
                                    downloaded_size += len(chunk)
                                    chunk_count += 1
                                    # Mid-download cancellation check
                                    try:
                                        job_state = get_upload_job(upload_id)
                                    except Exception:
                                        job_state = None
                                    if job_state is None or job_state.get('status') == 'cancelled':
                                        _log.info(f"Cancellation detected during download for {upload_id}")
                                        raise Exception('cancelled')

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
                                                    'status': 'running'
                                                })
                                            last_logged_progress = progress

                        # Log download performance
                        download_time = time.time() - download_start
                        download_speed = (
                            downloaded_size / 1024 /
                            1024) / download_time if download_time > 0 else 0


                        # Upload file via HTTP but with optimized settings
                        # Now we stream from the already-downloaded file
                        
                        try:
                            upload_start_time = time.time()

                            # Use HTTP POST with streaming from file
                            with open(temp_file_path, 'rb') as f:
                                # Remove extension from filename for storage
                                base_filename = os.path.splitext(file_name)[0]
                                files = {
                                    'file': (file_name, f, 'application/octet-stream')
                                }
                                data = {
                                    'name': base_filename,  # Store without extension
                                    'description': f"[Регистратор - {upload_job['registrator_name']}]",
                                    'cat_id': str(upload_job['cat_id']),
                                    'sub_id': str(upload_job['sub_id'])
                                }

                                # Get current server URL dynamically
                                base_url = upload_job.get('base_url', 'https://localhost:8080')
                                upload_url = f"{base_url}/files/add?cat_id={upload_job['cat_id']}&sub_id={upload_job['sub_id']}"
                                
                                # Prepare cookies for internal request
                                cookies_dict = upload_job.get('cookies', {})
                                
                                # Pre-upload cancellation check
                                try:
                                    job_state = get_upload_job(upload_id)
                                except Exception:
                                    job_state = None
                                if job_state is None or job_state.get('status') == 'cancelled':
                                    _log.info(f"Cancellation detected before upload for {upload_id}")
                                    raise Exception('cancelled')

                                upload_response = requests.post(
                                    upload_url,
                                    files=files,
                                    data=data,
                                    cookies=cookies_dict,  # Use saved cookies for authentication
                                    timeout=300,
                                    headers={
                                        'Connection': 'keep-alive',  # Keep connection alive
                                        'X-Requested-With': 'XMLHttpRequest',  # Ensure JSON response
                                        'Accept': 'application/json'  # Request JSON response
                                    },
                                    verify=False  # Disable SSL verification for self-signed certificates
                                )
                        finally:
                            # Clean up temporary file
                            try:
                                os.unlink(temp_file_path)
                            except Exception:
                                pass

                        upload_time = time.time() - upload_start_time
                        _log.info(f"Upload completed in {upload_time:.2f}s")

                        if upload_response.status_code == 200:
                            _log.info(f"Successfully uploaded {file_name}")
                            
                            # Extract file ID from response
                            try:
                                response_data = upload_response.json()
                                uploaded_file_id = response_data.get('id')
                            except Exception as e:
                                uploaded_file_id = None
                                _log.error(f"Failed to parse response JSON: {e}")
                                _log.error(f"Response text: {upload_response.text[:200]}")
                            
                            # Update upload job with completed files count and uploaded file info
                            completed_files_count += 1  # Increment completed files count
                            update_data = {
                                'completed_files': completed_files_count,
                                'current_file_progress': 100
                            }
                            
                            # Add uploaded file info to track for potential cancellation
                            if uploaded_file_id:
                                # Get current uploaded_files list
                                try:
                                    job_data = get_upload_job(upload_id)
                                    uploaded_files = job_data.get('uploaded_files', []) if job_data else []
                                except Exception:
                                    uploaded_files = []
                                
                                uploaded_files.append({
                                    'file_id': uploaded_file_id,
                                    'filename': file_name,
                                    'file_path': None  # Will be fetched if needed
                                })
                                update_data['uploaded_files'] = uploaded_files
                            
                            update_upload_job(upload_id, update_data)
                        else:
                            _log.error(
                                f"Failed to upload {file_name}: {upload_response.status_code}"
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
            # Removed verbose performance summary logging

        except Exception as e:
            _log.error(f"Background upload error: {e}")
            update_upload_job(upload_job['id'], {
                'status': 'failed',
                'error': str(e),
                'end_time': time.time()
            })

    # Start background thread
    thread = threading.Thread(target=background_upload_worker, name=f"upload-{upload_job['id']}")
    thread.daemon = True
    
    # Register thread for cleanup
    active_upload_threads.append(thread)
    
    thread.start()
