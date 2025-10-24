"""Middleware for request/response logging and access control."""

from flask import request, g
from flask_login import logout_user, current_user
from time import time
from datetime import timedelta
from modules.logging import log_access, get_logger

_log = get_logger(__name__)


def is_real_page(path):
    """Check if path is a real page (not API, static, or background request)."""
    if not path:
        return False
    
    # Filter out API endpoints, static files, and background requests
    excluded_prefixes = [
        '/api/', '/admin/presence', '/admin/sessions', '/admin/logs',
        '/static/', '/favicon.ico', '/_', '/presence/'
    ]
    
    excluded_paths = [
        '/admin/presence/redis', '/admin/sessions/redis',
        '/api/heartbeat', '/presence/heartbeat', '/sw.js'
    ]
    
    # Check prefixes
    for prefix in excluded_prefixes:
        if path.startswith(prefix):
            return False
    
    # Check exact paths
    if path in excluded_paths:
        return False
    
    return True


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
					
					# Also update Redis if available
					if hasattr(app, 'redis_client') and app.redis_client:
						try:
							import json
							session_data = {
								'sid': sid,
								'user_id': uid,
								'user': uname,
								'ip': ip,
								'ua': ua,
								'created_at': entry.get('created_at', now_ts),
								'last_activity': now_ts
							}
							app.redis_client.hset('sessions:active', sid, json.dumps(session_data))
							app.redis_client.expire('sessions:active', 1800)  # TTL 30 minutes
							
							# Also update presence for active users (only for real pages)
							# Filter out API endpoints, static files, and background requests
							path = request.path
							if is_real_page(path):
								
								user_key = f"{uname}|{ip}"
								presence_data = {
									'user': uname,
									'ip': ip,
									'ua': ua,
									'page': path,
									'lastSeen': int(now_ts * 1000)  # Convert to milliseconds
								}
								app.redis_client.hset('presence:users', user_key, json.dumps(presence_data))
								app.redis_client.expire('presence:users', 60)  # TTL 1 minute
						except Exception:
							pass
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
			# Temporarily disable Redis force-logout checks if flag set
			if getattr(app.config, 'get', lambda *_: False)('FORCE_LOGOUT_DISABLED') or app.config.get('FORCE_LOGOUT_DISABLED'):
				return
			is_auth_attr = getattr(current_user, 'is_authenticated', False)
			is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
			uid = getattr(current_user, 'id', None)
			cookie_name = getattr(app, 'session_cookie_name', 'session')
			sid = request.cookies.get(cookie_name) or request.cookies.get('session')
			
			# Check Redis-based force logout first
			force_logout = False
			if hasattr(app, 'force_logout_manager') and app.force_logout_manager:
				if is_authenticated and uid:
					if app.force_logout_manager.is_user_forced_logout(uid):
						force_logout = True
						app.force_logout_manager.remove_user_logout(uid)
				if sid and app.force_logout_manager.is_session_forced_logout(sid):
					force_logout = True
					app.force_logout_manager.remove_session_logout(sid)
			else:
				# Fallback to in-memory force logout
				if is_authenticated and (uid in getattr(app, '_force_logout_users', set()) or (sid and sid in getattr(app, '_force_logout_sessions', set()))):
					force_logout = True
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
			
			if force_logout:
				logout_user()
				g.force_logout = True
				# Also purge presence for this user
				if hasattr(app, 'presence_manager') and app.presence_manager and uid:
					app.presence_manager.remove_user_presence(uid)
				else:
					# Fallback to in-memory presence cleanup
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


