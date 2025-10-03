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
	
	# Build directories list according to permissions
	dirs = []
	group_name = app._sql.group_name_by_id([current_user.gid])
	# Access to files page is determined by 'a' (view) or 'z' (admin) on this page
	can_view_any = current_user.is_allowed(page_id, 'a') or current_user.is_allowed(page_id, 'z')
	if not can_view_any:
		return dirs

	# Named-scope helpers (work even if legacy letters are not set for this page)
	try:
		has_admin_any = hasattr(current_user, 'has') and current_user.has('admin.any')
		has_display_all = hasattr(current_user, 'has') and current_user.has('files.display_all')
	except Exception:
		has_admin_any = False
		has_display_all = False

	for entry in app.dirs:
		root_key = list(entry.keys())[0]
		try:
			only_group = bool(int(app._sql.config[root_key]['only_group']))
		except Exception:
			only_group = False

		# Admin ('z' or admin.any) or explicit display-all ('f' or files.display_all)
		# or non-group-restricted roots: give full tree
		if (
			current_user.is_allowed(page_id, 'z') or has_admin_any or
			current_user.is_allowed(page_id, 'f') or has_display_all or
			not only_group
		):
			dirs.append(entry)
			continue

		# Group-restricted: include only subdirs that contain user's group
		filtered = {root_key: entry[root_key]}
		for k, v in entry.items():
			if group_name in v:
				filtered[k] = v
		dirs.append(filtered)
	
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


