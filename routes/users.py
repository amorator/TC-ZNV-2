from flask import render_template, url_for, request, redirect
from flask_login import login_user, logout_user, current_user
from modules.logging import get_logger, log_action

_log = get_logger(__name__)


def register(app):
	@app.route('/srs', methods=['GET'])
	@app.permission_required(4)
	def users():
		return render_template('users.j2.html', id=4, users=app._sql.user_all(), groups=app._sql.group_all())

	@app.route('/srs/add', methods=['POST'])
	@app.permission_required(4, 'z')
	def users_add():
		try:
			name = request.form.get('name')
			login = request.form.get('login')
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
	@app.permission_required(4, 'z')
	def users_edit(id):
		try:
			name = request.form.get('name')
			login = request.form.get('login')
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
	@app.permission_required(4, 'z')
	def users_reset(id):
		try:
			app._sql.user_reset([app.hash(request.form.get('password')), id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('users'))

	@app.route('/srs/toggle/<id>', methods=['GET'])
	@app.permission_required(4, 'z')
	def users_toggle(id):
		try:
			app._sql.user_toggle([1 - app._sql.user_by_id([id]).is_enabled(), id])
		except Exception as e:
			app.flash_error(e)
		finally:
			return redirect(url_for('users'))

	@app.route('/srs/delete/<id>', methods=['POST'])
	@app.permission_required(4, 'z')
	def users_delete(id):
		try:
			user = app._sql.user_by_id([id])
			app._sql.user_delete([id])
			log_action('USER_DELETE', current_user.name, f'deleted user {user.name} ({user.login})', request.remote_addr)
		except Exception as e:
			app.flash_error(e)
			log_action('USER_DELETE', current_user.name, f'failed to delete user: {str(e)}', request.remote_addr, success=False)
		finally:
			return redirect(url_for('users'))


