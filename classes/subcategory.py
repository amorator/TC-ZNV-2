from typing import Optional
from datetime import datetime as dt


class Subcategory:
    """Domain model for a file subcategory with permissions."""

    def __init__(
        self,
        id: int,
        category_id: int,
        display_name: str,
        folder_name: str,
        display_order: int = 0,
        enabled: int = 1,
        # User permissions
        user_view_own: int = 0,
        user_view_group: int = 0,
        user_view_all: int = 0,
        user_edit_own: int = 0,
        user_edit_group: int = 0,
        user_edit_all: int = 0,
        user_delete_own: int = 0,
        user_delete_group: int = 0,
        user_delete_all: int = 0,
        # Group permissions
        group_view_own: int = 0,
        group_view_group: int = 0,
        group_view_all: int = 0,
        group_edit_own: int = 0,
        group_edit_group: int = 0,
        group_edit_all: int = 0,
        group_delete_own: int = 0,
        group_delete_group: int = 0,
        group_delete_all: int = 0,
        # Upload/Write flags
        user_upload: int = 0,
        group_upload: int = 0,
    ) -> None:
        """Create a subcategory entity.

        Args:
            id: Database id.
            category_id: Parent category ID.
            display_name: Human-friendly subcategory name.
            folder_name: Actual folder name on disk.
            display_order: Order for display (0 = first).
            enabled: 1 if enabled, 0 if disabled.
            user_view_own: User can view own files.
            user_view_group: User can view group files.
            user_view_all: User can view all files.
            user_edit_own: User can edit own files.
            user_edit_group: User can edit group files.
            user_edit_all: User can edit all files.
            user_delete_own: User can delete own files.
            user_delete_group: User can delete group files.
            user_delete_all: User can delete all files.
            group_view_own: Group can view own files.
            group_view_group: Group can view group files.
            group_view_all: Group can view all files.
            group_edit_own: Group can edit own files.
            group_edit_group: Group can edit group files.
            group_edit_all: Group can edit all files.
            group_delete_own: Group can delete own files.
            group_delete_group: Group can delete group files.
            group_delete_all: Group can delete all files.
        """
        self.id: int = id
        self.category_id: int = category_id
        self.display_name: str = display_name
        self.folder_name: str = folder_name
        self.display_order: int = int(display_order or 0)
        self.enabled: int = int(enabled or 1)

        # User permissions
        self.user_view_own: int = int(user_view_own or 0)
        self.user_view_group: int = int(user_view_group or 0)
        self.user_view_all: int = int(user_view_all or 0)
        self.user_edit_own: int = int(user_edit_own or 0)
        self.user_edit_group: int = int(user_edit_group or 0)
        self.user_edit_all: int = int(user_edit_all or 0)
        self.user_delete_own: int = int(user_delete_own or 0)
        self.user_delete_group: int = int(user_delete_group or 0)
        self.user_delete_all: int = int(user_delete_all or 0)

        # Group permissions
        self.group_view_own: int = int(group_view_own or 0)
        self.group_view_group: int = int(group_view_group or 0)
        self.group_view_all: int = int(group_view_all or 0)
        self.group_edit_own: int = int(group_edit_own or 0)
        self.group_edit_group: int = int(group_edit_group or 0)
        self.group_edit_all: int = int(group_edit_all or 0)
        self.group_delete_own: int = int(group_delete_own or 0)
        self.group_delete_group: int = int(group_delete_group or 0)
        self.group_delete_all: int = int(group_delete_all or 0)
        # Upload/Write flags
        self.user_upload: int = int(user_upload or 0)
        self.group_upload: int = int(group_upload or 0)

    @property
    def is_enabled(self) -> bool:
        """Check if subcategory is enabled."""
        return self.enabled == 1

    def has_user_permission(self, action: str, scope: str) -> bool:
        """Check if user has permission for action and scope.
        
        Args:
            action: 'view', 'edit', or 'delete'
            scope: 'own', 'group', or 'all'
            
        Returns:
            bool: True if permission granted
        """
        attr_name = f"user_{action}_{scope}"
        return getattr(self, attr_name, 0) == 1

    def has_group_permission(self, action: str, scope: str) -> bool:
        """Check if group has permission for action and scope.
        
        Args:
            action: 'view', 'edit', or 'delete'
            scope: 'own', 'group', or 'all'
            
        Returns:
            bool: True if permission granted
        """
        attr_name = f"group_{action}_{scope}"
        return getattr(self, attr_name, 0) == 1

    def get_user_permissions(self) -> dict:
        """Get all user permissions as dictionary."""
        return {
            'view_own': self.user_view_own,
            'view_group': self.user_view_group,
            'view_all': self.user_view_all,
            'edit_own': self.user_edit_own,
            'edit_group': self.user_edit_group,
            'edit_all': self.user_edit_all,
            'delete_own': self.user_delete_own,
            'delete_group': self.user_delete_group,
            'delete_all': self.user_delete_all,
            'upload': self.user_upload,
        }

    def get_group_permissions(self) -> dict:
        """Get all group permissions as dictionary."""
        return {
            'view_own': self.group_view_own,
            'view_group': self.group_view_group,
            'view_all': self.group_view_all,
            'edit_own': self.group_edit_own,
            'edit_group': self.group_edit_group,
            'edit_all': self.group_edit_all,
            'delete_own': self.group_delete_own,
            'delete_group': self.group_delete_group,
            'delete_all': self.group_delete_all,
            'upload': self.group_upload,
        }

    def __str__(self) -> str:
        return f"Subcategory(id={self.id}, category_id={self.category_id}, name='{self.display_name}', folder='{self.folder_name}')"

    def __repr__(self) -> str:
        return self.__str__()
