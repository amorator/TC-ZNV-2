"""Redis-based file metadata caching."""

import hashlib
import json
import os
from typing import Dict, Optional, Any
from modules.logging import get_logger

_log = get_logger(__name__)


class RedisFileCacheManager:
    """Redis-based file metadata caching."""
    
    def __init__(self, redis_client):
        """Initialize file cache manager.
        
        Args:
            redis_client: Redis client instance
        """
        self.redis = redis_client
        self.file_meta_prefix = "znf:file_meta:"
        self.file_etag_prefix = "znf:file_etag:"
        self.cache_ttl = 3600  # 1 hour
    
    def get_file_metadata(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Get cached file metadata.
        
        Args:
            file_path: Path to file
            
        Returns:
            Cached metadata dict or None
        """
        if not self.redis:
            return None
        
        try:
            key = f"{self.file_meta_prefix}{self._hash_path(file_path)}"
            data = self.redis.get(key)
            if data:
                return json.loads(data)
        except Exception as e:
            _log.warning(f"Failed to get file metadata for {file_path}: {e}")
        
        return None
    
    def set_file_metadata(self, file_path: str, metadata: Dict[str, Any]) -> bool:
        """Cache file metadata.
        
        Args:
            file_path: Path to file
            metadata: Metadata to cache
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.file_meta_prefix}{self._hash_path(file_path)}"
            return self.redis.set(key, json.dumps(metadata), ex=self.cache_ttl)
        except Exception as e:
            _log.warning(f"Failed to cache file metadata for {file_path}: {e}")
            return False
    
    def invalidate_file_metadata(self, file_path: str) -> bool:
        """Invalidate cached file metadata.
        
        Args:
            file_path: Path to file
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.file_meta_prefix}{self._hash_path(file_path)}"
            return self.redis.delete(key)
        except Exception as e:
            _log.warning(f"Failed to invalidate file metadata for {file_path}: {e}")
            return False
    
    def get_file_etag(self, file_path: str) -> Optional[str]:
        """Get cached ETag for file.
        
        Args:
            file_path: Path to file
            
        Returns:
            Cached ETag or None
        """
        if not self.redis:
            return None
        
        try:
            key = f"{self.file_etag_prefix}{self._hash_path(file_path)}"
            return self.redis.get(key)
        except Exception as e:
            _log.warning(f"Failed to get ETag for {file_path}: {e}")
            return None
    
    def set_file_etag(self, file_path: str, etag: str) -> bool:
        """Cache ETag for file.
        
        Args:
            file_path: Path to file
            etag: ETag value
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.file_etag_prefix}{self._hash_path(file_path)}"
            return self.redis.set(key, etag, ex=self.cache_ttl)
        except Exception as e:
            _log.warning(f"Failed to cache ETag for {file_path}: {e}")
            return False
    
    def invalidate_file_etag(self, file_path: str) -> bool:
        """Invalidate cached ETag.
        
        Args:
            file_path: Path to file
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.file_etag_prefix}{self._hash_path(file_path)}"
            return self.redis.delete(key)
        except Exception as e:
            _log.warning(f"Failed to invalidate ETag for {file_path}: {e}")
            return False
    
    def generate_etag(self, file_path: str) -> Optional[str]:
        """Generate ETag for file.
        
        Args:
            file_path: Path to file
            
        Returns:
            ETag string or None
        """
        try:
            if not os.path.exists(file_path):
                return None
            
            stat = os.stat(file_path)
            # Use modification time and size for ETag
            etag_data = f"{stat.st_mtime}-{stat.st_size}"
            return f'"{hashlib.md5(etag_data.encode()).hexdigest()}"'
        except Exception as e:
            _log.warning(f"Failed to generate ETag for {file_path}: {e}")
            return None
    
    def get_or_generate_etag(self, file_path: str) -> Optional[str]:
        """Get cached ETag or generate new one.
        
        Args:
            file_path: Path to file
            
        Returns:
            ETag string or None
        """
        # Try to get cached ETag first
        cached_etag = self.get_file_etag(file_path)
        if cached_etag:
            return cached_etag
        
        # Generate new ETag
        etag = self.generate_etag(file_path)
        if etag:
            self.set_file_etag(file_path, etag)
        
        return etag
    
    def _hash_path(self, file_path: str) -> str:
        """Generate hash for file path.
        
        Args:
            file_path: Path to file
            
        Returns:
            Hash string
        """
        return hashlib.md5(file_path.encode()).hexdigest()
    
    def cleanup_expired_cache(self) -> int:
        """Clean up expired cache entries.
        
        Returns:
            Number of entries cleaned up
        """
        if not self.redis:
            return 0
        
        try:
            # Redis TTL handles expiration automatically
            # This method is for future manual cleanup if needed
            return 0
        except Exception as e:
            _log.warning(f"Failed to cleanup expired cache: {e}")
            return 0
