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


