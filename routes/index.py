from flask import render_template, url_for, request, redirect, abort, Response
from flask_login import current_user
from modules.permissions import has_permission, ADMIN_ANY, ADMIN_VIEW_PAGE
from os import path
from datetime import datetime
from modules.sync_manager import SyncManager
from flask_socketio import join_room, emit
import os


def register(app):
    # Socket.IO room join for index page
    try:
        if hasattr(app, 'socketio') and app.socketio:

            @app.socketio.on('index:join')
            def _index_join(_data=None):
                try:
                    join_room('index')
                    try:
                        sid = request.environ.get('flask_socketio.sid', '')
                        app.socketio.emit('index:joined', {'ok': True},
                                          namespace='/',
                                          room=sid)
                    except Exception:
                        pass
                except Exception:
                    try:
                        sid = request.environ.get('flask_socketio.sid', '')
                        app.socketio.emit('index:joined', {'ok': False},
                                          namespace='/',
                                          room=sid)
                    except Exception:
                        pass

            @app.socketio.on('index:ack')
            def _index_ack(data=None):
                try:
                    seq = (data or {}).get('seq')
                    app.logger.info(
                        f"index:ack seq={seq} sid={request.environ.get('flask_socketio.sid','')}"
                    )
                except Exception:
                    pass
    except Exception:
        pass

    @app.route('/', methods=['GET'], endpoint='index')
    def index():
        """Home page.

		- Redirect unauthenticated users to login
		- Render the index template otherwise
		"""
        if not current_user.is_authenticated:
            return redirect(url_for('login'))
        return render_template('index.j2.html')

    @app.route('/index/toggle', methods=['POST'])
    def index_toggle():
        """Test toggle endpoint to emit index:changed via SyncManager.

        Returns JSON with server timestamp. Uses X-Client-Id to mark origin.
        """
        if not current_user.is_authenticated:
            return abort(401)
        try:
            # Read origin client id and optional requested state
            origin = (request.headers.get('X-Client-Id') or '').strip()
            requested = request.json if request.is_json else None
            state = None
            try:
                if isinstance(requested, dict):
                    state = bool(requested.get('state'))
            except Exception:
                state = None

            # Emit event using SyncManager (broadcast) with sequence
            sm = SyncManager(getattr(app, 'socketio', None))
            try:
                app.config['INDEX_SEQ'] = int(
                    app.config.get('INDEX_SEQ') or 0) + 1
            except Exception:
                app.config['INDEX_SEQ'] = 1
            seq = int(app.config.get('INDEX_SEQ') or 1)
            worker = os.getpid()
            payload = {
                'id': str(current_user.get_id() or ''),
                'originClientId': origin,
                'server_ts': datetime.utcnow().isoformat() + 'Z',
                'state': state,
                'seq': seq,
                'worker': worker,
            }
            try:
                app.logger.info(
                    f"index:changed emit seq={seq} worker={worker}")
            except Exception:
                pass
            sm.emit_change('index:changed', payload, reason='toggled')

            # Additionally emit to a dedicated room to avoid listener races
            try:
                if hasattr(app, 'socketio') and app.socketio:
                    app.socketio.emit('index:changed',
                                      payload,
                                      namespace='/',
                                      room='index')
            except Exception:
                pass

            return {
                'status': 'success',
                'server_ts': datetime.utcnow().isoformat() + 'Z',
                'state': state,
                'seq': seq,
                'worker': worker,
            }, 200
        except Exception as e:
            return {'status': 'error', 'message': str(e)}, 500

    @app.route('/logs/actions', methods=['GET'])
    def logs_actions():
        """Serve actions.log for admin page viewer (requires admin.view)."""
        # imports moved to module level
        try:
            if not (has_permission(current_user, ADMIN_VIEW_PAGE)
                    or has_permission(current_user, ADMIN_ANY)):
                return abort(403)
        except Exception:
            return abort(401)
        try:
            logs_path = path.join(app.root_path, 'logs', 'actions.log')
            if not path.exists(logs_path):
                return Response('', mimetype='text/plain; charset=utf-8')
            with open(logs_path, 'r', encoding='utf-8') as f:
                data = f.read()
            return Response(data, mimetype='text/plain; charset=utf-8')
        except Exception as e:
            return Response(str(e),
                            status=500,
                            mimetype='text/plain; charset=utf-8')
