from flask import render_template


def register(app):
	@app.route('/wip')
	def wip():
		return render_template('error_pages/wip.j2.html')


