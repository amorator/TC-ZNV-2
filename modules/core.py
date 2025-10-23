"""Core configuration utilities for the application.

Loads INI configuration with environment variable overrides.
"""

from configparser import ConfigParser
from os import getenv
import redis
from .logging import get_logger

_log = get_logger(__name__)


class Config:
	"""INI configuration wrapper with ENV overrides.

	Order of precedence: environment variables override values from the
	provided INI file. Supports UTF-8 with a fallback to cp1251 for
	compatibility.
	"""
	
	def __init__(self, config: str = 'config.ini') -> None:
		self.config = ConfigParser()
		cfg_path = getenv('ZNF_CONFIG', config)
		read_ok = False
		for enc in ('utf-8', 'cp1251'):
			try:
				self.config.read(cfg_path, encoding=enc)
				read_ok = True
				break
			except UnicodeDecodeError:
				continue
		if not read_ok:
			self.config.read(cfg_path)
		self._apply_env_overrides()
		# Only log config loading once across all workers using Redis
		self._log_config_once(cfg_path)

	def _log_config_once(self, cfg_path: str) -> None:
		"""Log config loading only once across all workers using Redis."""
		redis_client = redis.Redis(
			unix_socket_path='/var/run/redis/redis.sock',
			password='znf25!',
			db=0
		)
		# Use Redis SET with NX (only if not exists) and EX (expire in 20 seconds)
		if redis_client.set('config_loaded_logged', '1', nx=True, ex=20):
			_log.info(f"Configuration loaded from {cfg_path}")

	def _apply_env_overrides(self) -> None:
		"""Apply environment variable overrides for common sections."""
		if 'db' in self.config:
			self.config['db']['host'] = getenv('DB_HOST', self.config['db'].get('host', 'localhost'))
			self.config['db']['user'] = getenv('DB_USER', self.config['db'].get('user', 'root'))
			self.config['db']['password'] = getenv('DB_PASSWORD', self.config['db'].get('password', ''))
			self.config['db']['name'] = getenv('DB_NAME', self.config['db'].get('name', 'znf'))
			self.config['db']['prefix'] = getenv('DB_PREFIX', self.config['db'].get('prefix', 'web'))
			self.config['db']['permission_length'] = getenv('DB_PERMISSION_LENGTH', self.config['db'].get('permission_length', '4'))
			self.config['db']['pool_size'] = getenv('DB_POOL_SIZE', self.config['db'].get('pool_size', '5'))
		if 'files' in self.config:
			self.config['files']['root'] = getenv('FILES_ROOT', self.config['files'].get('root', '/mnt/files'))
			self.config['files']['max_upload_files'] = getenv('FILES_MAX_UPLOAD_FILES', self.config['files'].get('max_upload_files', '5'))
		if 'videos' in self.config:
			self.config['videos']['max_threads'] = getenv('VIDEOS_MAX_THREADS', self.config['videos'].get('max_threads', '2'))
		if 'web' in self.config:
			self.config['web']['session_lifetime'] = getenv('WEB_SESSION_LIFETIME', self.config['web'].get('session_lifetime', '86400'))
			# passive_poll_seconds removed: replaced by sync_idle_seconds idle-guard
