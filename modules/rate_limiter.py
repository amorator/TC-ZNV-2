"""Redis-based rate limiting decorator."""

import time
from functools import wraps
from flask import request, jsonify, flash, redirect, url_for
from modules.logging import get_logger

_log = get_logger(__name__)


def redis_rate_limit(max_calls: int = 60, window_sec: int = 60, redis_client=None):
    """Redis-based rate limiting decorator.
    
    Args:
        max_calls: Maximum number of calls allowed in window
        window_sec: Time window in seconds
        redis_client: Redis client instance
        
    Returns:
        Decorator function
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not redis_client:
                # Fallback to no rate limiting if Redis unavailable
                return fn(*args, **kwargs)
            
            try:
                # Create rate limit key: IP + endpoint
                client_ip = request.remote_addr or 'unknown'
                endpoint = fn.__name__
                key = f"znf:rate_limit:{client_ip}:{endpoint}"
                
                now = time.time()
                window_start = now - window_sec
                
                # Use Redis pipeline for atomic operations
                pipe = redis_client.pipeline()
                if pipe:
                    # Remove old entries
                    pipe.zremrangebyscore(key, 0, window_start)
                    # Add current request
                    pipe.zadd(key, {str(now): now})
                    # Count current requests
                    pipe.zcard(key)
                    # Set expiration
                    pipe.expire(key, window_sec + 10)
                    
                    results = pipe.execute()
                    if results and len(results) >= 3:
                        current_count = results[2] or 0
                        
                        if current_count > max_calls:
                            _log.warning(f"Rate limit exceeded for {client_ip}:{endpoint} ({current_count}/{max_calls})")

                            # For login endpoint, avoid redirects to break potential loops
                            if endpoint == 'login':
                                # Prefer JSON if requested
                                accept = request.headers.get('Accept', '')
                                if 'application/json' in accept:
                                    return jsonify({'error': 'Слишком много попыток входа, попробуйте позже'}), 429
                                # Minimal HTML/text response to stop redirect chains
                                return (
                                    'Слишком много попыток входа, попробуйте позже',
                                    429,
                                    {'Content-Type': 'text/plain; charset=utf-8'}
                                )

                            # Check if client expects JSON response
                            if request.headers.get('Accept', '').find('application/json') != -1:
                                return jsonify({
                                    'error': 'Слишком много запросов, попробуйте позже'
                                }), 429
                            else:
                                flash('Слишком много запросов, попробуйте позже', 'error')
                                # Try to redirect to appropriate page
                                try:
                                    if 'admin' in endpoint:
                                        return redirect(url_for('admin'))
                                    elif 'users' in endpoint:
                                        return redirect(url_for('users'))
                                    elif 'files' in endpoint:
                                        return redirect(url_for('files'))
                                    elif 'categories' in endpoint:
                                        return redirect(url_for('categories_admin'))
                                    else:
                                        return redirect('/')
                                except Exception:
                                    return redirect('/')
                else:
                    # Pipeline failed, allow request but log warning
                    _log.warning(f"Redis pipeline failed for rate limiting, allowing request")
                
            except Exception as e:
                _log.warning(f"Rate limiting error: {e}, allowing request")
            
            return fn(*args, **kwargs)
        
        return wrapper
    
    return decorator


def create_rate_limiter(redis_client):
    """Create rate limiter instances for different endpoints.
    
    Args:
        redis_client: Redis client instance
        
    Returns:
        Dict of rate limiter decorators
    """
    def make_limiter(max_calls, window_sec):
        """Create a rate limiter with specific parameters."""
        return redis_rate_limit(max_calls, window_sec, redis_client)
    
    return {
        'login': make_limiter(5, 60),      # 5 attempts per minute
        'admin': make_limiter(30, 60),      # 30 requests per minute
        'users': make_limiter(60, 60),     # 60 requests per minute
        'files': make_limiter(60, 60),     # 60 requests per minute
        'categories': make_limiter(20, 60), # 20 requests per minute
        'groups': make_limiter(60, 60),     # 60 requests per minute
        'proxy': make_limiter(10, 60),      # 10 requests per minute
        'default': make_limiter(60, 60)    # Default rate limit
    }
