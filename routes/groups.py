"""
Groups management routes
"""

from flask import render_template, request, redirect, url_for, flash
from flask_login import current_user
from modules.permissions import require_permissions, USERS_VIEW_PAGE, USERS_MANAGE
from modules.logging import get_logger, log_action
from classes.group import Group

_log = get_logger(__name__)


def register(app):
    """Register all `/groups` routes on the provided Flask app.
    
    Args:
        app: The application object providing `route`, `permission_required`, `_sql`, and helpers.
    """
    
    @app.route('/groups', methods=['GET'])
    @require_permissions(USERS_VIEW_PAGE)
    def groups():
        """Render groups management page."""
        try:
            groups = app._sql.group_get_all_objects()
            admin_group_name = app._sql.config.get('admin', 'group', fallback='Программисты')
            # Pre-compute user counts per group in one query
            try:
                prefix = app._sql.config['db']['prefix']
                rows = app._sql.execute_query(f"SELECT gid, COUNT(*) as cnt FROM {prefix}_user GROUP BY gid;")
                gid_to_count = {row[0]: row[1] for row in rows} if rows else {}
            except Exception:
                gid_to_count = {}
            # Update groups with admin group name for system group detection
            for group in groups:
                group._admin_group_name = admin_group_name
                try:
                    group.user_count = int(gid_to_count.get(group.id, 0))
                except Exception:
                    group.user_count = 0
            return render_template('groups.j2.html', title='Группы — Заявки-Наряды-Видео', groups=groups, admin_group_name=admin_group_name)
        except Exception as e:
            app.flash_error(e)
            _log.error(f"Groups page error: {e}")
            return render_template('groups.j2.html', title='Группы — Заявки-Наряды-Видео', groups=[], admin_group_name='Программисты')
    
    @app.route('/groups/add', methods=['POST'])
    @require_permissions(USERS_MANAGE)
    def groups_add():
        """Add new group."""
        try:
            name = request.form.get('name', '').strip()
            description = request.form.get('description', '').strip()
            
            if not name:
                raise ValueError('Название группы не может быть пустым')
            
            # Check if group already exists
            if app._sql.group_exists([name]):
                raise ValueError('Группа с таким названием уже существует')
            
            # Add group
            group_id = app._sql.group_add([name, description])
            log_action('GROUP_ADD', current_user.name, f'added group {name} (id={group_id})', request.remote_addr)
            
            # Return JSON for AJAX requests, redirect for traditional forms
            if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'success', 'message': 'Группа добавлена успешно'}, 200
            return redirect(url_for('groups'))
            
        except Exception as e:
            app.flash_error(e)
            log_action('GROUP_ADD', current_user.name, f'failed to add group {name}: {str(e)}', request.remote_addr, success=False)
            
            if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'error', 'message': str(e)}, 400
            return redirect(url_for('groups'))
    
    @app.route('/groups/edit/<int:id>', methods=['POST'])
    @require_permissions(USERS_MANAGE)
    def groups_edit(id):
        """Edit group."""
        try:
            name = request.form.get('name', '').strip()
            description = request.form.get('description', '').strip()
            
            if not name:
                raise ValueError('Название группы не может быть пустым')
            
            # Check if group exists
            group_data = app._sql.group_by_id([id])
            if not group_data:
                raise ValueError('Группа не найдена')
            
            old_name = group_data[1]
            admin_group_name = app._sql.config.get('admin', 'group', fallback='Программисты')
            
            # Check if this is the admin group and prevent name changes
            if old_name.lower() == admin_group_name.lower():
                raise ValueError('Название системной группы нельзя изменять')
            
            # Check if another group with same name exists (case-insensitive)
            if app._sql.group_exists_except([name, id]):
                raise ValueError('Группа с таким названием уже существует')
            
            # Update group
            app._sql.group_edit([name, description, id])
            log_action('GROUP_EDIT', current_user.name, f'edited group {name} (id={id})', request.remote_addr)
            
            # Return JSON for AJAX requests, redirect for traditional forms
            if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'success', 'message': 'Группа обновлена успешно'}, 200
            return redirect(url_for('groups'))
            
        except Exception as e:
            app.flash_error(e)
            log_action('GROUP_EDIT', current_user.name, f'failed to edit group (id={id}): {str(e)}', request.remote_addr, success=False)
            
            if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'error', 'message': str(e)}, 400
            return redirect(url_for('groups'))
    
    @app.route('/groups/delete/<int:id>', methods=['POST'])
    @require_permissions(USERS_MANAGE)
    def groups_delete(id):
        """Delete group."""
        try:
            # Check if group exists
            group_data = app._sql.group_by_id([id])
            if not group_data:
                raise ValueError('Группа не найдена')
            
            group_name = group_data[1]
            admin_group_name = app._sql.config.get('admin', 'group', fallback='Программисты')
            
            # Check if group is system group (ID 1 or admin group from config)
            if id == 1 or group_name.lower() == admin_group_name.lower():
                raise ValueError('Системную группу нельзя удалить')
            
            # Check if group has users
            user_count = app._sql.execute_scalar(f"SELECT COUNT(*) FROM {app._sql.config['db']['prefix']}_user WHERE gid = %s;", [id])
            if user_count and user_count[0] > 0:
                raise ValueError('Нельзя удалить группу, в которой есть пользователи')
            
            # Delete group
            app._sql.group_delete([id])
            log_action('GROUP_DELETE', current_user.name, f'deleted group {group_name} (id={id})', request.remote_addr)
            
            # Return JSON for AJAX requests, redirect for traditional forms
            if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'success', 'message': 'Группа удалена успешно'}, 200
            return redirect(url_for('groups'))
            
        except Exception as e:
            app.flash_error(e)
            log_action('GROUP_DELETE', current_user.name, f'failed to delete group (id={id}): {str(e)}', request.remote_addr, success=False)
            
            if request.headers.get('Content-Type') == 'application/json' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return {'status': 'error', 'message': str(e)}, 400
            return redirect(url_for('groups'))

