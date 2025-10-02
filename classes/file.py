from flask_login import current_user
from datetime import datetime as dt
from typing import Optional, List
import os

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
        note: str = '',
        length_seconds: int = 0,
        size_mb: float = 0.0,
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
        self.length_seconds: int = int(length_seconds or 0)
        try:
            self.size_mb: float = float(size_mb or 0)
        except Exception:
            self.size_mb = 0.0
        
        # Check if file exists on disk
        self.exists: bool = self._check_file_exists()

    def _check_file_exists(self) -> bool:
        """Check if the file exists on disk (prefer converted mp4, fallback to webm)."""
        try:
            # Determine target media path: prefer converted mp4, fallback to original webm
            base = os.path.join(self.path, os.path.splitext(self.real_name)[0])
            target = os.path.join(self.path, self.real_name)
            
            # For processing files (ready=0), check original webm first
            if self.ready == 0:
                webm_target = base + '.webm'
                if os.path.exists(webm_target):
                    return True
                # Also check if converted mp4 exists (conversion might be complete)
                return os.path.exists(target)
            else:
                # For ready files, check converted mp4 first, fallback to webm
                if not os.path.exists(target):
                    target = base + '.webm'
                return os.path.exists(target)
        except Exception:
            return False

    def update_exists_status(self) -> None:
        """Update the exists status by re-checking the file on disk."""
        self.exists = self._check_file_exists()

    def get_file_path(self) -> str:
        """Get the appropriate file path for the current state (webm for processing, mp4 for ready)."""
        try:
            base = os.path.join(self.path, os.path.splitext(self.real_name)[0])
            target = os.path.join(self.path, self.real_name)
            
            # For processing files (ready=0), prefer webm
            if self.ready == 0:
                webm_target = base + '.webm'
                if os.path.exists(webm_target):
                    return webm_target
                # Fallback to mp4 if webm doesn't exist but mp4 does
                if os.path.exists(target):
                    return target
                return webm_target  # Return webm path even if it doesn't exist
            else:
                # For ready files, prefer mp4, fallback to webm
                if os.path.exists(target):
                    return target
                return base + '.webm'
        except Exception:
            return os.path.join(self.path, self.real_name)

    @property
    def length_human(self) -> str:
        """Human readable duration like H:MM:SS or M:SS; dash if unknown."""
        total = int(self.length_seconds or 0)
        if total <= 0:
            return '—'
        h = total // 3600
        m = (total % 3600) // 60
        s = total % 60
        if h > 0:
            return f"{h}:{m:02d}:{s:02d}"
        return f"{m}:{s:02d}"

    @property
    def size_human(self) -> str:
        """Human readable size in megabytes with one decimal; dash if unknown."""
        val = float(self.size_mb or 0)
        if val <= 0:
            return '—'
        return f"{val:.1f} МБ"
