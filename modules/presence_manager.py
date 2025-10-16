"""Redis-based presence tracking."""

import time
import json
from typing import Dict, List, Optional, Any
from modules.logging import get_logger

_log = get_logger(__name__)


class RedisPresenceManager:
    """Redis-based presence tracking manager."""
    
    def __init__(self, redis_client):
        """Initialize presence manager.
        
        Args:
            redis_client: Redis client instance
        """
        self.redis = redis_client
        self.presence_prefix = "znf:presence:"
        self.heartbeat_prefix = "znf:presence_hb:"
        self.stale_threshold = 8  # seconds
    
    def update_presence(self, sid: str, user_id: int, user_name: str, 
                       ip: str, page: str, user_agent: str) -> bool:
        """Update user presence.
        
        Args:
            sid: Socket.IO session ID
            user_id: User ID
            user_name: User name
            ip: Client IP address
            page: Current page
            user_agent: User agent string
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            now = int(time.time())
            presence_data = {
                'user_id': user_id,
                'user': user_name,
                'ip': ip,
                'page': page,
                'ua': user_agent,
                'updated_at': now
            }
            
            key = f"{self.presence_prefix}{sid}"
            self.redis.set(key, json.dumps(presence_data), ex=self.stale_threshold + 10)
            return True
            
        except Exception as e:
            _log.warning(f"Failed to update presence for {sid}: {e}")
            return False
    
    def update_heartbeat(self, user_id: int, ip: str, page: str, user_agent: str) -> bool:
        """Update heartbeat-based presence.
        
        Args:
            user_id: User ID
            ip: Client IP address
            page: Current page
            user_agent: User agent string
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            now = int(time.time())
            heartbeat_data = {
                'user_id': user_id,
                'ip': ip,
                'page': page,
                'ua': user_agent,
                'updated_at': now
            }
            
            key = f"{self.heartbeat_prefix}{user_id}:{ip}"
            self.redis.set(key, json.dumps(heartbeat_data), ex=self.stale_threshold + 10)
            return True
            
        except Exception as e:
            _log.warning(f"Failed to update heartbeat for user {user_id}: {e}")
            return False
    
    def remove_presence(self, sid: str) -> bool:
        """Remove presence entry.
        
        Args:
            sid: Socket.IO session ID
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            key = f"{self.presence_prefix}{sid}"
            return self.redis.delete(key)
        except Exception as e:
            _log.warning(f"Failed to remove presence for {sid}: {e}")
            return False
    
    def remove_user_presence(self, user_id: int) -> bool:
        """Remove all presence entries for a user.
        
        Args:
            user_id: User ID
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            # Remove socket-based presence
            pattern = f"{self.presence_prefix}*"
            keys = self.redis.client.keys(pattern) if self.redis.client else []
            removed_count = 0
            
            for key in keys:
                try:
                    data = self.redis.get(key)
                    if data:
                        presence_data = json.loads(data)
                        if presence_data.get('user_id') == user_id:
                            if self.redis.delete(key):
                                removed_count += 1
                except Exception:
                    continue
            
            # Remove heartbeat-based presence
            hb_pattern = f"{self.heartbeat_prefix}{user_id}:*"
            hb_keys = self.redis.client.keys(hb_pattern) if self.redis.client else []
            for key in hb_keys:
                if self.redis.delete(key):
                    removed_count += 1
            
            _log.debug(f"Removed {removed_count} presence entries for user {user_id}")
            return True
            
        except Exception as e:
            _log.warning(f"Failed to remove presence for user {user_id}: {e}")
            return False
    
    def get_active_presence(self) -> List[Dict[str, Any]]:
        """Get all active presence entries.
        
        Returns:
            List of active presence entries
        """
        if not self.redis:
            return []
        
        try:
            now = int(time.time())
            stale_cutoff = now - self.stale_threshold
            active_entries = []
            
            # Get socket-based presence
            pattern = f"{self.presence_prefix}*"
            keys = self.redis.client.keys(pattern) if self.redis.client else []
            
            for key in keys:
                try:
                    data = self.redis.get(key)
                    if data:
                        presence_data = json.loads(data)
                        updated_at = presence_data.get('updated_at', 0)
                        
                        if updated_at >= stale_cutoff:
                            presence_data['sid'] = key.replace(self.presence_prefix, '')
                            active_entries.append(presence_data)
                except Exception:
                    continue
            
            # Get heartbeat-based presence
            hb_pattern = f"{self.heartbeat_prefix}*"
            hb_keys = self.redis.client.keys(hb_pattern) if self.redis.client else []
            
            for key in hb_keys:
                try:
                    data = self.redis.get(key)
                    if data:
                        heartbeat_data = json.loads(data)
                        updated_at = heartbeat_data.get('updated_at', 0)
                        
                        if updated_at >= stale_cutoff:
                            heartbeat_data['sid'] = key.replace(self.heartbeat_prefix, '')
                            active_entries.append(heartbeat_data)
                except Exception:
                    continue
            
            # Deduplicate by user_id+ip+ua, keeping freshest entry
            unique_entries = {}
            for entry in active_entries:
                uid = entry.get('user_id')
                ip = (entry.get('ip') or '').strip()
                ua = (entry.get('ua') or '').strip()[:64]  # Limit UA length
                key = f"{uid or 'unknown'}:{ip}:{ua}"
                
                prev = unique_entries.get(key)
                if not prev or entry.get('updated_at', 0) >= prev.get('updated_at', 0):
                    unique_entries[key] = entry
            
            result = list(unique_entries.values())
            result.sort(key=lambda x: x.get('updated_at', 0), reverse=True)
            return result
            
        except Exception as e:
            _log.warning(f"Failed to get active presence: {e}")
            return []
    
    def cleanup_stale_presence(self) -> int:
        """Clean up stale presence entries.
        
        Returns:
            Number of entries cleaned up
        """
        if not self.redis:
            return 0
        
        try:
            now = int(time.time())
            stale_cutoff = now - self.stale_threshold
            cleaned_count = 0
            
            # Clean socket-based presence
            pattern = f"{self.presence_prefix}*"
            keys = self.redis.client.keys(pattern) if self.redis.client else []
            
            for key in keys:
                try:
                    data = self.redis.get(key)
                    if data:
                        presence_data = json.loads(data)
                        updated_at = presence_data.get('updated_at', 0)
                        
                        if updated_at < stale_cutoff:
                            if self.redis.delete(key):
                                cleaned_count += 1
                except Exception:
                    continue
            
            # Clean heartbeat-based presence
            hb_pattern = f"{self.heartbeat_prefix}*"
            hb_keys = self.redis.client.keys(hb_pattern) if self.redis.client else []
            
            for key in hb_keys:
                try:
                    data = self.redis.get(key)
                    if data:
                        heartbeat_data = json.loads(data)
                        updated_at = heartbeat_data.get('updated_at', 0)
                        
                        if updated_at < stale_cutoff:
                            if self.redis.delete(key):
                                cleaned_count += 1
                except Exception:
                    continue
            
            if cleaned_count > 0:
                _log.debug(f"Cleaned up {cleaned_count} stale presence entries")
            
            return cleaned_count
            
        except Exception as e:
            _log.warning(f"Failed to cleanup stale presence: {e}")
            return 0
