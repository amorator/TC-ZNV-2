from flask import request, jsonify, send_from_directory
from flask_login import current_user
from modules.logging import get_logger, log_action
import os
import json

_log = get_logger(__name__)


def register(app):
	"""Register push notification routes and service worker endpoint."""

	@app.route('/sw.js')
	def service_worker():
		# Serve service worker from static folder with root scope
		try:
			return send_from_directory(os.path.join(app.root_path, 'static'), 'sw.js', mimetype='application/javascript')
		except Exception as e:
			app.flash_error(e)
			return ('', 404)

	@app.route('/push/vapid_public', methods=['GET'])
	def push_vapid_public():
		"""Return VAPID public key for client subscription (Base64 URL-safe)."""
		try:
			key = (app._sql.push_get_vapid_public() or '')
			if not key:
				return jsonify({'status': 'error', 'message': 'VAPID public key not configured'}), 400
			return jsonify({'status': 'success', 'publicKey': key})
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/push/subscribe', methods=['POST'])
	def push_subscribe():
		"""Store a browser push subscription for current user."""
		try:
			if not getattr(current_user, 'is_authenticated', False):
				return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401
			data = request.get_json(force=True, silent=True) or {}
			endpoint = (data.get('endpoint') or '').strip()
			keys = data.get('keys') or {}
			p256dh = (keys.get('p256dh') or '').strip()
			auth = (keys.get('auth') or '').strip()
			if not endpoint:
				return jsonify({'status': 'error', 'message': 'Invalid subscription'}), 400
			app._sql.push_add_subscription(current_user.id, endpoint, p256dh, auth)
			try:
				log_action('PUSH_SUBSCRIBE', current_user.name, f'subscribed endpoint={endpoint[:32]}...', request.remote_addr)
			except Exception:
				pass
			return jsonify({'status': 'success'}), 200
		except Exception as e:
			app.flash_error(e)
			try:
				log_action('PUSH_SUBSCRIBE', current_user.name if getattr(current_user, 'is_authenticated', False) else 'anonymous', f'failed subscribe: {str(e)}', request.remote_addr, success=False)
			except Exception:
				pass
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/push/unsubscribe', methods=['POST'])
	def push_unsubscribe():
		"""Remove a browser push subscription by endpoint."""
		try:
			data = request.get_json(force=True, silent=True) or {}
			endpoint = (data.get('endpoint') or '').strip()
			if not endpoint:
				return jsonify({'status': 'error', 'message': 'Invalid endpoint'}), 400
			app._sql.push_remove_subscription(endpoint)
			try:
				log_action('PUSH_UNSUBSCRIBE', current_user.name if getattr(current_user, 'is_authenticated', False) else 'anonymous', f'unsubscribed endpoint={endpoint[:32]}...', request.remote_addr)
			except Exception:
				pass
			return jsonify({'status': 'success'}), 200
		except Exception as e:
			app.flash_error(e)
			try:
				log_action('PUSH_UNSUBSCRIBE', current_user.name if getattr(current_user, 'is_authenticated', False) else 'anonymous', f'failed unsubscribe: {str(e)}', request.remote_addr, success=False)
			except Exception:
				pass
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/push/test', methods=['POST'])
	def push_test():
		"""Send a test push message to current user's subscriptions (if pywebpush configured)."""
		try:
			if not getattr(current_user, 'is_authenticated', False):
				return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401
			rows = app._sql.push_get_user_subscriptions(current_user.id) or []
			if not rows:
				return jsonify({'status': 'error', 'message': 'No subscriptions'}), 400
			try:
				from pywebpush import webpush, WebPushException
			except Exception:
				return jsonify({'status': 'error', 'message': 'pywebpush not installed'}), 501
			vapid_public = (app._sql.push_get_vapid_public() or '')
			vapid_private = (app._sql.push_get_vapid_private() or '')
			vapid_subject = (app._sql.push_get_vapid_subject() or 'mailto:admin@example.com')
			if not vapid_public or not vapid_private:
				return jsonify({'status': 'error', 'message': 'VAPID keys not configured'}), 400
			payload = {'title': 'ZNV', 'body': 'Тестовое уведомление', 'icon': '/static/images/notification-icon.png'}
			sent = 0
			for row in rows:
				endpoint, p256dh, auth = row[1], row[2], row[3]
				sub_info = {
					"endpoint": endpoint,
					"keys": {"p256dh": p256dh, "auth": auth}
				}
				try:
					webpush(
						subscription_info=sub_info,
						data=json.dumps({ **payload, 'id': int(os.urandom(2).hex(), 16) }, ensure_ascii=False),
						vapid_private_key=vapid_private,
						vapid_claims={"sub": vapid_subject}
					)
					sent += 1
				except WebPushException as we:
					_log.error(f"Push send failed: {we}")
					continue
			try:
				log_action('PUSH_TEST', current_user.name, f'sent test to {sent} subs', request.remote_addr)
			except Exception:
				pass
			return jsonify({'status': 'success', 'sent': sent}), 200
		except Exception as e:
			app.flash_error(e)
			try:
				log_action('PUSH_TEST', current_user.name if getattr(current_user, 'is_authenticated', False) else 'anonymous', f'failed to send test: {str(e)}', request.remote_addr, success=False)
			except Exception:
				pass
			return jsonify({'status': 'error', 'message': str(e)}), 500

	@app.route('/push/delivered', methods=['POST'])
	def push_delivered():
		"""Log notification delivery when SW reports showNotification was called."""
		try:
			if not getattr(current_user, 'is_authenticated', False):
				return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401
			data = request.get_json(force=True, silent=True) or {}
			title = (data.get('title') or '').strip()
			body = (data.get('body') or '').strip()
			from modules.logging import log_action
			log_action('PUSH_DELIVERED', current_user.name, f"delivered: {title} — {body}", request.remote_addr, success=True)
			return jsonify({'status': 'success'}), 200
		except Exception as e:
			app.flash_error(e)
			return jsonify({'status': 'error', 'message': str(e)}), 500



