from flask_login import current_user


def dirs_by_permission(app, page_id: int, perm: str):
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
	return dirs


