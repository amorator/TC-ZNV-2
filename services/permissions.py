from flask_login import current_user
from functools import lru_cache
import hashlib


def dirs_by_permission(app, page_id: int, perm: str):
	# Create cache key based on user permissions and page
	cache_key = f"{current_user.id}_{current_user.gid}_{page_id}_{perm}_{current_user.permission_string()}"
	
	# Use LRU cache with TTL-like behavior
	cached_dirs = getattr(app, '_dirs_cache', {}).get(cache_key)
	if cached_dirs is not None:
		return cached_dirs
	
	dirs = []
	group_name = app._sql.group_name_by_id([current_user.gid])
	for entry in app.dirs:
		if current_user.is_allowed(page_id, perm):
			root_key = list(entry.keys())[0]
			if current_user.is_allowed(page_id, 'e') or current_user.is_allowed(page_id, 'z') or not int(app._sql.config[root_key]['only_group']):
				dirs.append(entry)
			else:
				filtered = {root_key: entry[root_key]}
				for k, v in entry.items():
					if group_name in v:
						filtered.update({k: v})
				dirs.append(filtered)
		perm = chr(ord(perm) + 1)
	
	# Cache the result (simple in-memory cache)
	if not hasattr(app, '_dirs_cache'):
		app._dirs_cache = {}
	app._dirs_cache[cache_key] = dirs
	
	# Limit cache size to prevent memory leaks
	if len(app._dirs_cache) > 100:
		# Remove oldest entries (simple FIFO)
		oldest_key = next(iter(app._dirs_cache))
		del app._dirs_cache[oldest_key]
	
	return dirs


