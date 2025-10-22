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
        file_name: str,
        owner: str,
        description: str = '',
        created_at: str = '',
        ready: int = 1,
        viewed: Optional[str] = None,
        note: str = '',
        length_seconds: int = 0,
        size_mb: float = 0.0,
        order_id: Optional[int] = None,
        category_id: Optional[int] = None,
        subcategory_id: Optional[int] = None,
        file_exists: bool = True,
    ) -> None:
        """Create a file entity.

		Args:
			id: Database id.
			display_name: Human-friendly file name.
			file_name: Actual filename on disk (e.g., abc123.mp4).
			owner: Owner name.
			description: Optional description (defaults to placeholder).
			created_at: Creation date string, defaults to now if empty.
			ready: 1 if converted and ready, 0 if in processing.
			viewed: Comma or pipe-delimited string of viewers (backend format).
			note: Optional note.
			order_id: Optional ID of associated order (foreign key).
			category_id: Category ID for file organization.
			subcategory_id: Subcategory ID for file organization.
			file_exists: Whether the file exists on disk.
		"""
        self.display_name: str = display_name
        self.file_name: str = file_name
        self.description: str = description if description else 'Нет описания...'
        self.created_at: str = created_at if created_at else dt.now().strftime(
            '%Y-%m-%d %H:%M')
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
        self.order_id: Optional[int] = order_id
        self.category_id: Optional[int] = category_id
        self.subcategory_id: Optional[int] = subcategory_id
        self.exists: bool = bool(file_exists)

        # Legacy compatibility - will be computed dynamically
        self.real_name: str = file_name
        self.path: str = ""  # Will be computed when needed

    def _get_storage_path(self) -> str:
        """Get the storage path for this file based on category/subcategory."""
        try:
            # Try to get SQLUtils from Flask app context first
            from flask import current_app
            if hasattr(current_app, '_sql'):
                return current_app._sql.get_file_storage_path(
                    self.category_id, self.subcategory_id)
        except Exception:
            pass

        try:
            from modules.SQLUtils import SQLUtils
            # We need to get the SQLUtils instance to compute the path
            # This is a bit of a hack, but necessary for the File class to work independently
            import os
            config_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)), 'config.ini')
            if os.path.exists(config_path):
                sql_utils = SQLUtils(config_path)
                return sql_utils.get_file_storage_path(self.category_id,
                                                       self.subcategory_id)
            else:
                # Fallback to default path
                return "/mnt/files/znf/files"
        except Exception:
            return "/mnt/files/znf/files"

    def _check_file_exists(self) -> bool:
        """Check if the file exists on disk (prefer converted mp4, fallback to webm)."""
        try:
            # Get the storage path for this file
            storage_path = self._get_storage_path()

            # Determine target media path: prefer converted mp4, fallback to original webm
            base = os.path.join(storage_path,
                                os.path.splitext(self.file_name)[0])
            target = os.path.join(storage_path, self.file_name)

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
            # Get the storage path for this file
            storage_path = self._get_storage_path()

            base = os.path.join(storage_path,
                                os.path.splitext(self.file_name)[0])
            target = os.path.join(storage_path, self.file_name)

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
            return os.path.join(storage_path, self.file_name)

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

    @property
    def media_type(self) -> str:
        """Determine if file is video or audio based on extension."""
        if not self.file_name:
            return 'Неизвестно'

        ext = os.path.splitext(self.file_name.lower())[1]

        # Audio extensions
        audio_extensions = {
            '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.oga', '.wma',
            '.mka', '.opus'
        }
        # Video extensions
        video_extensions = {
            '.mp4', '.webm', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.m4v',
            '.3gp', '.ts', '.mts'
        }

        if ext in audio_extensions:
            return 'Аудио'
        elif ext in video_extensions:
            return 'Видео'
        else:
            return 'Неизвестно'

    @property
    def exists_status_message(self) -> str:
        """Return status message based on file existence."""
        if not self.exists:
            return '<span style="color: #dc3545; font-style: italic;">⚠️ Файл не найден на диске</span>'
        return ''
