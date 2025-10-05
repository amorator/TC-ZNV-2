# Route modules aggregator

def register_all(app, tp, media_service, socketio=None):
	from . import users, requests, orders, files, index, groups
	index.register(app)
	users.register(app)
	requests.register(app)
	orders.register(app, tp, media_service)
	files.register(app, media_service, socketio)
	groups.register(app)


