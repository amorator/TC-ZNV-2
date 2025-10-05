from os import path, remove, rename
from subprocess import Popen, PIPE
import json
import os
from typing import Tuple, Any, Optional

from modules.threadpool import ThreadPool
from modules.logging import get_logger


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
        try:
            self._log = get_logger(__name__)
        except Exception:
            import logging as _pylog
            self._log = _pylog.getLogger(__name__)

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
        # noisy during normal operation; keep only errors in logs
        
        # Check if source file exists
        if not path.exists(old):
            print(f"Source file not found: {old}")
            if etype == 'file':
                self._sql.file_ready([entity_id])
            return
            
        if old == new:
            # If destination equals source, force a default target extension
            # Default to mp4; audio pipeline below will override when needed
            rename(old, old + '.mp4')
            old += '.mp4'
        # Select conversion pipeline based on target extension
        dst_ext = (os.path.splitext(new)[1] or '').lower()
        if dst_ext == '.m4a':
            # Audio-only: convert to AAC in M4A container
            process = Popen([
                "ffmpeg", "-hide_banner", "-y", "-i", old,
                "-vn",               # drop video
                "-c:a", "aac",
                "-b:a", "192k",
                new
            ], stdout=PIPE, stderr=PIPE, universal_newlines=True)
        else:
            # Video: H.264 in MP4 with scaling/CRF
            process = Popen([
                "ffmpeg", "-hide_banner", "-y", "-i", old,
                "-c:v", "libx264", "-preset", "slow", "-crf", "28",
                "-b:v", "250k", "-vf", "scale=800:600",
                new
            ], stdout=PIPE, stderr=PIPE, universal_newlines=True)
        try:
            out, err = process.communicate(timeout=300)  # 5 minute timeout
            if process.returncode != 0:
                print(f"FFmpeg failed for {old} -> {new}: {err}")
                # Still mark as ready but with error indication
                if etype == 'file':
                    self._sql.file_ready([entity_id])
                return
        except Exception as e:
            print(f"FFmpeg timeout or error for {old} -> {new}: {e}")
            process.kill()
            # Mark as ready even on error to prevent hanging
            if etype == 'file':
                self._sql.file_ready([entity_id])
            return
        # After conversion, probe duration and size (robust ffprobe)
        length_seconds, size_mb = self._probe_length_and_size(new)
        # conversion done; avoid extra info logs
        if etype == 'file':
            self._sql.file_ready([entity_id])
            try:
                self._sql.file_update_metadata([length_seconds, size_mb, entity_id])
                # Ensure DB real_name matches actual target extension (mp4/m4a)
                try:
                    self._sql.file_update_real_name([path.basename(new), entity_id])
                except Exception:
                    pass
            except Exception:
                pass
            # Notify clients about conversion completion
            if self.socketio:
                try:
                    payload = {'reason': 'converted', 'id': entity_id, 'meta': {'length': length_seconds, 'size': size_mb}}
                    # event emitted; avoid verbose logs
                    # Default namespace emit
                    self.socketio.emit('files:changed', payload, broadcast=True)
                    self.socketio.sleep(0)
                    # Also emit with explicit namespace for some clients
                    try:
                        self.socketio.emit('files:changed', payload, namespace='/', broadcast=True)
                    except Exception:
                        pass
                    self.socketio.sleep(0)
                except Exception:
                    try:
                        self._log.exception('MEDIA_EMIT_ERROR id=%s', entity_id)
                    except Exception:
                        pass
                    pass
        elif etype == 'order':
            ord = self._sql.order_by_id([entity_id])
            ord.attachments.remove(path.basename(old))
            ord.attachments.append(path.basename(new))
            self._sql.order_edit_attachments(['|'.join(ord.attachments), entity_id])
        remove(old)

    def _probe_length_and_size(self, target: str) -> Tuple[int, float]:
        """Probe duration (in seconds) and size (in MB) for a media file using robust strategies.

        Tries in order:
        1) Container duration: format.duration
        2) Video stream duration: stream.duration (v:0)
        3) Estimate via nb_frames / r_frame_rate for v:0 (with -count_frames)
        """
        length_seconds = 0
        size_mb: float = 0.0
        # Size
        try:
            size_bytes = os.path.getsize(target)
            size_mb = round(size_bytes / (1024 * 1024), 1) if size_bytes else 0.0
        except Exception:
            pass
        # 1) format.duration
        try:
            p = Popen(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", target], stdout=PIPE, stderr=PIPE, universal_newlines=True)
            sout, _ = p.communicate(timeout=10)
            length_seconds = int(float((sout or '0').strip()) or 0)
        except Exception:
            pass
        # 2) stream.duration
        if not length_seconds:
            try:
                p = Popen(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "default=noprint_wrappers=1:nokey=1", target], stdout=PIPE, stderr=PIPE, universal_newlines=True)
                sout, _ = p.communicate(timeout=10)
                length_seconds = int(float((sout or '0').strip()) or 0)
            except Exception:
                pass
        # 3) nb_frames / r_frame_rate
        if not length_seconds:
            try:
                p = Popen(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames,nb_frames,r_frame_rate", "-of", "json", target], stdout=PIPE, stderr=PIPE, universal_newlines=True)
                sout, _ = p.communicate(timeout=10)
                data = json.loads(sout or '{}')
                frames = 0
                fps = 0.0
                streams = data.get('streams') or []
                if streams:
                    st = streams[0]
                    frames_str = st.get('nb_read_frames') or st.get('nb_frames') or '0'
                    try:
                        frames = int(frames_str)
                    except Exception:
                        frames = int(float(frames_str) or 0)
                    rate_str = st.get('r_frame_rate') or '0/1'
                    try:
                        num, den = rate_str.split('/')
                        den_v = float(den) if float(den) != 0 else 1.0
                        fps = float(num) / den_v
                    except Exception:
                        fps = 0.0
                if frames > 0 and fps > 0:
                    length_seconds = int(frames / fps)
            except Exception:
                pass
        return length_seconds, size_mb

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


