from flask import render_template, url_for, request, redirect
from flask_login import current_user


def register(app):

	@app.route('/', methods=['GET'], endpoint='index')
	def index():
		"""Home page.

		- Redirect unauthenticated users to login
		- Render the index template otherwise
		"""
		if not current_user.is_authenticated:
			return redirect(url_for('login'))
		return render_template('index.j2.html')

	@app.route('/logs/actions', methods=['GET'])
	def logs_actions():
		"""Serve actions.log for admin page viewer (requires admin.view)."""
		from modules.permissions import has_permission, ADMIN_ANY, ADMIN_VIEW_PAGE
		from flask import abort, Response
		try:
			if not (has_permission(current_user, ADMIN_VIEW_PAGE) or has_permission(current_user, ADMIN_ANY)):
				return abort(403)
		except Exception:
			return abort(401)
		try:
			import os
			logs_path = os.path.join(app.root_path, 'logs', 'actions.log')
			if not os.path.exists(logs_path):
				return Response('', mimetype='text/plain; charset=utf-8')
			with open(logs_path, 'r', encoding='utf-8') as f:
				data = f.read()
			return Response(data, mimetype='text/plain; charset=utf-8')
		except Exception as e:
			return Response(str(e), status=500, mimetype='text/plain; charset=utf-8')


