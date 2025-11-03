"""
Service worker endpoint only. Push subscription endpoints removed as deprecated.
"""

from os import path
from typing import Any

from flask import send_from_directory

from modules.logging import get_logger

_log = get_logger(__name__)


def register(app: Any) -> None:
    """Register service worker endpoint only."""

    @app.route('/sw.js')
    def service_worker():
        # Serve service worker from static folder with root scope
        try:
            return send_from_directory(path.join(app.root_path, 'static'),
                                       'sw.js',
                                       mimetype='application/javascript')
        except Exception as e:
            app.flash_error(e)
            return ('', 404)

    # All push-related endpoints removed
