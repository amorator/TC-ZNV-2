from flask_login import current_user
from datetime import datetime as dt
from typing import Optional, List

class File:
    """Domain model for a stored media file entry."""

    def __init__(
        self,
        id: int,
        display_name: str,
        real_name: str,
        path: str,
        owner: str,
        description: str = '',
        date: str = '',
        ready: int = 1,
        viewed: Optional[str] = None,
        note: str = ''
    ) -> None:
        """Create a file entity.

        Args:
            id: Database id.
            display_name: Human-friendly file name.
            real_name: Actual filename on disk (e.g., abc123.mp4).
            path: Directory path where file is stored.
            owner: Owner name.
            description: Optional description (defaults to placeholder).
            date: Creation date string, defaults to now if empty.
            ready: 1 if converted and ready, 0 if in processing.
            viewed: Comma or pipe-delimited string of viewers (backend format).
            note: Optional note.
        """
        self.display_name: str = display_name
        self.real_name: str = real_name
        self.path: str = path
        self.description: str = description if description else 'Нет описания...'
        self.date: str = date if date else dt.now().strftime('%Y-%m-%d %H:%M')
        self.owner: str = owner
        self.id: int = id
        self.ready: int = ready
        self.viewed: Optional[str] = viewed
        self.note: str = note if note else ''
