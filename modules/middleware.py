"""Middleware for request/response logging and access control."""

from flask import request, g
from flask_login import logout_user, current_user
from time import time
from modules.logging import log_access, get_logger

_log = get_logger(__name__)


def init_middleware(app):
	"""Initialize middleware for the Flask app."""
	
	@app.before_request
	def before_request():
		"""Log request start time."""
		g.start_time = time()
		# Enforce server-side force-logout if flagged by admin
		try:
			# Initialize storage
			if not hasattr(app, '_force_logout_users'):
				app._force_logout_users = set()
			# If current user is flagged, log out and mark for cookie removal
			is_auth_attr = getattr(current_user, 'is_authenticated', False)
			is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
			uid = getattr(current_user, 'id', None)
			if is_authenticated and uid in getattr(app, '_force_logout_users', set()):
				logout_user()
				g.force_logout = True
				# Clear the flag so that subsequent re-login is not immediately logged out again
				try:
					app._force_logout_users.discard(uid)
				except Exception:
					pass
		except Exception:
			pass
	
	@app.after_request
	def after_request(response):
		"""Log access after request completion."""
		try:
			# If force logout was requested, delete session cookies on response
			if getattr(g, 'force_logout', False):
				try:
					response.delete_cookie(app.session_cookie_name, path='/', samesite=app.config.get('SESSION_COOKIE_SAMESITE', 'Lax'))
					response.delete_cookie('session', path='/', samesite=app.config.get('SESSION_COOKIE_SAMESITE', 'Lax'))
					response.delete_cookie('remember_token', path='/', samesite=app.config.get('REMEMBER_COOKIE_SAMESITE', 'Lax'))
				except Exception:
					pass
			# Get request info
			method = request.method
			path = request.path
			status = response.status_code
			user = getattr(g, 'user', None)
			user_name = user.name if user and hasattr(user, 'name') else None
			ip = request.remote_addr
			user_agent = request.headers.get('User-Agent', '')
			duration = time() - g.start_time if hasattr(g, 'start_time') else None
			
			# Log access
			log_access(method, path, status, user_name, ip, user_agent, duration)
			
		except Exception as e:
			_log.exception("Error in access logging: %s", e)
		
		return response


