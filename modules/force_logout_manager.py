"""Redis-based force logout management."""

from typing import Set
from modules.logging import get_logger

_log = get_logger(__name__)


class RedisForceLogoutManager:
    """Redis-based force logout management."""
    
    def __init__(self, redis_client):
        """Initialize force logout manager.
        
        Args:
            redis_client: Redis client instance
        """
        self.redis = redis_client
        self.users_key = "znf:force_logout:users"
        self.sessions_key = "znf:force_logout:sessions"
    
    def add_user_logout(self, user_id: int) -> bool:
        """Add user to force logout list.
        
        Args:
            user_id: User ID to force logout
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            return self.redis.client.sadd(self.users_key, str(user_id))
        except Exception as e:
            _log.warning(f"Failed to add user {user_id} to force logout: {e}")
            return False
    
    def add_session_logout(self, session_id: str) -> bool:
        """Add session to force logout list.
        
        Args:
            session_id: Session ID to force logout
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            return self.redis.client.sadd(self.sessions_key, session_id)
        except Exception as e:
            _log.warning(f"Failed to add session {session_id} to force logout: {e}")
            return False
    
    def remove_user_logout(self, user_id: int) -> bool:
        """Remove user from force logout list.
        
        Args:
            user_id: User ID to remove
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            return self.redis.client.srem(self.users_key, str(user_id))
        except Exception as e:
            _log.warning(f"Failed to remove user {user_id} from force logout: {e}")
            return False
    
    def remove_session_logout(self, session_id: str) -> bool:
        """Remove session from force logout list.
        
        Args:
            session_id: Session ID to remove
            
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            return self.redis.client.srem(self.sessions_key, session_id)
        except Exception as e:
            _log.warning(f"Failed to remove session {session_id} from force logout: {e}")
            return False
    
    def is_user_forced_logout(self, user_id: int) -> bool:
        """Check if user is in force logout list.
        
        Args:
            user_id: User ID to check
            
        Returns:
            True if user should be logged out, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            return self.redis.client.sismember(self.users_key, str(user_id))
        except Exception as e:
            _log.warning(f"Failed to check force logout for user {user_id}: {e}")
            return False
    
    def is_session_forced_logout(self, session_id: str) -> bool:
        """Check if session is in force logout list.
        
        Args:
            session_id: Session ID to check
            
        Returns:
            True if session should be logged out, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            return self.redis.client.sismember(self.sessions_key, session_id)
        except Exception as e:
            _log.warning(f"Failed to check force logout for session {session_id}: {e}")
            return False
    
    def get_forced_logout_users(self) -> Set[str]:
        """Get all users in force logout list.
        
        Returns:
            Set of user IDs
        """
        if not self.redis:
            return set()
        
        try:
            return self.redis.client.smembers(self.users_key)
        except Exception as e:
            _log.warning(f"Failed to get forced logout users: {e}")
            return set()
    
    def get_forced_logout_sessions(self) -> Set[str]:
        """Get all sessions in force logout list.
        
        Returns:
            Set of session IDs
        """
        if not self.redis:
            return set()
        
        try:
            return self.redis.client.smembers(self.sessions_key)
        except Exception as e:
            _log.warning(f"Failed to get forced logout sessions: {e}")
            return set()
    
    def clear_all_logouts(self) -> bool:
        """Clear all force logout entries.
        
        Returns:
            True if successful, False otherwise
        """
        if not self.redis:
            return False
        
        try:
            users_deleted = self.redis.client.delete(self.users_key)
            sessions_deleted = self.redis.client.delete(self.sessions_key)
            _log.info(f"Cleared force logout entries: {users_deleted} users, {sessions_deleted} sessions")
            return True
        except Exception as e:
            _log.warning(f"Failed to clear force logout entries: {e}")
            return False
