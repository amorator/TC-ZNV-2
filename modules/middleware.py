"""Middleware for request/response logging and access control."""

from flask import request, g
from flask_login import logout_user, current_user
from time import time
from datetime import timedelta
from modules.logging import log_access, get_logger

_log = get_logger(__name__)


def init_middleware(app):
	"""Initialize middleware for the Flask app."""
	
	@app.before_request
	def before_request():
		"""Log request start time."""
		g.start_time = time()
		# Initialize in-memory stores and track active sessions
		try:
			if not hasattr(app, '_force_logout_users'):
				app._force_logout_users = set()
			if not hasattr(app, '_force_logout_sessions'):
				app._force_logout_sessions = set()
			if not hasattr(app, '_sessions'):
				app._sessions = {}
			# Track current session as active (best-effort)
			is_auth_attr = getattr(current_user, 'is_authenticated', False)
			is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
			if is_authenticated:
				cookie_name = getattr(app, 'session_cookie_name', 'session')
				sid = request.cookies.get(cookie_name) or request.cookies.get('session')
				if sid:
					uid = getattr(current_user, 'id', None)
					uname = getattr(current_user, 'name', None)
					ip = request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr
					ua = request.headers.get('User-Agent', '')
					now_ts = time()
					entry = app._sessions.get(sid) or {}
					if not entry:
						entry = {'created_at': now_ts}
					entry.update({'user_id': uid, 'user': uname, 'ip': ip, 'ua': ua, 'last_seen': now_ts})
					app._sessions[sid] = entry
					# prune expired sessions by lifetime
					try:
						lifetime = app.config.get('PERMANENT_SESSION_LIFETIME')
						if isinstance(lifetime, timedelta):
							max_age = int(lifetime.total_seconds())
						else:
							max_age = int(lifetime or 31*24*3600)
					except Exception:
						max_age = 31*24*3600
					cutoff = time() - max_age
					for k, v in list(getattr(app, '_sessions', {}).items()):
						try:
							if float(v.get('last_seen') or 0) < cutoff:
								app._sessions.pop(k, None)
						except Exception:
							pass
		except Exception:
			pass
		# Enforce server-side force-logout if flagged by admin (by user or session)
		try:
			is_auth_attr = getattr(current_user, 'is_authenticated', False)
			is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
			uid = getattr(current_user, 'id', None)
			cookie_name = getattr(app, 'session_cookie_name', 'session')
			sid = request.cookies.get(cookie_name) or request.cookies.get('session')
			if is_authenticated and (uid in getattr(app, '_force_logout_users', set()) or (sid and sid in getattr(app, '_force_logout_sessions', set()))):
				logout_user()
				g.force_logout = True
				# Clear the flag so that subsequent re-login is not immediately logged out again
				try:
					app._force_logout_users.discard(uid)
				except Exception:
					pass
				try:
					if sid:
						app._force_logout_sessions.discard(sid)
						if hasattr(app, '_sessions'):
							app._sessions.pop(sid, None)
				except Exception:
					pass
				# Also purge presence and HB for this user to avoid stale rows across the app
				try:
					presence = getattr(app, '_presence', {}) or {}
					for psid, info in list(presence.items()):
						try:
							if int(info.get('user_id') or -1) == int(uid or -2):
								app._presence.pop(psid, None)
						except Exception:
							pass
					presence_hb = getattr(app, '_presence_hb', {}) or {}
					prefix = f"hb:{uid}:"
					for key in list(presence_hb.keys()):
						if isinstance(key, str) and key.startswith(prefix):
							app._presence_hb.pop(key, None)
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


