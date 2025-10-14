"""
Маршруты управления категориями и подкатегориями файлов.

Возможности:
- CRUD категорий и подкатегорий (папки неизменяемы при редактировании)
- Проверки бизнес-правил (запрет удаления/выключения при несоответствии условий)
- API для фронтенда (JSON, корректные коды ошибок для AJAX)
- Ограничение частоты разрушающих операций (rate limiting)
"""

from flask import render_template, request, jsonify, redirect, url_for, flash
from flask_login import login_required, current_user
from modules.logging import get_logger
from modules.permissions import require_permissions, CATEGORIES_VIEW, CATEGORIES_MANAGE, SUBCATEGORIES_VIEW, SUBCATEGORIES_MANAGE
import time
from functools import wraps
import os
import re

_log = get_logger(__name__)


def register(app, socketio=None):
	"""Регистрация маршрутов управления категориями/подкатегориями."""

	def _wants_json_response() -> bool:
		"""Определение, ожидает ли клиент JSON‑ответ (AJAX/fetch).

		Возвращает True, если заголовки/параметры запроса указывают на AJAX.
		"""
		try:
			xrw = request.headers.get('X-Requested-With', '').lower()
			if xrw in ('xmlhttprequest', 'fetch'):  # fetch/XMLHttpRequest
				return True
			accept = request.headers.get('Accept', '')
			if 'application/json' in (accept or '').lower():
				return True
			if request.args.get('ajax') == '1':
				return True
		except Exception:
			pass
		return False

	# Simple in-memory rate limiter (IP + endpoint, sliding window)
	_RATE_BUCKET = {}

	def rate_limit(max_calls: int = 20, window_sec: int = 60):
		"""Простейший декоратор ограничения частоты вызовов по IP+эндпоинту."""

		def decorator(fn):

			@wraps(fn)
			def wrapper(*args, **kwargs):
				try:
					key = (request.remote_addr or 'unknown', fn.__name__)
					now = time.time()
					bucket = _RATE_BUCKET.get(key, [])
					bucket = [t for t in bucket if now - t < window_sec]
					if len(bucket) >= max_calls:
						if _wants_json_response():
							return jsonify({
								'error':
								'Слишком много запросов, попробуйте позже'
							}), 429
						flash('Слишком много запросов, попробуйте позже',
							  'error')
						return redirect(url_for('categories_admin'))
					bucket.append(now)
					_RATE_BUCKET[key] = bucket
				except Exception:
					pass
				return fn(*args, **kwargs)

			return wrapper

		return decorator

	# Files root resolver with fallback
	def _files_root() -> str:
		"""Resolve files root from config, supporting dict and ConfigParser.

		Priority: app._sql.config['files']['root'] else <app.root_path>/files
		"""
		try:
			cfg = getattr(app, '_sql', None)
			conf = getattr(cfg, 'config', None)
			base = None
			if conf is not None:
				# Try dict-style first
				try:
					files = conf['files']  # type: ignore[index]
					base = str(files.get('root') or '').strip() or None
				except Exception:
					pass
				# Try ConfigParser-style
				if not base:
					try:
						base = str(conf.get(
							'files', 'root',
							fallback='')).strip()  # type: ignore[call-arg]
					except Exception:
						pass
			if base:
				return base if os.path.isabs(base) else os.path.abspath(base)
			# Original fallback (intentional): project-root files directory
			return os.path.join(app.root_path, 'files')
		except Exception:
			return os.path.join(app.root_path, 'files')

	# Startup directory initialization removed to avoid root-owned folders.

	@app.route('/categories')
	@login_required
	@require_permissions(CATEGORIES_VIEW)
	def categories_admin():
		"""Admin panel for managing categories and subcategories."""
		# Exclude system 'registrators' from visible categories
		categories = [
			c for c in app._sql.category_all()
			if (getattr(c, 'folder_name', '') or '').lower() != 'registrators'
		]
		subcategories = app._sql.subcategory_all()

		# Group subcategories by category
		subcategories_by_category = {}
		for subcat in subcategories:
			if subcat.category_id not in subcategories_by_category:
				subcategories_by_category[subcat.category_id] = []
			subcategories_by_category[subcat.category_id].append(subcat)

		# Capability flags for client-side UI gating
		try:
			can_cats_manage = current_user.has(CATEGORIES_MANAGE)
		except Exception:
			can_cats_manage = False
		try:
			can_subs_manage = current_user.has(SUBCATEGORIES_MANAGE)
		except Exception:
			can_subs_manage = False

		return render_template(
			'categories.j2.html',
			title='Категории — Заявки-Наряды-Файлы',
			categories=categories,
			subcategories_by_category=subcategories_by_category,
			can_cats_manage=can_cats_manage,
			can_subs_manage=can_subs_manage)

	# Provide a fallback '/admin' endpoint that redirects here if not already defined
	try:
		# Only register if not already present
		if 'admin' not in [r.endpoint for r in app.url_map.iter_rules()]:

			@app.route('/admin', methods=['GET'], endpoint='admin')
			@login_required
			@require_permissions(CATEGORIES_VIEW)
			def _admin_fallback():
				return redirect(url_for('categories_admin'))
	except Exception:
		pass

	@app.route('/categories/add', methods=['POST'])
	@login_required
	@require_permissions(CATEGORIES_MANAGE)
	@rate_limit(50, 60)
	def category_add():
		"""Добавить новую категорию."""
		try:
			log_action('CATEGORY_ADD_START', current_user.name,
					   'start add category', (request.remote_addr or ''))
			# Normalize display_name: trim and collapse internal spaces
			raw_display = request.form.get('display_name', '')
			display_name = ' '.join(raw_display.split())
			folder_name = (request.form.get('folder_name', '') or '').strip()
			# Validate folder_name by regex (letters, digits, dash, underscore only)
			# re already imported at top if needed; keep here if local scope required
			if folder_name and not re.fullmatch(r'[A-Za-z0-9_-]+',
												folder_name):
				if _wants_json_response():
					return jsonify({
						'error':
						'Имя папки может содержать только латинские буквы, цифры, дефис и подчёркивание'
					}), 400
				flash(
					'Имя папки может содержать только латинские буквы, цифры, дефис и подчёркивание',
					'error')
				return redirect(url_for('categories_admin'))
			display_order = int(request.form.get('display_order', 0))
			enabled = 1 if request.form.get('enabled') else 0

			if not display_name or not folder_name:
				if _wants_json_response():
					return jsonify({
						'error':
						'Название и имя папки не могут быть пустыми'
					}), 400
				flash('Название и имя папки не могут быть пустыми', 'error')
				return redirect(url_for('categories_admin'))

			# Case-insensitive uniqueness for display_name
			if app._sql.category_name_exists_ci([display_name]):
				if _wants_json_response():
					return jsonify({
						'error':
						'Категория с таким названием уже существует'
					}), 409
				flash(f'Категория с именем "{display_name}" уже существует',
					  'error')
				return redirect(url_for('categories_admin'))

			# Reserve system folder names and check uniqueness
			reserved = {'orders', 'requests', 'registrators'}
			if folder_name.lower() in reserved:
				if _wants_json_response():
					return jsonify(
						{'error': 'Системное имя папки зарезервировано'}), 409
				flash('Системное имя папки зарезервировано', 'error')
				return redirect(url_for('categories_admin'))
			# Check if folder name already exists
			if app._sql.category_exists([folder_name]):
				if _wants_json_response():
					return jsonify({
						'error':
						'Категория с таким именем папки уже существует'
					}), 409
				flash(
					f'Категория с именем папки "{folder_name}" уже существует',
					'error')
				return redirect(url_for('categories_admin'))

			new_id = app._sql.category_add(
				[display_name, folder_name, display_order, enabled])
			# Notify clients (files page, categories admin) to refresh
			try:
				if socketio:
					socketio.emit('categories:changed', {
						'reason': 'add',
						'category_id': new_id
					})
			except Exception:
				pass
			# Create directory on disk
			try:
				os.makedirs(os.path.join(_files_root(), 'files', folder_name),
							exist_ok=True)
			except Exception:
				pass
			if _wants_json_response():
				return jsonify({'success': True})
			flash(f'Категория "{display_name}" успешно добавлена', 'success')
			log_action('CATEGORY_ADD', current_user.name,
					   f'added category {display_name} ({folder_name})',
					   (request.remote_addr or ''))

		except Exception as e:
			_log.error(f"Error adding category: {e}")
			flash(f'Ошибка при добавлении категории: {e}', 'error')
			log_action('CATEGORY_ADD',
					   current_user.name,
					   f'failed add category: {str(e)}',
					   (request.remote_addr or ''),
					   success=False)

		return redirect(url_for('categories_admin'))

	@app.route('/categories/edit/<int:category_id>', methods=['POST'])
	@login_required
	@require_permissions(CATEGORIES_MANAGE)
	@rate_limit(80, 60)
	def category_edit(category_id):
		"""Изменить категорию (имя папки неизменно)."""
		try:
			log_action('CATEGORY_EDIT_START', current_user.name,
					   f'start edit category id={category_id}',
					   (request.remote_addr or ''))
			# Normalize display_name: trim and collapse internal spaces
			raw_display = request.form.get('display_name', '')
			display_name = ' '.join(raw_display.split())
			display_order = int(request.form.get('display_order', 0))
			enabled = 1 if request.form.get('enabled') else 0
			# Enforce immutability of folder_name
			existing = app._sql.category_by_id([category_id])
			if not existing:
				if _wants_json_response():
					return jsonify({'error': 'Категория не найдена'}), 404
				flash('Категория не найдена', 'error')
				return redirect(url_for('categories_admin'))

			if not display_name:
				if _wants_json_response():
					return jsonify({'error':
									'Название не может быть пустым'}), 400
				flash('Название не может быть пустым', 'error')
				return redirect(url_for('categories_admin'))

			# Case-insensitive uniqueness for display_name excluding current
			if app._sql.category_name_exists_except_ci(
				[display_name, category_id]):
				if _wants_json_response():
					return jsonify({
						'error':
						'Категория с таким названием уже существует'
					}), 409
				flash(f'Категория с именем "{display_name}" уже существует',
					  'error')
				return redirect(url_for('categories_admin'))

			# Keep original folder_name unchanged
			# For system category 'registrators' deny disabling
			if (existing.folder_name
					or '').lower() == 'registrators' and enabled == 0:
				if _wants_json_response():
					return jsonify({
						'error':
						'Системную категорию "Регистраторы" нельзя отключать'
					}), 409
				flash('Системную категорию "Регистраторы" нельзя отключать',
					  'error')
				return redirect(url_for('categories_admin'))
			# Prevent disabling category while it has enabled subcategories
			if enabled == 0:
				en_cnt = app._sql.subcategory_enabled_count_by_category(
					[category_id])
				if en_cnt > 0:
					if _wants_json_response():
						return jsonify({
							'error':
							'Нельзя выключить категорию: есть включенные подкатегории.'
						}), 409
					flash(
						'Нельзя выключить категорию: есть включенные подкатегории. Сначала выключите или переместите их.',
						'error')
					return redirect(url_for('categories_admin'))
			app._sql.category_edit([
				display_name, existing.folder_name, display_order, enabled,
				category_id
			])
			try:
				if socketio:
					socketio.emit('categories:changed', {
						'reason': 'edit',
						'category_id': category_id
					})
			except Exception:
				pass
			if _wants_json_response():
				return jsonify({'success': True})
			flash(f'Категория "{display_name}" успешно обновлена', 'success')
			log_action(
				'CATEGORY_EDIT', current_user.name,
				f'edited category id={category_id} name={display_name} enabled={enabled}',
				(request.remote_addr or ''))

		except Exception as e:
			_log.error(f"Error editing category {category_id}: {e}")
			flash(f'Ошибка при обновлении категории: {e}', 'error')
			log_action('CATEGORY_EDIT',
					   current_user.name,
					   f'failed edit category id={category_id}: {str(e)}',
					   (request.remote_addr or ''),
					   success=False)

		return redirect(url_for('categories_admin'))

	@app.route('/categories/delete/<int:category_id>', methods=['POST'])
	@login_required
	@require_permissions(CATEGORIES_MANAGE)
	@rate_limit(40, 60)
	def category_delete(category_id):
		"""Удалить категорию (если нет подкатегорий)."""
		try:
			log_action('CATEGORY_DELETE_START', current_user.name,
					   f'start delete category id={category_id}',
					   (request.remote_addr or ''))
			category = app._sql.category_by_id([category_id])
			if not category:
				if _wants_json_response():
					return jsonify({'error': 'Категория не найдена'}), 404
				flash('Категория не найдена', 'error')
				return redirect(url_for('categories_admin'))
			# For system category 'registrators' deny deletion
			if (category.folder_name or '').lower() == 'registrators':
				if _wants_json_response():
					return jsonify({
						'error':
						'Системную категорию "Регистраторы" нельзя удалять'
					}), 409
				flash('Системную категорию "Регистраторы" нельзя удалять',
					  'error')
				return redirect(url_for('categories_admin'))
			# Prevent deletion if category has subcategories
			sub_cnt = app._sql.subcategory_count_by_category([category_id])
			if sub_cnt > 0:
				if _wants_json_response():
					return jsonify({
						'error':
						'Нельзя удалить категорию: есть подкатегории'
					}), 409
				flash(
					'Нельзя удалить категорию: в ней есть подкатегории. Сначала удалите или перенесите подкатегории.',
					'error')
				return redirect(url_for('categories_admin'))

			app._sql.category_delete([category_id])
			try:
				if socketio:
					socketio.emit('categories:changed', {
						'reason': 'delete',
						'category_id': category_id
					})
			except Exception:
				pass
			if _wants_json_response():
				return jsonify({'success': True})
			flash(f'Категория "{category.display_name}" успешно удалена',
				  'success')
			log_action('CATEGORY_DELETE', current_user.name,
					   f'deleted category id={category_id}',
					   (request.remote_addr or ''))

		except Exception as e:
			_log.error(f"Error deleting category {category_id}: {e}")
			flash(f'Ошибка при удалении категории: {e}', 'error')
			log_action('CATEGORY_DELETE',
					   current_user.name,
					   f'failed delete category id={category_id}: {str(e)}',
					   (request.remote_addr or ''),
					   success=False)

		return redirect(url_for('categories_admin'))

	@app.route('/subcategories/add', methods=['POST'])
	@login_required
	@require_permissions(SUBCATEGORIES_MANAGE)
	@rate_limit(50, 60)
	def subcategory_add():
		"""Добавить новую подкатегорию."""
		try:
			log_action('SUBCATEGORY_ADD_START', current_user.name,
					   'start add subcategory', (request.remote_addr or ''))
			category_id = int(request.form.get('category_id', 0))
			# Normalize display_name and validate folder_name
			raw_display = request.form.get('display_name', '')
			display_name = ' '.join(raw_display.split())
			folder_name = (request.form.get('folder_name', '') or '').strip()
			# re already imported at top if needed; keep here if local scope required
			if folder_name and not re.fullmatch(r'[A-Za-z0-9_-]+',
												folder_name):
				if _wants_json_response():
					return jsonify({
						'error':
						'Имя папки может содержать только латинские буквы, цифры, дефис и подчёркивание'
					}), 400
				flash(
					'Имя папки может содержать только латинские буквы, цифры, дефис и подчёркивание',
					'error')
				return redirect(url_for('categories_admin'))
			display_order = int(request.form.get('display_order', 0))
			enabled = 1 if request.form.get('enabled') else 0

			if not display_name or not folder_name or not category_id:
				if _wants_json_response():
					return jsonify(
						{'error': 'Все поля обязательны для заполнения'}), 400
				flash('Все поля обязательны для заполнения', 'error')
				return redirect(url_for('categories_admin'))

			# Check if subcategory already exists in this category
			if app._sql.subcategory_exists([category_id, folder_name]):
				if _wants_json_response():
					return jsonify({
						'error':
						'Подкатегория с таким именем папки уже существует'
					}), 409
				flash(
					f'Подкатегория с именем папки "{folder_name}" уже существует в этой категории',
					'error')
				return redirect(url_for('categories_admin'))

			# Permissions are not provided by the form anymore.
			# Default: no access for all (will be configured later in UI tables)
			# Order: user_view_own, user_view_group, user_view_all,
			#		user_edit_own, user_edit_group, user_edit_all,
			#		user_delete_own, user_delete_group, user_delete_all,
			#		group_view_own, group_view_group, group_view_all,
			#		group_edit_own, group_edit_group, group_edit_all,
			#		group_delete_own, group_delete_group, group_delete_all
			permissions = [0] * 18

			# Insert only core fields; permissions default to 0 in DB schema
			args = [
				category_id, display_name, folder_name, display_order, enabled
			]
			new_id = app._sql.subcategory_add(args)
			try:
				if socketio:
					socketio.emit(
						'categories:changed', {
							'reason': 'sub-add',
							'subcategory_id': new_id,
							'category_id': category_id
						})
			except Exception:
				pass
			# Create directory on disk
			try:
				cat = app._sql.category_by_id([category_id])
				os.makedirs(os.path.join(_files_root(), 'files',
										 cat.folder_name, folder_name),
							exist_ok=True)
			except Exception:
				pass
			if _wants_json_response():
				return jsonify({'success': True})
			flash(f'Подкатегория "{display_name}" успешно добавлена',
				  'success')
			log_action(
				'SUBCATEGORY_ADD', current_user.name,
				f'added subcategory {display_name} ({folder_name}) for category {category_id}',
				(request.remote_addr or ''))

		except Exception as e:
			_log.error(f"Error adding subcategory: {e}")
			flash(f'Ошибка при добавлении подкатегории: {e}', 'error')
			log_action('SUBCATEGORY_ADD',
					   current_user.name,
					   f'failed add subcategory: {str(e)}',
					   (request.remote_addr or ''),
					   success=False)

		return redirect(url_for('categories_admin'))

	@app.route('/subcategories/edit/<int:subcategory_id>', methods=['POST'])
	@login_required
	@require_permissions(SUBCATEGORIES_MANAGE)
	@rate_limit(80, 60)
	def subcategory_edit(subcategory_id):
		"""Изменить подкатегорию (имя папки неизменно)."""
		try:
			log_action('SUBCATEGORY_EDIT_START', current_user.name,
					   f'start edit subcategory id={subcategory_id}',
					   (request.remote_addr or ''))
			category_id = int(request.form.get('category_id', 0))
			raw_display = request.form.get('display_name', '')
			display_name = ' '.join(raw_display.split())
			display_order = int(request.form.get('display_order', 0))
			enabled = 1 if request.form.get('enabled') else 0
			existing = app._sql.subcategory_by_id([subcategory_id])
			if not existing:
				if _wants_json_response():
					return jsonify({'error': 'Подкатегория не найдена'}), 404
				flash('Подкатегория не найдена', 'error')
				return redirect(url_for('categories_admin'))

			if not display_name or not category_id:
				if _wants_json_response():
					return jsonify(
						{'error': 'Все поля обязательны для заполнения'}), 400
				flash('Все поля обязательны для заполнения', 'error')
				return redirect(url_for('categories_admin'))

			# Keep original folder_name unchanged
			folder_name = existing.folder_name
			# Get permissions from form
			permissions = []
			for action in ['view', 'edit', 'delete']:
				for scope in ['own', 'group', 'all']:
					for entity in ['user', 'group']:
						field_name = f"{entity}_{action}_{scope}"
						permissions.append(
							1 if request.form.get(field_name) else 0)

			args = [
				category_id, display_name, folder_name, display_order, enabled
			] + permissions + [subcategory_id]
			app._sql.subcategory_edit(args)
			try:
				if socketio:
					socketio.emit(
						'categories:changed', {
							'reason': 'sub-edit',
							'subcategory_id': subcategory_id,
							'category_id': category_id
						})
			except Exception:
				pass
			if _wants_json_response():
				return jsonify({'success': True})
			flash(f'Подкатегория "{display_name}" успешно обновлена',
				  'success')
			log_action(
				'SUBCATEGORY_EDIT', current_user.name,
				f'edited subcategory id={subcategory_id} name={display_name} enabled={enabled}',
				(request.remote_addr or ''))

		except Exception as e:
			_log.error(f"Error editing subcategory {subcategory_id}: {e}")
			flash(f'Ошибка при обновлении подкатегории: {e}', 'error')
			log_action(
				'SUBCATEGORY_EDIT',
				current_user.name,
				f'failed edit subcategory id={subcategory_id}: {str(e)}',
				(request.remote_addr or ''),
				success=False)

		return redirect(url_for('categories_admin'))

	@app.route('/subcategories/delete/<int:subcategory_id>', methods=['POST'])
	@login_required
	@require_permissions(SUBCATEGORIES_MANAGE)
	@rate_limit(40, 60)
	def subcategory_delete(subcategory_id):
		"""Удалить подкатегорию (если нет файлов)."""
		try:
			log_action('SUBCATEGORY_DELETE_START', current_user.name,
					   f'start delete subcategory id={subcategory_id}',
					   (request.remote_addr or ''))
			subcategory = app._sql.subcategory_by_id([subcategory_id])
			if not subcategory:
				if _wants_json_response():
					return jsonify({'error': 'Подкатегория не найдена'}), 404
				flash('Подкатегория не найдена', 'error')
				return redirect(url_for('categories_admin'))
			# Prevent deletion if subcategory has files
			files_cnt = app._sql.files_count_in_subcategory([subcategory_id])
			if files_cnt > 0:
				if _wants_json_response():
					return jsonify({
						'error':
						'Нельзя удалить подкатегорию: в ней есть файлы'
					}), 409
				flash(
					'Нельзя удалить подкатегорию: в ней есть файлы. Сначала удалите или перенесите файлы.',
					'error')
				return redirect(url_for('categories_admin'))

			app._sql.subcategory_delete([subcategory_id])
			try:
				if socketio:
					socketio.emit('categories:changed', {
						'reason': 'sub-delete',
						'subcategory_id': subcategory_id
					})
			except Exception:
				pass
			if _wants_json_response():
				return jsonify({'success': True})
			flash(f'Подкатегория "{subcategory.display_name}" успешно удалена',
				  'success')
			log_action('SUBCATEGORY_DELETE', current_user.name,
					   f'deleted subcategory id={subcategory_id}',
					   (request.remote_addr or ''))

		except Exception as e:
			_log.error(f"Error deleting subcategory {subcategory_id}: {e}")
			flash(f'Ошибка при удалении подкатегории: {e}', 'error')
			log_action(
				'SUBCATEGORY_DELETE',
				current_user.name,
				f'failed delete subcategory id={subcategory_id}: {str(e)}',
				(request.remote_addr or ''),
				success=False)

		return redirect(url_for('categories_admin'))

	@app.route('/api/categories')
	@login_required
	@require_permissions(CATEGORIES_VIEW)
	def api_categories():
		"""API: список категорий (JSON)."""
		categories = [
			c for c in app._sql.category_all()
			if (getattr(c, 'folder_name', '') or '').lower() != 'registrators'
		]
		return jsonify([{
			'id': cat.id,
			'display_name': cat.display_name,
			'folder_name': cat.folder_name,
			'display_order': cat.display_order,
			'enabled': cat.enabled
		} for cat in categories])

	@app.route('/api/category/<int:category_id>/stats')
	@login_required
	@require_permissions(CATEGORIES_VIEW)
	def api_category_stats(category_id):
		"""API: статистика по категории (кол-во подкатегорий)."""
		try:
			sub_cnt = app._sql.subcategory_count_by_category([category_id])
			return jsonify({'subcategory_count': int(sub_cnt)})
		except Exception as e:
			_log.error(f"category stats failed: {e}")
			return jsonify({'subcategory_count': 0}), 200

	@app.route('/api/subcategories/<int:category_id>')
	@login_required
	@require_permissions(SUBCATEGORIES_VIEW)
	def api_subcategories(category_id):
		"""API: список подкатегорий категории (JSON)."""
		subcategories = app._sql.subcategory_by_category([category_id])
		return jsonify([{
			'id': subcat.id,
			'category_id': subcat.category_id,
			'display_name': subcat.display_name,
			'folder_name': subcat.folder_name,
			'display_order': subcat.display_order,
			'enabled': subcat.enabled,
			'permissions': {
				'user': subcat.get_user_permissions(),
				'group': subcat.get_group_permissions()
			}
		} for subcat in subcategories])

	@app.route('/api/groups')
	@login_required
	@require_permissions(SUBCATEGORIES_VIEW)
	def api_groups():
		"""API: список групп с пагинацией и поиском.

		Query params:
		  - page: 1-based page number (default 1)
		  - page_size: items per page (default 5)
		  - q: optional search query (case-insensitive in name/description)
		"""
		try:
			page = max(1, int(request.args.get('page', 1)))
			page_size = max(1, min(100, int(request.args.get('page_size', 5))))
		except Exception:
			page, page_size = 1, 5
		query = (request.args.get('q') or '').strip()
		offset = (page - 1) * page_size
		prefix = app._sql.config['db']['prefix']
		params = []
		where = ''
		if query:
			where = 'WHERE LOWER(name) LIKE LOWER(%s) OR LOWER(COALESCE(description, "")) LIKE LOWER(%s)'
			like = f"%{query}%"
			params.extend([like, like])
		total_row = app._sql.execute_scalar(
			f"SELECT COUNT(1) FROM {prefix}_group {where};", params)
		total = int(total_row[0]) if total_row else 0
		data = app._sql.execute_query(
			f"SELECT id, name, description FROM {prefix}_group {where} ORDER BY name LIMIT %s OFFSET %s;",
			params + [page_size, offset])
		total_pages = max(1, (total + page_size - 1) // page_size)
		return jsonify({
			'items': [{
				'id': d[0],
				'name': d[1],
				'description': d[2]
			} for d in data],
			'page':
			page,
			'page_size':
			page_size,
			'total':
			total,
			'total_pages':
			total_pages
		})

	@app.route('/api/users')
	@login_required
	@require_permissions(SUBCATEGORIES_VIEW)
	def api_users():
		"""API: список пользователей с пагинацией и поиском.

		Query params:
		  - page: 1-based page number (default 1)
		  - page_size: items per page (default 5)
		  - q: optional search query (case-insensitive in login/name)
		"""
		try:
			page = max(1, int(request.args.get('page', 1)))
			page_size = max(1, min(100, int(request.args.get('page_size', 5))))
		except Exception:
			page, page_size = 1, 5
		query = (request.args.get('q') or '').strip()
		offset = (page - 1) * page_size
		prefix = app._sql.config['db']['prefix']
		params = []
		where = ''
		if query:
			where = 'WHERE LOWER(login) LIKE LOWER(%s) OR LOWER(name) LIKE LOWER(%s)'
			like = f"%{query}%"
			params.extend([like, like])
		total_row = app._sql.execute_scalar(
			f"SELECT COUNT(1) FROM {prefix}_user {where};", params)
		total = int(total_row[0]) if total_row else 0
		rows = app._sql.execute_query(
			f"SELECT id, login, name, enabled, permission FROM {prefix}_user {where} ORDER BY name LIMIT %s OFFSET %s;",
			params + [page_size, offset])
		total_pages = max(1, (total + page_size - 1) // page_size)
		return jsonify({
			'items': [{
				'id': r[0],
				'login': r[1],
				'name': r[2],
				'enabled': r[3],
				'permission': r[4]
			} for r in rows],
			'page':
			page,
			'page_size':
			page_size,
			'total':
			total,
			'total_pages':
			total_pages
		})

	@app.route('/api/subcategory/<int:subcategory_id>/permissions')
	@login_required
	@require_permissions(SUBCATEGORIES_VIEW)
	def api_subcategory_permissions(subcategory_id):
		"""API: получить права подкатегории (JSON)."""
		try:
			subcategory = app._sql.subcategory_by_id([subcategory_id])
		except Exception as e:
			# Fallback for older schemas missing permission columns
			_log.warning(
				f"Falling back to basic subcategory fetch for id={subcategory_id}: {e}"
			)
			subcategory = app._sql.subcategory_basic_by_id([subcategory_id])
		if not subcategory:
			return jsonify({'error': 'Subcategory not found'}), 404
		# If permissions attributes are absent (older schema), default to zeros
		try:
			user_perms = subcategory.get_user_permissions()
			group_perms = subcategory.get_group_permissions()
		except Exception:
			user_perms = {
				'view_own': 0,
				'view_group': 0,
				'view_all': 0,
				'edit_own': 0,
				'edit_group': 0,
				'edit_all': 0,
				'delete_own': 0,
				'delete_group': 0,
				'delete_all': 0,
			}
			group_perms = {
				'view_own': 0,
				'view_group': 0,
				'view_all': 0,
				'edit_own': 0,
				'edit_group': 0,
				'edit_all': 0,
				'delete_own': 0,
				'delete_group': 0,
				'delete_all': 0,
			}
		# Enforce admin group Upload=1 in response
		try:
			admin_group_name = (app.config.get('admin', {}).get('group')
								or 'Программисты').strip().lower()
			group_name = (getattr(subcategory, 'group_name', '')
						  or '').strip().lower()
		except Exception:
			admin_group_name = 'программисты'
			group_name = ''
		# If this subcategory response is per subcategory, we cannot infer specific group rows here.
		# Instead, mark that admin group must have upload=1 at client: provide a hint flag.
		group_perms['upload_admin_enforced'] = 1
		return jsonify({
			'id': subcategory.id,
			'display_name': subcategory.display_name,
			'permissions': {
				'user': user_perms,
				'group': group_perms
			}
		})

	@app.route('/api/subcategory/<int:subcategory_id>/stats')
	@login_required
	@require_permissions(SUBCATEGORIES_VIEW)
	def api_subcategory_stats(subcategory_id):
		"""API: статистика по подкатегории (кол-во файлов по префиксу пути)."""
		try:
			files_cnt = app._sql.files_count_in_subcategory([subcategory_id])
			return jsonify({'files_count': int(files_cnt)})
		except Exception as e:
			_log.error(f"subcategory stats failed: {e}")
			return jsonify({'files_count': 0}), 200

	@app.route('/api/subcategory/<int:subcategory_id>/permissions',
			   methods=['POST'])
	@login_required
	@require_permissions(SUBCATEGORIES_MANAGE)
	def api_update_subcategory_permissions(subcategory_id):
		"""API: обновить права подкатегории (JSON)."""
		try:
			data = request.get_json()
			permissions = data.get('permissions', {}) or {}

			# Get current subcategory
			subcategory = app._sql.subcategory_by_id([subcategory_id])
			if not subcategory:
				return jsonify({'error': 'Subcategory not found'}), 404

			# Normalize nested or flat permission payloads to flat booleans in canonical order
			def get_perm(entity: str, action: str, scope: str) -> int:
				# Support nested structure: { user: {view_own: 1/true}, group: {...} }
				nested = permissions.get(entity)
				if isinstance(nested, dict):
					val = nested.get(f"{action}_{scope}")
					return 1 if (val is True or val == 1 or val == '1') else 0
				# Also support flat keys: { 'user_view_own': 1 }
				flat = permissions.get(f"{entity}_{action}_{scope}")
				return 1 if (flat is True or flat == 1 or flat == '1') else 0

			perms = []
			for action in ['view', 'edit', 'delete']:
				for scope in ['own', 'group', 'all']:
					# user first, then group to match SQL order defined in SQLUtils._SUBCATEGORY_SELECT_FIELDS
					perms.append(get_perm('user', action, scope))
					perms.append(get_perm('group', action, scope))
			# Append upload flags (binary): user_upload, group_upload
			def get_upload(entity: str) -> int:
				nested = permissions.get(entity)
				if isinstance(nested, dict):
					val = nested.get('upload')
					return 1 if (val is True or val == 1 or val == '1') else 0
				flat = permissions.get(f"{entity}_upload")
				return 1 if (flat is True or flat == 1 or flat == '1') else 0

			user_upload = get_upload('user')
			group_upload = get_upload('group')
			# Enforce admin group Upload=1 regardless of input
			try:
				admin_group_name = (app.config.get('admin', {}).get('group')
									or 'Программисты').strip().lower()
				# If payload contains group-specific overrides list, map them; otherwise rely on single flag
				# Here we only have a single binary for the whole group set; enforce to 1
				group_upload = 1
			except Exception:
				pass
			# Enforce global config: if uploads effectively disabled, force 0
			try:
				cfg = getattr(app, '_sql', None)
				conf = getattr(cfg, 'config', None)
				files = (conf.get('files') or {}) if conf else {}
				max_upload_files = files.get('max_upload_files', '0')
				uploads_enabled = False
				try:
					uploads_enabled = int(
						str(max_upload_files).strip() or '0') > 0
				except Exception:
					uploads_enabled = False
				if not uploads_enabled:
					user_upload = 0
					group_upload = 0
			except Exception:
				pass
			perms.append(user_upload)
			perms.append(group_upload)

			# Update subcategory with new permissions
			args = [
				subcategory.category_id, subcategory.display_name,
				subcategory.folder_name, subcategory.display_order,
				subcategory.enabled
			] + perms + [subcategory_id]

			app._sql.subcategory_edit(args)
			# Notify others via socket for soft refresh
			try:
				if socketio:
					socketio.emit('subcategory_permissions_updated',
								  {'subcategory_id': subcategory_id},
								  broadcast=True)
			except Exception as se:
				_log.error(f"Socket emit failed: {se}")
			return jsonify({'success': True})

		except Exception as e:
			_log.error(f"Error updating subcategory permissions: {e}")
			return jsonify({'error': str(e)}), 500
