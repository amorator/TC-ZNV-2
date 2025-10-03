"""User management routes: list, add, edit, reset, toggle, delete.

All routes enforce permissions via `require_permissions`. Admin user (`login == 'admin'`)
is protected from modifications except password reset.
"""

from flask import render_template, url_for, request, redirect
from flask_login import login_user, logout_user, current_user
from modules.logging import get_logger, log_action
from modules.permissions import require_permissions, USERS_VIEW_PAGE, USERS_MANAGE

_log = get_logger(__name__)


def register(app):
	@app.route('/srs', methods=['GET'])
	@require_permissions(USERS_VIEW_PAGE)
	def users():
		"""Render users page with list and groups."""
		min_password_length = int(app._sql.config.get('web', 'min_password_length', fallback='1'))
		return render_template('users.j2.html', id=4, users=app._sql.user_all(), groups=app._sql.group_all(), min_password_length=min_password_length)

	@app.route('/srs/add', methods=['POST'])
	@require_permissions(USERS_MANAGE)
	def users_add():
		"""Create a new user. Login uniqueness is case-insensitive.

		Blocks creating `admin` account via UI.
		"""
		# Block creating admin user via UI
		if (request.form.get('login') or '').strip().lower() == 'admin':
			app.flash_error('Невозможно создать или переименовать пользователя admin через интерфейс')
			return redirect(url_for('users'))
		ok = True
		error_message = ''
		try:
			# Server-side validation with trimming
			name = (request.form.get('name') or '').strip()
			login = (request.form.get('login') or '').strip()
			password = request.form.get('password') or ''
			
			# Validate required fields
			if not name:
				raise Exception('Имя не может быть пустым')
			if not login:
				raise Exception('Логин не может быть пустым')
			if not password:
				raise Exception('Пароль не может быть пустым')
			
			# Get minimum password length from config
			min_password_length = int(app._sql.config.get('web', 'min_password_length', fallback='1'))
			if len(password) < min_password_length:
				raise Exception(f'Пароль должен быть не менее {min_password_length} символов')
			
			# Case-insensitive uniqueness check (login or name)
			if app._sql.user_exists(login, name):
				raise Exception('Пользователь уже существует!')
			
			app._sql.user_add([login, name, app.hash(password), request.form.get('group'), int(request.form.get('enabled') != None), request.form.get('permission')])
			log_action('USER_CREATE', current_user.name, f'created user {name} ({login})', request.remote_addr)
		except Exception as e:
			ok = False
			error_message = str(e)
			app.flash_error(e)
			log_action('USER_CREATE', current_user.name, f'failed to create user {name}: {str(e)}', request.remote_addr, success=False)
		finally:
			# notify sockets for soft refresh
			try:
				if hasattr(app, 'socketio') and app.socketio:
					app.socketio.emit('users:changed', {'reason': 'created'}, broadcast=True)
			except Exception:
				pass
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				if ok:
					return {'status': 'success', 'message': 'User created successfully'}, 200
				else:
					return {'status': 'error', 'message': error_message or 'Failed to create user'}, 400
			return redirect(url_for('users'))

	@app.route('/srs/edit/<id>', methods=['POST'])
	@require_permissions(USERS_MANAGE)
	def users_edit(id):
		"""Edit user fields and permissions (except admin restrictions)."""
		# Disallow editing admin except password reset
		user = app._sql.user_by_id([id])
		if user and user.login and user.login.strip().lower() == 'admin':
			app.flash_error('Разрешено только изменение пароля администратора')
			return redirect(url_for('users'))
		ok = True
		error_message = ''
		try:
			# Server-side validation with trimming
			name = (request.form.get('name') or '').strip()
			login = (request.form.get('login') or '').strip()
			# Preserve existing permission if not provided by form (permissions edited in separate modal)
			incoming_perm = (request.form.get('permission') or '').strip()
			permission_value = incoming_perm if incoming_perm != '' else (user.permission if user and getattr(user, 'permission', None) is not None else '')
			# Normalize permission to string for DB layer
			if isinstance(permission_value, list):
				try:
					permission_value = ','.join(permission_value)
				except Exception:
					permission_value = ''

			# If admin is present (any 'z' in any segment) or configured admin account,
			# normalize to full access legacy string including Files 'f'
			try:
				parts = (permission_value or '').split(',')
				while len(parts) < 4:
					parts.append('')
				is_admin_any = any(('z' in (seg or '')) for seg in parts) or getattr(current_user, 'is_config_admin', False)
				if is_admin_any:
					permission_value = 'aef,a,abcdflm,ab'
			except Exception:
				pass
			
			# Validate required fields
			if not name:
				raise Exception('Имя не может быть пустым')
			if not login:
				raise Exception('Логин не может быть пустым')
			
			# Case-insensitive uniqueness excluding current id
			if app._sql.user_exists(login, name, id):
				raise Exception('Имя или логин занято другим пользователем!')
			
			app._sql.user_edit([login, name, request.form.get('group'), int(request.form.get('enabled') != None), permission_value, id])
			log_action('USER_EDIT', current_user.name, f'edited user {name} ({login})', request.remote_addr)
		except Exception as e:
			ok = False
			error_message = str(e)
			app.flash_error(e)
			log_action('USER_EDIT', current_user.name, f'failed to edit user {name}: {str(e)}', request.remote_addr, success=False)
		finally:
			try:
				if hasattr(app, 'socketio') and app.socketio:
					app.socketio.emit('users:changed', {'reason': 'edited', 'id': id}, broadcast=True)
			except Exception:
				pass
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				if ok:
					return {'status': 'success', 'message': 'User updated successfully'}, 200
				else:
					return {'status': 'error', 'message': error_message or 'Failed to update user'}, 400
			return redirect(url_for('users'))

	@app.route('/srs/reset/<id>', methods=['POST'])
	@require_permissions(USERS_MANAGE)
	def users_reset(id):
		"""Reset user password."""
		ok = True
		error_message = ''
		try:
			# Server-side validation with trimming
			password = request.form.get('password') or ''
			
			# Validate required fields
			if not password:
				raise Exception('Пароль не может быть пустым')
			
			# Get minimum password length from config
			min_password_length = int(app._sql.config.get('web', 'min_password_length', fallback='1'))
			if len(password) < min_password_length:
				raise Exception(f'Пароль должен быть не менее {min_password_length} символов')
			
			user = app._sql.user_by_id([id])
			app._sql.user_reset([app.hash(password), id])
			log_action('USER_RESET', current_user.name, f'reset password for {user.name if user else "id="+str(id)}', request.remote_addr)
		except Exception as e:
			ok = False
			error_message = str(e)
			app.flash_error(e)
			log_action('USER_RESET', current_user.name, f'failed to reset password for id={id}: {str(e)}', request.remote_addr, success=False)
		finally:
			try:
				if hasattr(app, 'socketio') and app.socketio:
					app.socketio.emit('users:changed', {'reason': 'reset', 'id': id}, broadcast=True)
			except Exception:
				pass
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				if ok:
					return {'status': 'success', 'message': 'Password reset successfully'}, 200
				else:
					return {'status': 'error', 'message': error_message or 'Failed to reset password'}, 400
			return redirect(url_for('users'))

	@app.route('/srs/toggle/<id>', methods=['GET'])
	@require_permissions(USERS_MANAGE)
	def users_toggle(id):
		"""Toggle user active flag; admin cannot be disabled."""
		ok = True
		error_message = ''
		try:
			u = app._sql.user_by_id([id])
			if u and u.login and u.login.strip().lower() == 'admin':
				app.flash_error('Нельзя отключать администратора')
				log_action('USER_TOGGLE', current_user.name, 'attempted to disable admin (blocked)', request.remote_addr, success=False)
				return redirect(url_for('users'))
			old_enabled = 1 if u and u.is_enabled() else 0
			new_enabled = 1 - old_enabled
			app._sql.user_toggle([new_enabled, id])
			log_action('USER_TOGGLE', current_user.name, f'toggled {u.name if u else "id="+str(id)} enabled {old_enabled}->{new_enabled}', request.remote_addr)
		except Exception as e:
			ok = False
			error_message = str(e)
			app.flash_error(e)
			log_action('USER_TOGGLE', current_user.name, f'failed to toggle id={id}: {str(e)}', request.remote_addr, success=False)
		finally:
			try:
				if hasattr(app, 'socketio') and app.socketio:
					app.socketio.emit('users:changed', {'reason': 'toggled', 'id': id}, broadcast=True)
			except Exception:
				pass
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				if ok:
					return {'status': 'success', 'message': 'User status toggled successfully'}, 200
				else:
					return {'status': 'error', 'message': error_message or 'Failed to toggle user'}, 400
			return redirect(url_for('users'))

	@app.route('/srs/delete/<id>', methods=['POST'])
	@require_permissions(USERS_MANAGE)
	def users_delete(id):
		"""Delete a user; admin deletion is forbidden."""
		ok = True
		error_message = ''
		try:
			user = app._sql.user_by_id([id])
			if user and user.login and user.login.strip().lower() == 'admin':
				app.flash_error('Нельзя удалить администратора')
				return redirect(url_for('users'))
			app._sql.user_delete([id])
			log_action('USER_DELETE', current_user.name, f'deleted user {user.name} ({user.login})', request.remote_addr)
		except Exception as e:
			ok = False
			error_message = str(e)
			app.flash_error(e)
			log_action('USER_DELETE', current_user.name, f'failed to delete user: {str(e)}', request.remote_addr, success=False)
		finally:
			try:
				if hasattr(app, 'socketio') and app.socketio:
					app.socketio.emit('users:changed', {'reason': 'deleted', 'id': id}, broadcast=True)
			except Exception:
				pass
			# Return JSON for AJAX requests, redirect for traditional forms
			if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
				if ok:
					return {'status': 'success', 'message': 'User deleted successfully'}, 200
				else:
					return {'status': 'error', 'message': error_message or 'Failed to delete user'}, 400
			return redirect(url_for('users'))


