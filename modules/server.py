"""Application server wrapper extending Flask with auth and utilities."""

from functools import wraps
from hashlib import md5
from os import getenv
from re import sub

from flask import Flask, flash, abort
from flask_cors import CORS
from flask_login import LoginManager, current_user

from modules.SQLUtils import SQLUtils


class Server(Flask):
	"""Flask app with login manager, DB access, and helpers."""

	def __init__(self, root, name=__name__):
		super().__init__(name, root_path=root)
		CORS(self, resources={r'*': {'origins': '*'}}, supports_credentials=True)
		# Prefer env-provided secret for sessions; fallback to static default
		self.config['SECRET_KEY'] = getenv('SECRET_KEY', 'achudwshoiqxjqi@eowe1J2')
		self.config['TEMPLATES_AUTO_RELOAD'] = True
		self.config['SESSION_TYPE'] = 'filesystem'
		self.config['SESSION_PERMANENT'] = True
		self.config['PERMANENT_SESSION_LIFETIME'] = 86400
		self.config['SESSION_COOKIE_HTTPONLY'] = False
		self.config['SESSION_COOKIE_SECURE'] = True
		self.config['SESSION_REFRESH_EACH_REQUEST'] = True
		self.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
		self.config['REMEMBER_COOKIE_SECURE'] = True
		self.config['REMEMBER_COOKIE_SAMESITE'] = 'Lax'
		self.init()
		self.get_dirs()

	def init(self) -> None:
		"""Initialize login manager and SQL utilities."""
		self.login_manager = LoginManager(self)
		self.login_manager.login_view = 'login'  # type: ignore[assignment]
		self.login_manager.login_message = 'Please log in to access this page.'
		self.login_manager.refresh_view = 'reauth'  # type: ignore[assignment]
		self._sql = SQLUtils()
		# Load Flask secret key from DB (create if missing) unless provided via env
		try:
			if getenv('SECRET_KEY') is None:
				sk = self._sql.get_or_create_secret_key()
				if sk and isinstance(sk, str) and len(sk) >= 32:
					self.config['SECRET_KEY'] = sk
		except Exception:
			pass
		# Override session lifetime from config.ini [web] if present (fallback to current value)
		try:
			default_lifetime = int(self.config.get('PERMANENT_SESSION_LIFETIME', 86400))
			lifetime = self._sql.config.getint('web', 'permanent_session_lifetime', fallback=default_lifetime)
			self.config['PERMANENT_SESSION_LIFETIME'] = lifetime
		except Exception:
			pass

	def get_dirs(self) -> None:
		"""Build directories structure from database categories.

		Rules:
		- Exclude system 'registrators' category entirely from Files view
		- Include only enabled categories and enabled subcategories
		- Do not include categories that have no enabled subcategories
		"""
		self.dirs = []
		try:
			categories = self._sql.category_all() or []
			for cat in categories:
				try:
					# Skip disabled and system 'registrators'
					if hasattr(cat, 'enabled') and int(cat.enabled) != 1:
						continue
					if (getattr(cat, 'folder_name', '') or '').strip().lower() == 'registrators':
						continue
					# Collect enabled subcategories
					enabled_subs = []
					subcategories = self._sql.subcategory_by_category([cat.id]) or []
					for sub in subcategories:
						if hasattr(sub, 'enabled') and int(sub.enabled) == 1:
							enabled_subs.append(sub)
					# Skip category without enabled subcategories
					if not enabled_subs:
						continue
					# Add category root
					self.dirs.append({cat.folder_name: cat.display_name})
					# Add enabled subcategories
					for sub in enabled_subs:
						try:
							# Avoid key collision when sub folder equals category folder
							key = sub.folder_name
							cat_key = list(self.dirs[len(self.dirs) - 1].keys())[0]
							if str(key) == str(cat_key):
								# Suffix with stable marker and id
								key = f"{sub.folder_name}__dup_{sub.id}"
							self.dirs[len(self.dirs) - 1].update({key: sub.display_name})
						except Exception:
							# Fallback without normalization
							self.dirs[len(self.dirs) - 1].update({sub.folder_name: sub.display_name})
				except Exception:
					continue
		except Exception as e:
			print(f"Warning: Could not load categories from database: {e}")
			self.dirs = []

	def run_debug(self) -> None:
		"""Run development server with TLS and debug enabled."""
		self.run(host='0.0.0.0', port=443, ssl_context=('/etc/ssl/.ssl/znv.crt', '/etc/ssl/.ssl/znv.key'), threaded=True, debug=True)

	def hash(self, s: str) -> str:
		"""Return MD5 hash for a string (legacy)."""
		return md5(s.encode('utf-8')).hexdigest()

	def flash_error(self, e) -> None:
		"""Normalize and flash an error message to UI."""
		msg = sub("['\"]", '', str(e))
		flash(msg)

	def permission_required(self, id: int, perm: str = 'a'):
		"""Decorator to enforce permission checks for a page id and verb."""
		def _permission_required(f):
			@wraps(f)
			def wrap(*args, **kwargs):
				if not current_user.is_authenticated:
					return abort(401)
				if current_user.is_allowed(id, perm):
					return f(*args, **kwargs)
				else:
					return abort(403)
			return wrap
		return _permission_required
