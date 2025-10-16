"""Redis-based upload metadata management."""

import json
import time
from typing import Dict, Optional, Any, List
from modules.logging import get_logger

_log = get_logger(__name__)


class RedisUploadManager:
    """Redis-based upload metadata management."""
    
    def __init__(self, redis_client):
        """Initialize upload manager.
        
        Args:
            redis_client: Redis client instance
        """
        self.redis = redis_client
        self.upload_prefix = "znf:upload:"
        self.upload_ttl = 3600  # 1 hour
    
    def create_upload_session(self, upload_id: str, user_id: int, 
                             file_name: str, file_size: int, 
                             upload_type: str = "file") -> bool:
        """Create new upload session.
        
        Args:
            upload_id: Unique upload session ID
            user_id: User ID performing upload
            file_name: Name of file being uploaded
            file_size: Size of file in bytes
            upload_type: Type of upload (file, chunk, etc.)
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            now = int(time.time())
            upload_data = {
                'upload_id': upload_id,
                'user_id': user_id,
                'file_name': file_name,
                'file_size': file_size,
                'upload_type': upload_type,
                'status': 'started',
                'created_at': now,
                'updated_at': now,
                'chunks_received': 0,
                'total_chunks': 0,
                'bytes_received': 0
            }
            
            key = f"{self.upload_prefix}{upload_id}"
            return self.redis.set(key, json.dumps(upload_data), ex=self.upload_ttl)
        except Exception as e:
            _log.warning(f"Failed to create upload session {upload_id}: {e}")
            return False
    
    def update_upload_progress(self, upload_id: str, chunks_received: int = None,
                              bytes_received: int = None, status: str = None) -> bool:
        """Update upload progress.
        
        Args:
            upload_id: Upload session ID
            chunks_received: Number of chunks received
            bytes_received: Number of bytes received
            status: New status
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.upload_prefix}{upload_id}"
            data = self.redis.get(key)
            if not data:
                return False
            
            upload_data = json.loads(data)
            now = int(time.time())
            
            if chunks_received is not None:
                upload_data['chunks_received'] = chunks_received
            if bytes_received is not None:
                upload_data['bytes_received'] = bytes_received
            if status is not None:
                upload_data['status'] = status
            
            upload_data['updated_at'] = now
            
            return self.redis.set(key, json.dumps(upload_data), ex=self.upload_ttl)
        except Exception as e:
            _log.warning(f"Failed to update upload progress for {upload_id}: {e}")
            return False
    
    def get_upload_session(self, upload_id: str) -> Optional[Dict[str, Any]]:
        """Get upload session data.
        
        Args:
            upload_id: Upload session ID
            
        Returns:
            Upload session data or None
        """
        if not self.redis:
            return None
        
        try:
            key = f"{self.upload_prefix}{upload_id}"
            data = self.redis.get(key)
            if data:
                return json.loads(data)
        except Exception as e:
            _log.warning(f"Failed to get upload session {upload_id}: {e}")
        
        return None
    
    def complete_upload(self, upload_id: str, final_file_path: str = None) -> bool:
        """Mark upload as completed.
        
        Args:
            upload_id: Upload session ID
            final_file_path: Path to final file
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.upload_prefix}{upload_id}"
            data = self.redis.get(key)
            if not data:
                return False
            
            upload_data = json.loads(data)
            now = int(time.time())
            
            upload_data['status'] = 'completed'
            upload_data['updated_at'] = now
            if final_file_path:
                upload_data['final_file_path'] = final_file_path
            
            return self.redis.set(key, json.dumps(upload_data), ex=self.upload_ttl)
        except Exception as e:
            _log.warning(f"Failed to complete upload {upload_id}: {e}")
            return False
    
    def fail_upload(self, upload_id: str, error_message: str = None) -> bool:
        """Mark upload as failed.
        
        Args:
            upload_id: Upload session ID
            error_message: Error message
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.upload_prefix}{upload_id}"
            data = self.redis.get(key)
            if not data:
                return False
            
            upload_data = json.loads(data)
            now = int(time.time())
            
            upload_data['status'] = 'failed'
            upload_data['updated_at'] = now
            if error_message:
                upload_data['error_message'] = error_message
            
            return self.redis.set(key, json.dumps(upload_data), ex=self.upload_ttl)
        except Exception as e:
            _log.warning(f"Failed to mark upload {upload_id} as failed: {e}")
            return False
    
    def delete_upload_session(self, upload_id: str) -> bool:
        """Delete upload session.
        
        Args:
            upload_id: Upload session ID
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.upload_prefix}{upload_id}"
            return self.redis.delete(key)
        except Exception as e:
            _log.warning(f"Failed to delete upload session {upload_id}: {e}")
            return False
    
    def get_user_uploads(self, user_id: int) -> List[Dict[str, Any]]:
        """Get all uploads for a user.
        
        Args:
            user_id: User ID
            
        Returns:
            List of upload sessions
        """
        if not self.redis:
            return []
        
        try:
            pattern = f"{self.upload_prefix}*"
            keys = self.redis.client.keys(pattern) if self.redis.client else []
            user_uploads = []
            
            for key in keys:
                try:
                    data = self.redis.get(key)
                    if data:
                        upload_data = json.loads(data)
                        if upload_data.get('user_id') == user_id:
                            user_uploads.append(upload_data)
                except Exception:
                    continue
            
            # Sort by creation time
            user_uploads.sort(key=lambda x: x.get('created_at', 0), reverse=True)
            return user_uploads
            
        except Exception as e:
            _log.warning(f"Failed to get uploads for user {user_id}: {e}")
            return []
    
    def cleanup_expired_uploads(self) -> int:
        """Clean up expired upload sessions.
        
        Returns:
            Number of sessions cleaned up
        """
        if not self.redis:
            return 0
        
        try:
            # Redis TTL handles expiration automatically
            # This method is for future manual cleanup if needed
            return 0
        except Exception as e:
            _log.warning(f"Failed to cleanup expired uploads: {e}")
            return 0
