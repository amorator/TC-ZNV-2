"""Custom Gunicorn logging configuration with rotation."""

import logging
import logging.handlers
import os
from gunicorn.glogging import Logger


class RotatingLogger(Logger):
    """Custom Gunicorn logger with rotation support."""

    def __init__(self, cfg):
        super().__init__(cfg)

        # Setup rotating file handler for error log
        if cfg.errorlog and cfg.errorlog != "-":
            error_handler = logging.handlers.RotatingFileHandler(
                cfg.errorlog,
                maxBytes=50 * 1024 * 1024,  # 50MB
                backupCount=5,
                encoding='utf-8')
            error_handler.setLevel(logging.INFO)
            error_formatter = logging.Formatter(
                '%(asctime)s [%(process)d] [%(levelname)s] %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S')
            error_handler.setFormatter(error_formatter)

            # Replace the default error handler
            self.error_log.handlers.clear()
            self.error_log.addHandler(error_handler)

        # Setup rotating file handler for access log
        if cfg.accesslog and cfg.accesslog != "-":
            access_handler = logging.handlers.RotatingFileHandler(
                cfg.accesslog,
                maxBytes=50 * 1024 * 1024,  # 50MB
                backupCount=5,
                encoding='utf-8')
            access_handler.setLevel(logging.INFO)
            access_formatter = logging.Formatter('%(asctime)s %(message)s',
                                                 datefmt='%Y-%m-%d %H:%M:%S')
            access_handler.setFormatter(access_formatter)

            # Replace the default access handler
            self.access_log.handlers.clear()
            self.access_log.addHandler(access_handler)


