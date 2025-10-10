# Route modules aggregator

def register_all(app, tp, media_service, socketio=None):
	from . import users, files, index, groups
	from . import push
	from . import admin
	from . import categories
	from . import registrators
	from . import wip

	# Ensure Flask secret key is loaded from DB (and generated if missing)
	try:
		if not getattr(app, 'secret_key', None):
			app.secret_key = app._sql.ensure_and_get_flask_secret_key()
	except Exception as e:
		app.logger.error(f"Failed to ensure Flask secret key: {e}")
	index.register(app)
	users.register(app)
	# requests and orders temporarily disabled
	# requests.register(app)
	# orders.register(app, tp, media_service)
	files.register(app, media_service, socketio)
	groups.register(app)
	push.register(app)
	admin.register(app, socketio)
	categories.register(app, socketio)
	registrators.register(app, socketio)
	wip.register(app)


