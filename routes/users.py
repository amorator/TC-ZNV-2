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
		return render_template('users.j2.html', id=4, users=app._sql.user_all(), groups=app._sql.group_all())

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
		try:
			name = request.form.get('name')
			login = request.form.get('login')
			# Case-insensitive uniqueness check (login or name)
			if app._sql.user_exists(login, name):
				raise Exception('Пользователь уже существует!')
			app._sql.user_add([login, name, app.hash(request.form.get('password')), request.form.get('group'), int(request.form.get('enabled') != None), request.form.get('permission')])
			log_action('USER_CREATE', current_user.name, f'created user {name} ({login})', request.remote_addr)
		except Exception as e:
			app.flash_error(e)
			log_action('USER_CREATE', current_user.name, f'failed to create user {name}: {str(e)}', request.remote_addr, success=False)
		finally:
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
		try:
			name = request.form.get('name')
			login = request.form.get('login')
			# Case-insensitive uniqueness excluding current id
			if app._sql.user_exists(login, name, id):
				raise Exception('Имя или логин занято другим пользователем!')
			app._sql.user_edit([login, name, request.form.get('group'), int(request.form.get('enabled') != None), request.form.get('permission'), id])
			log_action('USER_EDIT', current_user.name, f'edited user {name} ({login})', request.remote_addr)
		except Exception as e:
			app.flash_error(e)
			log_action('USER_EDIT', current_user.name, f'failed to edit user {name}: {str(e)}', request.remote_addr, success=False)
		finally:
			return redirect(url_for('users'))

	@app.route('/srs/reset/<id>', methods=['POST'])
	@require_permissions(USERS_MANAGE)
	def users_reset(id):
		"""Reset user password."""
		try:
			user = app._sql.user_by_id([id])
			app._sql.user_reset([app.hash(request.form.get('password')), id])
			log_action('USER_RESET', current_user.name, f'reset password for {user.name if user else "id="+str(id)}', request.remote_addr)
		except Exception as e:
			app.flash_error(e)
			log_action('USER_RESET', current_user.name, f'failed to reset password for id={id}: {str(e)}', request.remote_addr, success=False)
		finally:
			return redirect(url_for('users'))

	@app.route('/srs/toggle/<id>', methods=['GET'])
	@require_permissions(USERS_MANAGE)
	def users_toggle(id):
		"""Toggle user active flag; admin cannot be disabled."""
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
			app.flash_error(e)
			log_action('USER_TOGGLE', current_user.name, f'failed to toggle id={id}: {str(e)}', request.remote_addr, success=False)
		finally:
			return redirect(url_for('users'))

	@app.route('/srs/delete/<id>', methods=['POST'])
	@require_permissions(USERS_MANAGE)
	def users_delete(id):
		"""Delete a user; admin deletion is forbidden."""
		try:
			user = app._sql.user_by_id([id])
			if user and user.login and user.login.strip().lower() == 'admin':
				app.flash_error('Нельзя удалить администратора')
				return redirect(url_for('users'))
			app._sql.user_delete([id])
			log_action('USER_DELETE', current_user.name, f'deleted user {user.name} ({user.login})', request.remote_addr)
		except Exception as e:
			app.flash_error(e)
			log_action('USER_DELETE', current_user.name, f'failed to delete user: {str(e)}', request.remote_addr, success=False)
		finally:
			return redirect(url_for('users'))


