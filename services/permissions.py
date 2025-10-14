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

    try:
        app.logger.info(
            '[DIRS] user=%s gid=%s has_admin_any=%s has_display_all=%s group=%s',
            getattr(current_user, 'name', '?'),
            getattr(current_user, 'gid', '?'), has_admin_any, has_display_all,
            group_name)
    except Exception:
        pass

    for entry in app.dirs:
        root_key = list(entry.keys())[0]
        try:
            only_group = bool(int(app._sql.config[root_key]['only_group']))
        except Exception:
            only_group = False

        # Debug specific roots (e.g., '2' and '3')
        try:
            if str(root_key) in ('2', '3'):
                app.logger.info('[DIRS] root=%s only_group=%s keys=%s',
                                root_key, only_group, list(entry.keys()))
        except Exception:
            pass

        # Hydrate missing subcategories from DB if this root has none (defensive)
        try:
            if len(entry.keys()) == 1:
                try:
                    cat_id = app._sql.category_id_by_folder(root_key)
                    subs = app._sql.subcategory_by_category([cat_id]) or []
                    for sub in subs:
                        try:
                            if hasattr(sub, 'enabled') and int(
                                    sub.enabled) != 1:
                                continue
                            entry.update({sub.folder_name: sub.display_name})
                        except Exception:
                            continue
                except Exception:
                    pass
        except Exception:
            pass

        # Admin ('z' or admin.any) or explicit display-all ('f' or files.display_all)
        # or non-group-restricted roots: give full tree
        if (current_user.is_allowed(page_id, 'z') or has_admin_any
                or current_user.is_allowed(page_id, 'f') or has_display_all
                or not only_group):
            dirs.append(entry)
            try:
                if str(root_key) in ('2', '3'):
                    app.logger.info(
                        '[DIRS] grant full root=%s (reason: admin/display_all/not only_group)',
                        root_key)
            except Exception:
                pass
            continue

        # Group-restricted: include only subdirs that contain user's group
        # BUT: Admin users see all subcategories regardless of permissions
        if has_admin_any:
            # Admin sees all subcategories
            dirs.append(entry)
            try:
                if str(root_key) in ('2', '3'):
                    app.logger.info('[DIRS] admin override full root=%s',
                                    root_key)
            except Exception:
                pass
        else:
            # Regular users: filter by group permissions
            filtered = {root_key: entry[root_key]}
            for k, v in entry.items():
                if group_name in v:
                    filtered[k] = v
            dirs.append(filtered)
            try:
                if str(root_key) in ('2', '3'):
                    app.logger.info('[DIRS] filtered root=%s -> keys=%s',
                                    root_key, list(filtered.keys()))
            except Exception:
                pass

    try:
        # Final summary for debug roots
        debug = []
        for e in dirs:
            rk = list(e.keys())[0]
            if str(rk) in ('2', '3'):
                debug.append((rk, list(e.keys())))
        if debug:
            app.logger.info('[DIRS] final roots summary: %s', debug)
    except Exception:
        pass
    return dirs
