"""Redis client wrapper with connection management and fallback handling."""

import redis
import time
import json
from typing import Any, Optional, Dict, List, Union
from modules.logging import get_logger

_log = get_logger(__name__)


class RedisClient:
    """Redis client with automatic reconnection and fallback handling."""
    
    def __init__(self, config: Dict[str, Any]):
        """Initialize Redis client from config.
        
        Args:
            config: Redis configuration dict with keys: server, port, password, socket, db
        """
        self.config = config
        self.client: Optional[redis.Redis] = None
        self.connected = False
        self.last_error = None
        self._shutdown = False
        self._connect()
    
    def _connect(self) -> bool:
        """Establish Redis connection."""
        try:
            # Prefer unix socket if available
            if self.config.get('socket'):
                if self.config.get('password'):
                    url = f"unix://:{self.config['password']}@{self.config['socket']}?db={self.config.get('db', 0)}"
                else:
                    url = f"unix://{self.config['socket']}?db={self.config.get('db', 0)}"
            else:
                host = self.config.get('server', 'localhost')
                port = self.config.get('port', 6379)
                password = self.config.get('password')
                db = self.config.get('db', 0)
                
                if password:
                    url = f"redis://:{password}@{host}:{port}/{db}"
                else:
                    url = f"redis://{host}:{port}/{db}"
            
            self.client = redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=5)
            
            # Test connection
            self.client.ping()
            self.connected = True
            self.last_error = None
            
            # Mask password in logs
            safe_url = url
            if '://:' in safe_url and '@' in safe_url:
                scheme_end = safe_url.find('://') + 3
                at_pos = safe_url.find('@', scheme_end)
                if at_pos != -1:
                    safe_url = f"{safe_url[:scheme_end]}:***{safe_url[at_pos:]}"
            
            _log.info(f"✅ Redis connected successfully: {safe_url}")
            return True
            
        except Exception as e:
            self.connected = False
            self.last_error = str(e)
            _log.error(f"❌ Redis connection failed: {e}")
            return False
    
    def _ensure_connection(self) -> bool:
        """Ensure Redis connection is active, reconnect if needed."""
        if self._shutdown:
            return False
            
        if not self.connected or not self.client:
            return self._connect()
        
        try:
            self.client.ping()
            return True
        except Exception:
            if not self._shutdown:
                _log.warning("Redis connection lost, attempting to reconnect...")
                return self._connect()
            return False
    
    def shutdown(self):
        """Mark client as shutting down to prevent reconnection attempts."""
        self._shutdown = True
        if self.client:
            try:
                self.client.close()
            except Exception:
                pass
    
    def get(self, key: str) -> Optional[str]:
        """Get value by key with fallback."""
        if not self._ensure_connection():
            return None
        
        try:
            return self.client.get(key)
        except Exception as e:
            _log.warning(f"Redis GET failed for key {key}: {e}")
            return None
    
    def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        """Set value with optional expiration."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.set(key, value, ex=ex))
        except Exception as e:
            _log.warning(f"Redis SET failed for key {key}: {e}")
            return False
    
    def delete(self, key: str) -> bool:
        """Delete key."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.delete(key))
        except Exception as e:
            _log.warning(f"Redis DELETE failed for key {key}: {e}")
            return False
    
    def exists(self, key: str) -> bool:
        """Check if key exists."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.exists(key))
        except Exception as e:
            _log.warning(f"Redis EXISTS failed for key {key}: {e}")
            return False
    
    def expire(self, key: str, seconds: int) -> bool:
        """Set expiration for key."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.expire(key, seconds))
        except Exception as e:
            _log.warning(f"Redis EXPIRE failed for key {key}: {e}")
            return False
    
    def hget(self, name: str, key: str) -> Optional[str]:
        """Get hash field value."""
        if not self._ensure_connection():
            return None
        
        try:
            return self.client.hget(name, key)
        except Exception as e:
            _log.warning(f"Redis HGET failed for {name}:{key}: {e}")
            return None
    
    def hset(self, name: str, key: str, value: str) -> bool:
        """Set hash field value."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.hset(name, key, value))
        except Exception as e:
            _log.warning(f"Redis HSET failed for {name}:{key}: {e}")
            return False
    
    def hgetall(self, name: str) -> Dict[str, str]:
        """Get all hash fields."""
        if not self._ensure_connection():
            return {}
        
        try:
            return self.client.hgetall(name)
        except Exception as e:
            _log.warning(f"Redis HGETALL failed for {name}: {e}")
            return {}
    
    def hdel(self, name: str, key: str) -> bool:
        """Delete hash field."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.hdel(name, key))
        except Exception as e:
            _log.warning(f"Redis HDEL failed for {name}:{key}: {e}")
            return False
    
    def lpush(self, name: str, value: str) -> bool:
        """Push value to list."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.lpush(name, value))
        except Exception as e:
            _log.warning(f"Redis LPUSH failed for {name}: {e}")
            return False
    
    def lrange(self, name: str, start: int, end: int) -> List[str]:
        """Get list range."""
        if not self._ensure_connection():
            return []
        
        try:
            return self.client.lrange(name, start, end)
        except Exception as e:
            _log.warning(f"Redis LRANGE failed for {name}: {e}")
            return []
    
    def ltrim(self, name: str, start: int, end: int) -> bool:
        """Trim list to range."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.ltrim(name, start, end))
        except Exception as e:
            _log.warning(f"Redis LTRIM failed for {name}: {e}")
            return False
    
    def sadd(self, name: str, value: str) -> bool:
        """Add value to set."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.sadd(name, value))
        except Exception as e:
            _log.warning(f"Redis SADD failed for {name}: {e}")
            return False
    
    def srem(self, name: str, value: str) -> bool:
        """Remove value from set."""
        if not self._ensure_connection():
            return False
        
        try:
            return bool(self.client.srem(name, value))
        except Exception as e:
            _log.warning(f"Redis SREM failed for {name}: {e}")
            return False
    
    def smembers(self, name: str) -> set:
        """Get all set members."""
        if not self._ensure_connection():
            return set()
        
        try:
            return self.client.smembers(name)
        except Exception as e:
            _log.warning(f"Redis SMEMBERS failed for {name}: {e}")
            return set()
    
    def pipeline(self):
        """Get Redis pipeline for batch operations."""
        if not self._ensure_connection():
            return None
        
        try:
            return self.client.pipeline()
        except Exception as e:
            _log.warning(f"Redis PIPELINE failed: {e}")
            return None


def init_redis_client(config: Dict[str, Any]) -> Optional[RedisClient]:
    """Initialize Redis client with connection test.
    
    Args:
        config: Redis configuration
        
    Returns:
        RedisClient instance or None if connection failed
    """
    try:
        client = RedisClient(config)
        if client.connected:
            # Test write operation
            test_key = "znf:test:connection"
            if client.set(test_key, "test", ex=10):
                client.delete(test_key)
                _log.info("Redis connection test successful")
                return client
            else:
                _log.error("Redis write test failed")
                return None
        else:
            _log.error("Redis connection failed during initialization")
            return None
    except Exception as e:
        _log.error(f"Redis initialization failed: {e}")
        return None
