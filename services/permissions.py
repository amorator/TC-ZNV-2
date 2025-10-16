from flask_login import current_user
from functools import lru_cache
import hashlib


def dirs_by_permission(app, page_id: int, perm: str):

    # Build directories list according to permissions
    dirs = []
    group_name = app._sql.group_name_by_id([current_user.gid])
    # Access to files page is determined by 'a' (view) or 'z' (admin) on this page
    can_view_any = current_user.is_allowed(
        page_id, 'a') or current_user.is_allowed(page_id, 'z')
    if not can_view_any:
        return dirs

    # Named-scope helpers (work even if legacy letters are not set for this page)
    try:
        has_admin_any = (getattr(current_user, 'name', '').lower() == 'admin') \
         or (hasattr(current_user, 'has') and (current_user.has('admin.any')
           or current_user.has('admin')))
        has_display_all = hasattr(
            current_user, 'has') and current_user.has('files.display_all')
    except Exception:
        has_admin_any = False
        has_display_all = False

    # Build fresh directory structure from database instead of using cached app.dirs
    fresh_dirs = []
    try:
        categories = app._sql.category_all() or []
        for cat in categories:
            try:
                # Skip disabled and system 'registrators'
                if hasattr(cat, 'enabled') and int(cat.enabled) != 1:
                    continue
                if (getattr(cat, 'folder_name', '')
                        or '').strip().lower() == 'registrators':
                    continue
                # Collect enabled subcategories
                enabled_subs = []
                subcategories = app._sql.subcategory_by_category([cat.id
                                                                  ]) or []
                for sub in subcategories:
                    if hasattr(sub, 'enabled') and int(sub.enabled) == 1:
                        enabled_subs.append(sub)
                # Skip category without enabled subcategories
                if not enabled_subs:
                    continue
                # Add category root
                fresh_dirs.append({cat.folder_name: cat.display_name})
                # Add enabled subcategories
                for sub in enabled_subs:
                    try:
                        # Avoid key collision when sub folder equals category folder
                        key = sub.folder_name
                        cat_key = list(fresh_dirs[len(fresh_dirs) -
                                                  1].keys())[0]
                        if str(key) == str(cat_key):
                            # Suffix with stable marker and id
                            key = f"{sub.folder_name}__dup_{sub.id}"
                        fresh_dirs[len(fresh_dirs) - 1].update(
                            {key: sub.display_name})
                    except Exception:
                        # Fallback without normalization
                        fresh_dirs[len(fresh_dirs) - 1].update(
                            {sub.folder_name: sub.display_name})
            except Exception:
                continue
    except Exception as e:
        try:
            app.logger.warning("Could not load categories from database: %s",
                               e)
        except Exception:
            pass
        fresh_dirs = []

    for entry in fresh_dirs:
        root_key = list(entry.keys())[0]
        try:
            only_group = bool(int(app._sql.config[root_key]['only_group']))
        except Exception:
            only_group = False

        # Avoid verbose dumps of keys in logs

        # Определим, есть ли включённые подкатегории (уже отфильтрованы при построении fresh_dirs)
        has_enabled_subdirs = any(k for k in entry.keys() if k != root_key)

        # Admin ('z' or admin.any) or explicit display-all ('f' or files.display_all)
        # or non-group-restricted roots: give full tree (если есть активные подкатегории)
        if (current_user.is_allowed(page_id, 'z') or has_admin_any
                or current_user.is_allowed(page_id, 'f') or has_display_all
                or not only_group):
            if has_enabled_subdirs:
                dirs.append(entry)
            continue

        # Group-restricted: include only subdirs that contain user's group
        # BUT: Admin users see all subcategories regardless of permissions
        if has_admin_any:
            # Admin sees all subcategories, но пропускаем пустые категории
            if has_enabled_subdirs:
                dirs.append(entry)
        else:
            # Regular users: filter by group permissions
            filtered = {root_key: entry[root_key]}
            for k, v in entry.items():
                if group_name in v:
                    filtered[k] = v
            # Добавляем только если после фильтрации осталось хоть что-то
            if any(k for k in filtered.keys() if k != root_key):
                dirs.append(filtered)

    # Avoid final verbose summaries with root lists
    return dirs
