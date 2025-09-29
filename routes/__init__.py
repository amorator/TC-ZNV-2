# Route modules aggregator

def register_all(app, tp, media_service):
	from . import users, requests, orders, files
	users.register(app)
	requests.register(app)
	orders.register(app, tp, media_service)
	files.register(app, media_service)


