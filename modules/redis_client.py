"""Redis client wrapper with connection management and fallback handling."""

import redis
import time
import json
from typing import Any, Optional, Dict, List, Union, Set, TypeVar, Callable, cast
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
    
    # --- Internal helper to deduplicate guards/try/except ---
    T = TypeVar('T')
    def _call(self, func: Callable[[redis.Redis], T], default: T) -> T:
        if not self._ensure_connection():
            return default
        try:
            client = self.client
            if client is None:
                return default
            return func(client)
        except Exception as e:
            _log.warning(f"Redis call failed: {e}")
            return default

    def shutdown(self):
        """Mark client as shutting down to prevent reconnection attempts."""
        self._shutdown = True
        if self.client:
            try:
                self.client.close()
            except Exception:
                pass
    
    def get(self, key: str) -> Optional[Any]:
        """Get value by key with fallback."""
        return self._call(lambda c: c.get(key), None)
    
    def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        """Set value with optional expiration."""
        return self._call(lambda c: bool(c.set(key, value, ex=ex)), False)
    
    def delete(self, key: str) -> bool:
        """Delete key."""
        return self._call(lambda c: bool(c.delete(key)), False)
    
    def exists(self, key: str) -> bool:
        """Check if key exists."""
        return self._call(lambda c: bool(c.exists(key)), False)
    
    def expire(self, key: str, seconds: int) -> bool:
        """Set expiration for key."""
        return self._call(lambda c: bool(c.expire(key, seconds)), False)
    
    def hget(self, name: str, key: str) -> Optional[Any]:
        """Get hash field value."""
        return self._call(lambda c: c.hget(name, key), None)
    
    def hset(self, name: str, key: str, value: str) -> bool:
        """Set hash field value."""
        return self._call(lambda c: bool(c.hset(name, key, value)), False)
    
    def hgetall(self, name: str) -> Dict[str, Any]:
        """Get all hash fields."""
        result = self._call(lambda c: c.hgetall(name), {}) or {}
        return cast(Dict[str, Any], result)
    
    def hdel(self, name: str, key: str) -> bool:
        """Delete hash field."""
        return self._call(lambda c: bool(c.hdel(name, key)), False)
    
    def lpush(self, name: str, value: str) -> bool:
        """Push value to list."""
        return self._call(lambda c: bool(c.lpush(name, value)), False)
    
    def lrange(self, name: str, start: int, end: int) -> List[Any]:
        """Get list range."""
        data = self._call(lambda c: c.lrange(name, start, end), [])
        if isinstance(data, list):
            return cast(List[Any], data)
        return []
    
    def ltrim(self, name: str, start: int, end: int) -> bool:
        """Trim list to range."""
        return self._call(lambda c: bool(c.ltrim(name, start, end)), False)
    
    def sadd(self, name: str, value: str) -> bool:
        """Add value to set."""
        return self._call(lambda c: bool(c.sadd(name, value)), False)
    
    def srem(self, name: str, value: str) -> bool:
        """Remove value from set."""
        return self._call(lambda c: bool(c.srem(name, value)), False)
    
    def smembers(self, name: str) -> Set[Any]:
        """Get all set members."""
        data = self._call(lambda c: c.smembers(name), set())
        if isinstance(data, set):
            return cast(Set[Any], data)
        return set()
    
    def pipeline(self):
        """Get Redis pipeline for batch operations."""
        return self._call(lambda c: c.pipeline(), None)


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
                return client
            else:
                return None
        else:
            return None
    except Exception:
        return None
