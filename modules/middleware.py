"""Middleware for request/response logging and access control."""

from flask import request, g, session as _flask_session
from flask_login import logout_user, current_user
from time import time
from datetime import timedelta
from modules.logging import log_access, get_logger
import json

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
				cookie_name = app.config.get('SESSION_COOKIE_NAME', 'session')
				sid = request.cookies.get(cookie_name) or request.cookies.get('session')
				# Prefer cookie SID; fallback to Flask-Session SID when cookie missing
				if not sid:
					try:
						sid = getattr(_flask_session, 'sid', None)
					except Exception:
						sid = None
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

							# New: precise cookie-session tracking with TTL and index
							try:
								# Resolve configured lifetime (seconds)
								lifetime_s = 1800
								try:
									from datetime import timedelta
									cfg_life = app.config.get('PERMANENT_SESSION_LIFETIME')
									if isinstance(cfg_life, timedelta):
										lifetime_s = int(cfg_life.total_seconds())
									else:
										lifetime_s = int(cfg_life or 1800)
								except Exception:
									# fallback to config.ini if present
									try:
										lifetime_s = int(app._sql.config.get('web', 'session_lifetime', fallback='1800'))
									except Exception:
										lifetime_s = 1800

								# Store metadata per cookie session
								meta_key = f"sessions:cookie:{sid}"
								app.redis_client.hset(meta_key, mapping={
									'sid': sid,
									'user_id': uid or '',
									'user': uname or '',
									'ip': ip or '',
									'ua': ua or '',
									'created_at': str(int(entry.get('created_at', now_ts))),
									'last_seen': str(int(now_ts))
								})
								app.redis_client.expire(meta_key, lifetime_s)
								# TTL beacon key to read remaining lifetime accurately
								beacon_key = f"sessions:cookie:ttl:{sid}"
								app.redis_client.set(beacon_key, '1', ex=lifetime_s)
								# Index of active cookie sessions
								app.redis_client.sadd('sessions:cookie:index', sid)
							except Exception:
								pass
							
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
					# prune expired sessions by lifetime (not more than once per minute)
					now_ts = time()
					last_cleanup = getattr(app, '_last_session_cleanup', 0)
					if now_ts - last_cleanup > 60:  # Clean up at most once per minute
						app._last_session_cleanup = now_ts
						
						# Get session lifetime from config.ini
						lifetime = app._sql.config.get('web', 'session_lifetime', fallback='86400')
						max_age = int(lifetime)
						cutoff = now_ts - max_age
						
						# Clean up in-memory sessions
						for k, v in list(getattr(app, '_sessions', {}).items()):
							if float(v.get('last_seen', 0)) < cutoff:
								app._sessions.pop(k, None)
						
						# Clean up Redis sessions and presence
						if hasattr(app, 'redis_client') and app.redis_client:
							# Get all sessions from Redis
							sessions_data = app.redis_client.hgetall('sessions:active')
							for sid, session_json in sessions_data.items():
								try:
									session_data = json.loads(session_json)
									last_seen = float(session_data.get('last_seen', 0))
									if last_seen < cutoff:
										app.redis_client.hdel('sessions:active', sid)
								except Exception:
									# If session data is corrupted, remove it
									app.redis_client.hdel('sessions:active', sid)
							
							# Clean up expired presence entries
							presence_data = app.redis_client.hgetall('presence:users')
							for user_key, presence_json in presence_data.items():
								try:
									presence_info = json.loads(presence_json)
									last_activity = float(presence_info.get('last_activity', 0))
									if last_activity < cutoff:
										app.redis_client.hdel('presence:users', user_key)
								except Exception:
									# If presence data is corrupted, remove it
									app.redis_client.hdel('presence:users', user_key)
		except Exception:
			pass
		# Enforce server-side force-logout if flagged by admin (by user or session)
		# Temporarily disable Redis force-logout checks if flag set
		if getattr(app.config, 'get', lambda *_: False)('FORCE_LOGOUT_DISABLED') or app.config.get('FORCE_LOGOUT_DISABLED'):
			return
		is_auth_attr = getattr(current_user, 'is_authenticated', False)
		is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
		uid = getattr(current_user, 'id', None)
		cookie_name = app.config.get('SESSION_COOKIE_NAME', 'session')
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
				app._force_logout_users.discard(uid)
				if sid:
					app._force_logout_sessions.discard(sid)
					if hasattr(app, '_sessions'):
						app._sessions.pop(sid, None)
		
		if force_logout:
			logout_user()
			g.force_logout = True
			# Also purge presence for this user
			if hasattr(app, 'presence_manager') and app.presence_manager and uid:
				app.presence_manager.remove_user_presence(uid)
			else:
				# Fallback to in-memory presence cleanup
				presence = getattr(app, '_presence', {}) or {}
				for psid, info in list(presence.items()):
					if int(info.get('user_id') or -1) == int(uid or -2):
						app._presence.pop(psid, None)
				presence_hb = getattr(app, '_presence_hb', {}) or {}
				prefix = f"hb:{uid}:"
				for key in list(presence_hb.keys()):
					if isinstance(key, str) and key.startswith(prefix):
						app._presence_hb.pop(key, None)
	
	@app.after_request
	def after_request(response):
		"""Log access after request completion."""
		try:
			# Ensure Redis cookie-session tracking on login (when session cookie is first issued)
			try:
				# If user is authenticated, try to extract session id from Set-Cookie
				is_auth_attr = getattr(current_user, 'is_authenticated', False)
				is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
				if is_authenticated and hasattr(app, 'redis_client') and app.redis_client:
					cookie_name = app.config.get('SESSION_COOKIE_NAME', 'session')
					# Attempt to read sid from request cookies first
					sid = request.cookies.get(cookie_name) or request.cookies.get('session')
					# If not present (first login), parse from Set-Cookie header
					if not sid:
						set_cookies = response.headers.getlist('Set-Cookie') if hasattr(response.headers, 'getlist') else []
						for sc in set_cookies:
							try:
								if sc.startswith(f"{cookie_name}=") or sc.startswith("session="):
									# value is between '=' and first ';'
									val = sc.split('=', 1)[1]
									val = val.split(';', 1)[0]
									if val:
										sid = val
										break
							except Exception:
								continue
					if sid:
						# Same metadata as in before_request
						try:
							uid = getattr(current_user, 'id', None)
							uname = getattr(current_user, 'name', None)
							ip = request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr
							ua = request.headers.get('User-Agent', '')
							now_ts = int(time())
							# Resolve configured lifetime (seconds)
							lifetime_s = 1800
							try:
								from datetime import timedelta
								cfg_life = app.config.get('PERMANENT_SESSION_LIFETIME')
								if isinstance(cfg_life, timedelta):
									lifetime_s = int(cfg_life.total_seconds())
								else:
									lifetime_s = int(cfg_life or 1800)
							except Exception:
								try:
									lifetime_s = int(app._sql.config.get('web', 'session_lifetime', fallback='1800'))
								except Exception:
									lifetime_s = 1800
							# Write meta and TTL beacon
							meta_key = f"sessions:cookie:{sid}"
							app.redis_client.hset(meta_key, mapping={
								'sid': sid,
								'user_id': uid or '',
								'user': uname or '',
								'ip': ip or '',
								'ua': ua or '',
								'created_at': str(now_ts),
								'last_seen': str(now_ts),
							})
							app.redis_client.expire(meta_key, lifetime_s)
							beacon_key = f"sessions:cookie:ttl:{sid}"
							app.redis_client.set(beacon_key, '1', ex=lifetime_s)
							app.redis_client.sadd('sessions:cookie:index', sid)
						except Exception:
							pass
			except Exception:
				pass

			# If force logout was requested, delete session cookies on response
			if getattr(g, 'force_logout', False):
				try:
					cookie_name = app.config.get('SESSION_COOKIE_NAME', 'session')
					response.delete_cookie(cookie_name, path='/', samesite=app.config.get('SESSION_COOKIE_SAMESITE', 'Lax'))
				except Exception:
					# Fallback
					response.delete_cookie('session', path='/', samesite=app.config.get('SESSION_COOKIE_SAMESITE', 'Lax'))
				response.delete_cookie('session', path='/', samesite=app.config.get('SESSION_COOKIE_SAMESITE', 'Lax'))
				response.delete_cookie('remember_token', path='/', samesite=app.config.get('REMEMBER_COOKIE_SAMESITE', 'Lax'))
			# Get request info
			method = request.method
			path = request.path
			status = response.status_code
			user = getattr(g, 'user', None)
			user_name = user.name if user and hasattr(user, 'name') else None
			ip = request.remote_addr
			user_agent = request.headers.get('User-Agent', '')
			duration = time() - g.start_time if hasattr(g, 'start_time') else None
			
			# Log access (skip noisy polling endpoints)
			skip_paths = (
				'/admin/sessions',
				'/admin/presence',
				'/api/heartbeat',
			)
			if path not in skip_paths:
				log_access(method, path, status, user_name, ip, user_agent, duration)
			
		except Exception as e:
			_log.exception("Error in access logging: %s", e)
		
		return response


