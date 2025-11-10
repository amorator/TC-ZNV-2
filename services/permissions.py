from flask_login import current_user
from functools import lru_cache
import hashlib
import json


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
    
    # Check if user is admin group member
    def is_admin_group_member() -> bool:
        try:
            cfg = getattr(app._sql, 'config', {})
            from configparser import ConfigParser
            aname = 'Программисты'
            if isinstance(cfg, ConfigParser):
                aname = cfg.get('admin', 'group', fallback=aname) or aname
            else:
                if isinstance(cfg, dict):
                    admin = cfg.get('admin') if hasattr(cfg, 'get') else None
                    if isinstance(admin, dict) and 'group' in admin:
                        aname = admin.get('group') or aname
                    elif 'group' in cfg:
                        aname = cfg.get('group') or aname
            name_norm = (aname or '').strip().lower()
            prefix = app._sql.config['db']['prefix']
            rows = app._sql.execute_query(f"SELECT id,name FROM {prefix}_group") or []
            for gid, gname in rows:
                if str(gname).strip().lower() == name_norm:
                    return int(current_user.gid) == int(gid)
        except Exception:
            pass
        return False
    
    is_admin_group = is_admin_group_member()

    # Build fresh directory structure from database instead of using cached app.dirs
    fresh_dirs = []
    try:
        categories = app._sql.category_all() or []
        for cat in categories:
            try:
                # Skip disabled and system 'registrators'
                if hasattr(cat, 'enabled') and int(cat.enabled) != 1:
                    continue
                folder = (getattr(cat, 'folder_name', '') or '').strip().lower()
                if folder == 'registrators':
                    continue
                # Hide 'orders' except for full-access users or members of admin group
                if folder == 'orders':
                    # full access on Files page or any admin flag
                    is_full = current_user.is_allowed(page_id, 'z') or has_admin_any
                    if not (is_full or is_admin_group):
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

    def _has_view_access_for_sub(subcategory_id: int) -> bool:
        """Return True if current user is allowed to view given subcategory via stored permissions."""
        # Admin group members see all subcategories
        if is_admin_group:
            return True
        
        try:
            key = f"subcategory_permissions:{int(subcategory_id)}"
            raw = app._sql.setting_get(key)
            if not raw:
                return False
            perms = json.loads(raw)
        except Exception:
            perms = {}

        try:
            gid = int(getattr(current_user, 'gid', 0) or 0)
            uid = int(getattr(current_user, 'id', 0) or 0)
        except Exception:
            gid = 0
            uid = 0

        # Group-level matrix
        try:
            gmatrix = perms.get('group_by_id', {}).get(str(gid), {}) if isinstance(perms.get('group_by_id'), dict) else {}
            if any(int(gmatrix.get(k, 0)) == 1 for k in ('view_all', 'view_group', 'view_own')):
                return True
        except Exception:
            pass

        # Legacy simple group flag
        try:
            if int(perms.get('group', {}).get(str(gid), 0)) == 1:
                return True
        except Exception:
            pass

        # User-level matrix
        try:
            umatrix = perms.get('user_by_id', {}).get(str(uid), {}) if isinstance(perms.get('user_by_id'), dict) else {}
            if any(int(umatrix.get(k, 0)) == 1 for k in ('view_all', 'view_group', 'view_own')):
                return True
        except Exception:
            pass

        # Legacy simple user map (by login)
        try:
            login = (getattr(current_user, 'login', '') or '').strip()
            if login and int(perms.get('user', {}).get(login, 0)) == 1:
                return True
        except Exception:
            pass

        return False

    for entry in fresh_dirs:
        root_key = list(entry.keys())[0]
        try:
            # Default to True (restrict by subcategory permissions) if not explicitly disabled in config
            only_group = bool(int(app._sql.config[root_key]['only_group']))
        except Exception:
            only_group = True

        # Avoid verbose dumps of keys in logs

        # Определим, есть ли включённые подкатегории (уже отфильтрованы при построении fresh_dirs)
        has_enabled_subdirs = any(k for k in entry.keys() if k != root_key)

        # Admin ('z' or admin.any) or admin group member or explicit display-all ('f' or files.display_all)
        # or non-group-restricted roots: give full tree (если есть активные подкатегории)
        if (current_user.is_allowed(page_id, 'z') or has_admin_any or is_admin_group
                or current_user.is_allowed(page_id, 'f') or has_display_all
                or not only_group):
            if has_enabled_subdirs:
                dirs.append(entry)
            continue

        # Group-restricted: include only permitted subdirs from stored permissions
        # BUT: Admin users and admin group members see all subcategories regardless of permissions
        if has_admin_any or is_admin_group:
            # Admin sees all subcategories, но пропускаем пустые категории
            if has_enabled_subdirs:
                dirs.append(entry)
        else:
            # Regular users: filter by subcategory permission store
            filtered = {root_key: entry[root_key]}
            # Resolve real category id to map sub folder -> subcategory id
            try:
                cat_id = app._sql.category_id_by_folder(root_key)
            except Exception:
                cat_id = None
            for k, v in entry.items():
                if k == root_key:
                    continue
                try:
                    sub_id = app._sql.subcategory_id_by_folder(cat_id, k) if cat_id else None
                except Exception:
                    sub_id = None
                if sub_id and _has_view_access_for_sub(int(sub_id)):
                    filtered[k] = v
            # Добавляем только если после фильтрации осталось хоть что-то
            if any(k for k in filtered.keys() if k != root_key):
                dirs.append(filtered)

    # Avoid final verbose summaries with root lists
    return dirs
