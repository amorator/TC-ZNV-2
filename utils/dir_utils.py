def validate_directory_params(did, sdid, _dirs):
	"""Validate and normalize directory parameters for the Files section.

	This helper is shared by multiple `/files` endpoints to consistently guard
	against out-of-range indices and empty permission results.

	Parameters
	----------
	did : int | None
		Requested root directory index (category). If ``None`` or invalid, falls back to 0.
	sdid : int | None
		Requested subdirectory index (subcategory). UI uses 1-based indexing; 0 means no subcategory.
	_dirs : list
		Nested structure of allowed directories for the current user as produced by
		``services.permissions.dirs_by_permission``.

	Returns
	-------
	Tuple[int, int]
		A safe pair ``(did, sdid)`` within bounds. For no subdirectories, returns ``(did, 0)``.
	"""
	# If there are no allowed directories at all, return safe defaults
	total_roots = len(_dirs)
	if total_roots == 0:
		return 0, 0

	# Clamp root index
	if did is None:
		did = 0
	if did < 0 or did >= total_roots:
		did = 0

	# Determine number of subdirectories (keys) under the selected root
	try:
		total_subs = len(_dirs[did])
	except Exception:
		# In case structure is unexpected, fall back to one-sub layout
		total_subs = 1

	# Subdirectories are 1-based in UI; index 0 is the root label
	if total_subs <= 1:
		# No subdirectories available
		return did, 0

	# Clamp subdirectory index to [1, total_subs-1]
	if sdid is None:
		sdid = 1
	if sdid < 1 or sdid >= total_subs:
		sdid = 1
	return did, sdid


