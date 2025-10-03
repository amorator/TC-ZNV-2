"""Centralized logging configuration for znv2 application."""

import logging
import logging.handlers
from os import path, makedirs
from configparser import ConfigParser
from datetime import datetime
from typing import Optional


class LoggingConfig:
    """Centralized logging configuration."""
    
    def __init__(self, config_path: str = "config.ini"):
        """Initialize logging configuration from config file."""
        self.config = ConfigParser()
        self.config.read(config_path, encoding='utf-8')
        
        # Create logs directory if it doesn't exist
        self.logs_dir = path.join(path.dirname(path.realpath(__file__)), '..', 'logs')
        makedirs(self.logs_dir, exist_ok=True)
        
        # Service name for systemd
        self.service_name = self.config.get('logging', 'service_name', fallback='znv2.service')
        
        # Log levels
        self.file_level = self.config.get('logging', 'file_level', fallback='INFO')
        self.console_level = self.config.get('logging', 'console_level', fallback='INFO')
        
        # Rotation settings
        self.max_bytes = self.config.getint('logging', 'max_bytes', fallback=10*1024*1024)  # 10MB
        self.backup_count = self.config.getint('logging', 'backup_count', fallback=5)
        
        self._setup_loggers()
    
    def _setup_loggers(self):
        """Setup all application loggers."""
        # Root logger
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.DEBUG)
        
        # Clear existing handlers
        for handler in root_logger.handlers[:]:
            root_logger.removeHandler(handler)
        
        # Console handler (for systemd)
        console_handler = logging.StreamHandler()
        console_handler.setLevel(getattr(logging, self.console_level))
        console_formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        console_handler.setFormatter(console_formatter)
        root_logger.addHandler(console_handler)
        
        # Error log handler
        error_handler = logging.handlers.RotatingFileHandler(
            path.join(self.logs_dir, 'error.log'),
            maxBytes=self.max_bytes,
            backupCount=self.backup_count,
            encoding='utf-8'
        )
        error_handler.setLevel(logging.ERROR)
        error_formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(name)s:%(lineno)d: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        error_handler.setFormatter(error_formatter)
        root_logger.addHandler(error_handler)
        
        # Access log handler
        access_handler = logging.handlers.RotatingFileHandler(
            path.join(self.logs_dir, 'access.log'),
            maxBytes=self.max_bytes,
            backupCount=self.backup_count,
            encoding='utf-8'
        )
        access_handler.setLevel(logging.INFO)
        access_formatter = logging.Formatter(
            '%(asctime)s %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        access_handler.setFormatter(access_formatter)
        
        # Create access logger (clear existing handlers to avoid duplicates)
        access_logger = logging.getLogger('access')
        access_logger.setLevel(logging.INFO)
        for h in access_logger.handlers[:]:
            access_logger.removeHandler(h)
        access_logger.addHandler(access_handler)
        access_logger.propagate = False
        
        # Actions log handler
        actions_handler = logging.handlers.RotatingFileHandler(
            path.join(self.logs_dir, 'actions.log'),
            maxBytes=self.max_bytes,
            backupCount=self.backup_count,
            encoding='utf-8'
        )
        actions_handler.setLevel(logging.INFO)
        actions_formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        actions_handler.setFormatter(actions_formatter)
        
        # Create actions logger (clear existing handlers to avoid duplicates)
        actions_logger = logging.getLogger('actions')
        actions_logger.setLevel(logging.INFO)
        for h in actions_logger.handlers[:]:
            actions_logger.removeHandler(h)
        actions_logger.addHandler(actions_handler)
        actions_logger.propagate = False
        
        # File log handler for general application logs
        file_handler = logging.handlers.RotatingFileHandler(
            path.join(self.logs_dir, 'app.log'),
            maxBytes=self.max_bytes,
            backupCount=self.backup_count,
            encoding='utf-8'
        )
        file_handler.setLevel(getattr(logging, self.file_level))
        file_formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(name)s:%(lineno)d: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(file_formatter)
        root_logger.addHandler(file_handler)

        # Reduce verbosity of noisy HTTP/server loggers so they don't spam app.log
        noisy_loggers = [
            'geventwebsocket.handler',
            'werkzeug',
            'engineio.server',
            'socketio.server',
        ]
        for lname in noisy_loggers:
            nl = logging.getLogger(lname)
            nl.setLevel(logging.WARNING)
            nl.propagate = False
    
    def get_logger(self, name: str) -> logging.Logger:
        """Get logger instance."""
        return logging.getLogger(name)
    
    def log_access(self, method: str, path: str, status: int, user: str = None, 
                   ip: str = None, user_agent: str = None, duration: float = None):
        """Log HTTP access."""
        access_logger = logging.getLogger('access')
        user_info = f" user={user}" if user else ""
        ip_info = f" ip={ip}" if ip else ""
        ua_info = f" ua={user_agent}" if user_agent else ""
        duration_info = f" duration={duration:.3f}s" if duration else ""
        
        access_logger.info(f'{method} {path} {status}{user_info}{ip_info}{ua_info}{duration_info}')
    
    def log_action(self, action: str, user: str, details: str = None, 
                   ip: str = None, success: bool = True):
        """Log user action."""
        actions_logger = logging.getLogger('actions')
        status = "SUCCESS" if success else "FAILED"
        ip_info = f" ip={ip}" if ip else ""
        details_info = f" details={details}" if details else ""
        
        actions_logger.info(f'{action} user={user} status={status}{ip_info}{details_info}')


# Global logging config instance
_logging_config: Optional[LoggingConfig] = None


def init_logging(config_path: str = "config.ini") -> LoggingConfig:
    """Initialize logging configuration."""
    global _logging_config
    if _logging_config is None:
        _logging_config = LoggingConfig(config_path)
    else:
        # Reconfigure in place to avoid duplicate handlers on reloads
        _logging_config._setup_loggers()
    return _logging_config


def get_logger(name: str) -> logging.Logger:
    """Get logger instance."""
    if _logging_config is None:
        init_logging()
    return _logging_config.get_logger(name)


def log_access(method: str, path: str, status: int, user: str = None, 
               ip: str = None, user_agent: str = None, duration: float = None):
    """Log HTTP access."""
    if _logging_config is None:
        init_logging()
    _logging_config.log_access(method, path, status, user, ip, user_agent, duration)


def log_action(action: str, user: str, details: str = None, 
               ip: str = None, success: bool = True):
    """Log user action."""
    if _logging_config is None:
        init_logging()
    _logging_config.log_action(action, user, details, ip, success)
