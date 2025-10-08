from typing import Optional
from datetime import datetime as dt

class Category:
    """Domain model for a file category."""

    def __init__(
        self,
        id: int,
        display_name: str,
        folder_name: str,
        display_order: int = 0,
        enabled: int = 1,
    ) -> None:
        """Create a category entity.

        Args:
            id: Database id.
            display_name: Human-friendly category name.
            folder_name: Actual folder name on disk.
            display_order: Order for display (0 = first).
            enabled: 1 if enabled, 0 if disabled.
        """
        self.id: int = id
        self.display_name: str = display_name
        self.folder_name: str = folder_name
        self.display_order: int = int(display_order or 0)
        self.enabled: int = int(enabled or 1)

    @property
    def is_enabled(self) -> bool:
        """Check if category is enabled."""
        return self.enabled == 1

    def __str__(self) -> str:
        return f"Category(id={self.id}, name='{self.display_name}', folder='{self.folder_name}')"

    def __repr__(self) -> str:
        return self.__str__()

