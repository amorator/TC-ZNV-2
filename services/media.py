from os import path, remove, rename
from subprocess import Popen
from typing import Tuple, Any, Optional

from modules.threadpool import ThreadPool


class MediaService:
    """Media conversion service.

    Encapsulates asynchronous video conversion using ffmpeg and notifies
    interested parties (DB and Socket.IO) upon completion.
    """

    def __init__(self, thread_pool: ThreadPool, files_root: str, sql_utils: Any, socketio: Optional[Any] = None) -> None:
        """Initialize media service.

        Args:
            thread_pool: Background thread pool used to offload conversions.
            files_root: Root path for files storage (used by callers for paths).
            sql_utils: Data access layer with required methods (file_ready, order_*, ...).
            socketio: Optional Socket.IO server for broadcasting updates.
        """
        self.thread_pool = thread_pool
        self.files_root = files_root
        self._sql = sql_utils
        self.socketio = socketio

    def convert_async(self, src_path: str, dst_path: str, entity: Tuple[str, int]) -> None:
        """Schedule asynchronous conversion from src to dst for the given entity.

        Args:
            src_path: Path to source file (e.g., .webm)
            dst_path: Path to destination file (e.g., .mp4)
            entity: Tuple of (entity_type, entity_id), where entity_type is 'file'|'order'.
        """
        self.thread_pool.add(self._convert, (src_path, dst_path, entity))

    def _convert(self, args: Tuple[str, str, Tuple[str, int]]) -> None:
        """Worker function executed in background thread to run ffmpeg and post-process.

        Args:
            args: Tuple of (src_path, dst_path, (entity_type, entity_id)).
        """
        old, new, entity = args
        etype, entity_id = entity
        if old == new:
            rename(old, old + '.mp4')
            old += '.mp4'
        process = Popen(["ffmpeg", "-hide_banner", "-y", "-i", old, "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-b:v", "250k", "-vf", "scale=800:600", new], universal_newlines=True)
        out, err = process.communicate()
        if etype == 'file':
            self._sql.file_ready([entity_id])
            # Notify clients about conversion completion
            if self.socketio:
                try:
                    self.socketio.emit('files:changed', {'reason': 'converted', 'id': entity_id}, namespace='/', broadcast=True)
                    # allow the socket server to flush the message in async loop
                    self.socketio.sleep(0)
                except Exception:
                    pass
        elif etype == 'order':
            ord = self._sql.order_by_id([entity_id])
            ord.attachments.remove(path.basename(old))
            ord.attachments.append(path.basename(new))
            self._sql.order_edit_attachments(['|'.join(ord.attachments), entity_id])
        remove(old)

    def stop(self) -> None:
        """Stop media service gracefully.
        
        Waits for all pending conversions to complete.
        """
        try:
            # Wait for thread pool to finish all tasks
            if hasattr(self.thread_pool, 'stop'):
                self.thread_pool.stop()
        except Exception as e:
            print(f'Error stopping media service: {e}')


