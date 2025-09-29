from configparser import ConfigParser
from os import getenv
from os.path import isfile


class Config():
	def __init__(self, config='config.ini'):
		self.config = ConfigParser()
		cfg_path = getenv('ZNV_CONFIG', config)
		# Force encoding to avoid Windows cp1251 decode errors; fallback to cp1251 if needed
		read_ok = False
		for enc in ('utf-8', 'cp1251'):
			try:
				self.config.read(cfg_path, encoding=enc)
				read_ok = True
				break
			except UnicodeDecodeError:
				continue
		if not read_ok:
			# Last resort: try default behavior
			self.config.read(cfg_path)
		self._apply_env_overrides()

	def _apply_env_overrides(self):
		# DB overrides
		if 'db' in self.config:
			self.config['db']['host'] = getenv('DB_HOST', self.config['db'].get('host', 'localhost'))
			self.config['db']['user'] = getenv('DB_USER', self.config['db'].get('user', 'root'))
			self.config['db']['password'] = getenv('DB_PASSWORD', self.config['db'].get('password', ''))
			self.config['db']['name'] = getenv('DB_NAME', self.config['db'].get('name', 'znv'))
			self.config['db']['prefix'] = getenv('DB_PREFIX', self.config['db'].get('prefix', 'web'))
			self.config['db']['permission_length'] = getenv('DB_PERMISSION_LENGTH', self.config['db'].get('permission_length', '4'))
			self.config['db']['pool_size'] = getenv('DB_POOL_SIZE', self.config['db'].get('pool_size', '5'))
		# Files/videos overrides
		if 'files' in self.config:
			self.config['files']['root'] = getenv('FILES_ROOT', self.config['files'].get('root', '/mnt/files'))
		if 'videos' in self.config:
			self.config['videos']['max_threads'] = getenv('VIDEOS_MAX_THREADS', self.config['videos'].get('max_threads', '2'))
		# Web overrides
		if 'web' in self.config:
			self.config['web']['session_lifetime'] = getenv('WEB_SESSION_LIFETIME', self.config['web'].get('session_lifetime', '86400'))
