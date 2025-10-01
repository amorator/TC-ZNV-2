"""Middleware for request/response logging and access control."""

from flask import request, g
from time import time
from modules.logging import log_access, get_logger

_log = get_logger(__name__)


def init_middleware(app):
    """Initialize middleware for the Flask app."""
    
    @app.before_request
    def before_request():
        """Log request start time."""
        g.start_time = time()
    
    @app.after_request
    def after_request(response):
        """Log access after request completion."""
        try:
            # Get request info
            method = request.method
            path = request.path
            status = response.status_code
            user = getattr(g, 'user', None)
            user_name = user.name if user and hasattr(user, 'name') else None
            ip = request.remote_addr
            user_agent = request.headers.get('User-Agent', '')
            duration = time() - g.start_time if hasattr(g, 'start_time') else None
            
            # Log access
            log_access(method, path, status, user_name, ip, user_agent, duration)
            
        except Exception as e:
            _log.exception("Error in access logging: %s", e)
        
        return response
