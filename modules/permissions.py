from functools import wraps
from typing import Iterable, Set
from flask import abort
from flask_login import current_user


# Named permission scopes
# Page access (first right) – required to enter the page (except index, login)
FILES_VIEW_PAGE = 'files.view'
REQUESTS_VIEW_PAGE = 'requests.view'
ORDERS_VIEW_PAGE = 'orders.view'
USERS_VIEW_PAGE = 'users.view'
USERS_MANAGE = 'users.manage'

# Files actions
FILES_UPLOAD = 'files.upload'
FILES_EDIT_ANY = 'files.edit_any'
FILES_DELETE_ANY = 'files.delete_any'
FILES_SEE_VIEWERS = 'files.see_viewers'
FILES_MARK_VIEWED = 'files.mark_viewed'

# Requests (examples, for adapter)
REQUESTS_APPROVE = 'requests.approve'
REQUESTS_ALLOW = 'requests.allow'

# Admin
ADMIN_ANY = 'admin.any'


def _get_user_permissions(user) -> Set[str]:
    perms: Set[str] = getattr(user, 'permissions', set())
    return perms or set()


def has_permission(user, perm: str) -> bool:
    # Support both property and method styles for is_authenticated
    is_auth_attr = getattr(user, 'is_authenticated', False)
    try:
        is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
    except Exception:
        is_authenticated = False
    if not is_authenticated:
        return False
    perms = _get_user_permissions(user)
    if ADMIN_ANY in perms:
        return True
    return perm in perms


def has_any(user, perms: Iterable[str]) -> bool:
    for p in perms:
        if has_permission(user, p):
            return True
    return False


def require_permissions(*perms: str):
    def decorator(fn):
        @wraps(fn)
        def _wrap(*args, **kwargs):
            # Robust auth check: supports property or method
            is_auth_attr = getattr(current_user, 'is_authenticated', False)
            try:
                is_authenticated = bool(is_auth_attr() if callable(is_auth_attr) else is_auth_attr)
            except Exception:
                is_authenticated = False
            if not is_authenticated:
                return abort(401)
            if not has_any(current_user, perms):
                return abort(403)
            return fn(*args, **kwargs)
        return _wrap
    return decorator


# ---- Human-readable display helpers ----

# Mapping of scopes to human-readable Russian labels
PERMISSION_LABELS = {
    FILES_VIEW_PAGE: 'Файлы: просмотр',
    FILES_UPLOAD: 'Файлы: загрузка/запись',
    FILES_EDIT_ANY: 'Файлы: изменение',
    FILES_DELETE_ANY: 'Файлы: удаление',
    FILES_SEE_VIEWERS: 'Файлы: просмотревшие',
    FILES_MARK_VIEWED: 'Файлы: отмечать просмотр',

    REQUESTS_VIEW_PAGE: 'Заявки: просмотр',
    REQUESTS_APPROVE: 'Заявки: утверждение',
    REQUESTS_ALLOW: 'Заявки: разрешение',

    ORDERS_VIEW_PAGE: 'Наряды: просмотр',

    USERS_VIEW_PAGE: 'Пользователи: просмотр',
    USERS_MANAGE: 'Пользователи: управление',

    ADMIN_ANY: 'Администратор: все права',
}


def to_human_labels(perms: Set[str]) -> list[str]:
    """Convert a set of permission scopes to a sorted list of human-readable labels.

    Unknown scopes are included as-is to help diagnostics.
    """
    labels = []
    for p in perms:
        labels.append(PERMISSION_LABELS.get(p, p))
    # Put admin first if present, then alphabetical
    labels.sort(key=lambda x: (0 if x.startswith('Администратор:') else 1, x))
    return labels

