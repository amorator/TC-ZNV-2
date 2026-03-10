"""Centralized logging configuration for znf application."""

import logging
import logging.handlers
from os import path, makedirs
from configparser import ConfigParser
from datetime import datetime
from typing import Optional
try:
    # Optional import; functions guard if no request context
    from flask import request as _flask_request
except Exception:
    _flask_request = None


class LoggingConfig:
	"""Centralized logging configuration."""
	
	def __init__(self, config_path: str = "config.ini"):
		"""Initialize logging configuration from config file."""
		from os import environ
		# Allow overriding config path via env var for deployments
		env_cfg = environ.get('ZNF_CONFIG') or environ.get('LOG_CONFIG')
		cfg_path = env_cfg if env_cfg else config_path
		self.config = ConfigParser()
		self.config.read(cfg_path, encoding='utf-8')
		
		# Create logs directory if it doesn't exist
		self.logs_dir = path.join(path.dirname(path.realpath(__file__)), '..', 'logs')
		makedirs(self.logs_dir, exist_ok=True)
		
		# Service name for systemd
		self.service_name = self.config.get('logging', 'service_name', fallback='znf.service')
		
		# Log levels
		self.file_level = self.config.get('logging', 'file_level', fallback='INFO')
		self.console_level = self.config.get('logging', 'console_level', fallback='INFO')
		self.actions_level = self.config.get('logging', 'actions_level', fallback='INFO')
		self.access_level = self.config.get('logging', 'access_level', fallback='INFO')
		
		# Rotation settings (time-based)
		self.backup_count = self.config.getint('logging', 'backup_count', fallback=5)
		self.rotation_when = self.config.get('logging', 'rotation_when', fallback='midnight')
		self.rotation_interval = self.config.getint('logging', 'rotation_interval', fallback=1)
		self.rotation_utc = self.config.getboolean('logging', 'rotation_utc', fallback=False)

		# Formats
		self.console_format = self.config.get(
			'logging', 'console_format', fallback='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
		self.file_format = self.config.get(
			'logging', 'file_format', fallback='%(asctime)s [%(levelname)s] %(name)s:%(lineno)d: %(message)s')
		self.actions_format = self.config.get(
			'logging', 'actions_format', fallback='%(asctime)s [%(levelname)s] %(message)s')
		self.access_format = self.config.get(
			'logging', 'access_format', fallback='%(asctime)s %(message)s')
		self.date_format = self.config.get('logging', 'date_format', fallback='%Y-%m-%d %H:%M:%S')
		
		self._setup_loggers()
	
	def _setup_loggers(self):
		"""Setup all application loggers."""
		# Safe rotating file handler to avoid FileNotFoundError during rollover when some
		# rotated files are missing (common on first runs or manual cleanup)
		class SafeRotatingFileHandler(logging.handlers.RotatingFileHandler):
			def doRollover(self):
				try:
					super().doRollover()
				except (FileNotFoundError, PermissionError):
					try:
						open(self.baseFilename, 'a').close()
					except Exception:
						pass
		# Time-based safe handler using TimedRotatingFileHandler
		class SafeTimedRotatingFileHandler(logging.handlers.TimedRotatingFileHandler):
			def doRollover(self):
				try:
					super().doRollover()
				except (FileNotFoundError, PermissionError):
					try:
						open(self.baseFilename, 'a').close()
					except Exception:
						pass
		# Root logger
		root_logger = logging.getLogger()
		root_logger.setLevel(logging.DEBUG)
		
		# Check if app.log file handler already exists
		app_log_path = path.abspath(path.join(self.logs_dir, 'app.log'))
		has_app_log_handler = False
		for handler in root_logger.handlers[:]:
			# Check if this is a file handler pointing to app.log
			if isinstance(handler, logging.handlers.BaseRotatingHandler):
				if hasattr(handler, 'baseFilename'):
					handler_path = path.abspath(handler.baseFilename)
					if handler_path == app_log_path:
						has_app_log_handler = True
						break
		
		# Only clear handlers if we're setting up from scratch (not under gunicorn)
		# Under gunicorn, we want to preserve existing handlers and just add our file handler
		if not has_app_log_handler:
			# Clear existing handlers only if app.log handler doesn't exist
			# This preserves gunicorn's handlers while ensuring app.log is written
			for handler in root_logger.handlers[:]:
				# Don't remove StreamHandler (needed for systemd/gunicorn console output)
				if not isinstance(handler, logging.StreamHandler):
					root_logger.removeHandler(handler)
		
		# Console handler (for systemd) - add only if not exists
		has_console_handler = any(isinstance(h, logging.StreamHandler) for h in root_logger.handlers)
		if not has_console_handler:
			console_handler = logging.StreamHandler()
			console_handler.setLevel(getattr(logging, self.console_level))
			console_formatter = logging.Formatter(
				self.console_format,
				datefmt=self.date_format
			)
			console_handler.setFormatter(console_formatter)
			root_logger.addHandler(console_handler)
		
		# Write errors to app.log through the root handler only (avoid separate error.log)
		
		# Create access logger with dedicated file
		access_logger = logging.getLogger('access')
		access_logger.setLevel(logging.INFO)
		for h in access_logger.handlers[:]:
			access_logger.removeHandler(h)
		access_handler = SafeTimedRotatingFileHandler(
			path.join(self.logs_dir, 'access.log'),
			when=self.rotation_when,
			interval=self.rotation_interval,
			backupCount=self.backup_count,
			encoding='utf-8',
			utc=self.rotation_utc,
		)
		access_handler.setLevel(getattr(logging, self.access_level))
		access_formatter = logging.Formatter(
			self.access_format,
			datefmt=self.date_format
		)
		access_handler.setFormatter(access_formatter)
		access_logger.addHandler(access_handler)
		access_logger.propagate = False
		
		# Create actions logger with dedicated file
		actions_logger = logging.getLogger('actions')
		actions_logger.setLevel(logging.INFO)
		for h in actions_logger.handlers[:]:
			actions_logger.removeHandler(h)
		actions_handler = SafeTimedRotatingFileHandler(
			path.join(self.logs_dir, 'actions.log'),
			when=self.rotation_when,
			interval=self.rotation_interval,
			backupCount=self.backup_count,
			encoding='utf-8',
			utc=self.rotation_utc,
		)
		actions_handler.setLevel(getattr(logging, self.actions_level))
		actions_formatter = logging.Formatter(
			self.actions_format,
			datefmt=self.date_format
		)
		actions_handler.setFormatter(actions_formatter)
		actions_logger.addHandler(actions_handler)
		actions_logger.propagate = False
		
		# Create error logger with dedicated file
		error_logger = logging.getLogger('error')
		error_logger.setLevel(logging.ERROR)
		for h in error_logger.handlers[:]:
			error_logger.removeHandler(h)
		error_handler = SafeTimedRotatingFileHandler(
			path.join(self.logs_dir, 'error.log'),
			when=self.rotation_when,
			interval=self.rotation_interval,
			backupCount=self.backup_count,
			encoding='utf-8',
			utc=self.rotation_utc,
		)
		error_handler.setLevel(logging.ERROR)
		error_formatter = logging.Formatter(
			self.file_format,
			datefmt=self.date_format
		)
		error_handler.setFormatter(error_formatter)
		error_logger.addHandler(error_handler)
		error_logger.propagate = False
		
		# File log handler for general application logs
		# Only add if it doesn't already exist
		if not has_app_log_handler:
			file_handler = SafeTimedRotatingFileHandler(
				path.join(self.logs_dir, 'app.log'),
				when=self.rotation_when,
				interval=self.rotation_interval,
				backupCount=self.backup_count,
				encoding='utf-8',
				utc=self.rotation_utc,
			)
			file_handler.setLevel(getattr(logging, self.file_level))
			file_formatter = logging.Formatter(
				self.file_format,
				datefmt=self.date_format
			)
			file_handler.setFormatter(file_formatter)
			root_logger.addHandler(file_handler)

		# Also capture all ERROR+ records into a dedicated error.log from root
		# This ensures regular logger.error(...) goes to error.log without requiring
		# callers to use a special 'error' logger.
		# Check if error.log handler already exists
		error_log_path = path.abspath(path.join(self.logs_dir, 'error.log'))
		has_error_log_handler = False
		for handler in root_logger.handlers[:]:
			if isinstance(handler, logging.handlers.BaseRotatingHandler):
				if hasattr(handler, 'baseFilename'):
					handler_path = path.abspath(handler.baseFilename)
					if handler_path == error_log_path:
						has_error_log_handler = True
						break
		
		if not has_error_log_handler:
			root_error_handler = SafeTimedRotatingFileHandler(
				path.join(self.logs_dir, 'error.log'),
				when=self.rotation_when,
				interval=self.rotation_interval,
				backupCount=self.backup_count,
				encoding='utf-8',
				utc=self.rotation_utc,
			)
			# Capture warnings and above in error.log
			root_error_handler.setLevel(logging.WARNING)
			root_error_formatter = logging.Formatter(
				self.file_format,
				datefmt=self.date_format
			)
			root_error_handler.setFormatter(root_error_formatter)
			root_logger.addHandler(root_error_handler)

		# Reduce verbosity of noisy HTTP/server loggers so they don't spam app.log
		noisy_loggers = [
			'geventwebsocket.handler',
			'werkzeug',
			'engineio.server',
			'socketio.server',
		]
		for lname in noisy_loggers:
			nl = logging.getLogger(lname)
			nl.setLevel(logging.WARNING)
			# Let them propagate to root so they end up in app.log
			nl.propagate = True
		# No extra root filters; keep a single sink (app.log)
	
	def get_logger(self, name: str) -> logging.Logger:
		"""Get logger instance."""
		return logging.getLogger(name)
	
	def log_access(self, method: str, path: str, status: int, user: str = None, 
				   ip: str = None, user_agent: str = None, duration: float = None):
		"""Log HTTP access to access.log."""
		# Filter noisy heartbeat/ping endpoints from access log
		try:
			p = (path or '').lower()
			if (
				'/api/heartbeat' in p or '/presence/heartbeat' in p or '/presence/leave' in p or
				p.endswith('/heartbeat') or '/api/ping' in p or '/presence/ping' in p or p.endswith('/ping') or
				p.startswith('/static/') or '/static/' in p or
				p.startswith('/admin/presence') or '/admin/presence/redis' in p or
				p.startswith('/admin/logs') or '/admin/logs_list' in p or
				p.startswith('/admin/sessions') or '/admin/sessions/redis' in p
			):
				return
		except Exception:
			pass

		access_logger = logging.getLogger('access')
		user_info = f" user={user}" if user else ""
		ip_info = f" ip={ip}" if ip else ""
		ua_info = f" ua={user_agent}" if user_agent else ""
		duration_info = f" duration={duration:.3f}s" if duration is not None else ""
		
		message = f'{method} {path} {status}{user_info}{ip_info}{ua_info}{duration_info}'
		access_logger.info(message)
	
	def log_action(self, action: str, user: str, details: str = None, 
			   ip: Optional[str] = None, success: bool = True, extra_data: dict = None):
		"""Логирует действие пользователя с расширенной информацией."""
		actions_logger = logging.getLogger('actions')
		status = "SUCCESS" if success else "FAILED"
		ip_info = f" ip={ip}" if ip else ""
		details_info = f" details={details}" if details else ""
		# Enrich with request context (route, method, path, referer) when available
		ctx_parts = []
		try:
			req = _flask_request if _flask_request else None
			if req:
				endpoint = getattr(req, 'endpoint', None)
				method = getattr(req, 'method', None)
				path_ = getattr(req, 'path', None) or getattr(req, 'full_path', None)
				referer = (req.headers.get('Referer') or req.headers.get('Referrer') or '')
				if endpoint:
					ctx_parts.append(f"endpoint={endpoint}")
				if method:
					ctx_parts.append(f"method={method}")
				if path_:
					ctx_parts.append(f"route={path_}")
				if referer:
					ctx_parts.append(f"referer={referer}")
		except Exception:
			pass

		# Добавляем дополнительную информацию если есть
		extra_info = ""
		if extra_data:
			extra_parts = []
			for key, value in extra_data.items():
				if isinstance(value, (str, int, float, bool)):
					extra_parts.append(f"{key}={value}")
				else:
					extra_parts.append(f"{key}={str(value)[:100]}")
			extra_info = f" {' '.join(extra_parts)}"
		# Merge context parts after extra_data for readability
		if ctx_parts:
			extra_info = (extra_info + ' ' + ' '.join(ctx_parts)).rstrip()
		
		# Формируем полное сообщение
		message = f'{action} user={user} status={status}{ip_info}{details_info}{extra_info}'
		
		# Логирование действий
		try:
			actions_logger.info(message)
		except Exception as e:
			# Fallback to root logger
			root_logger = logging.getLogger()
			root_logger.error(f"log_action failed: {e}, message: {message}")
		
		# Не дублируем в основной лог, чтобы избежать шума; actions.log уже содержит событие


def log_error(message: str, exc_info: bool = False) -> None:
	"""Логирует ошибку в error.log."""
	error_logger = logging.getLogger('error')
	error_logger.error(message, exc_info=exc_info)


# Global logging config instance
_logging_config: Optional[LoggingConfig] = None


def init_logging(config_path: str = "config.ini") -> LoggingConfig:
	"""Initialize logging configuration."""
	global _logging_config
	if _logging_config is None:
		_logging_config = LoggingConfig(config_path)
	else:
		# Reconfigure in place to avoid duplicate handlers on reloads
		# Only reconfigure if handlers are missing (don't duplicate)
		root_logger = logging.getLogger()
		app_log_path = path.abspath(path.join(_logging_config.logs_dir, 'app.log'))
		has_app_log = any(
			isinstance(h, logging.handlers.BaseRotatingHandler) and 
			hasattr(h, 'baseFilename') and 
			path.abspath(h.baseFilename) == app_log_path
			for h in root_logger.handlers
		)
		if not has_app_log:
			_logging_config._setup_loggers()
	return _logging_config


def get_logger(name: str) -> logging.Logger:
	"""Get logger instance."""
	if _logging_config is None:
		init_logging()
	return _logging_config.get_logger(name)


def log_access(method: str, path: str, status: int, user: str = None, 
			   ip: str = None, user_agent: str = None, duration: float = None):
	"""Log HTTP access."""
	if _logging_config is None:
		init_logging()
	_logging_config.log_access(method, path, status, user, ip, user_agent, duration)


def log_action(action: str, user: str, details: str = None, 
		   ip: Optional[str] = None, success: bool = True, extra_data: dict = None):
	"""Логирует действие пользователя с расширенной информацией."""
	if _logging_config is None:
		init_logging()
	_logging_config.log_action(action, user, details, ip, success, extra_data)
