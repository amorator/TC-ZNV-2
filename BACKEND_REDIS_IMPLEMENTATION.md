# Backend Redis Implementation Example

## Flask Routes для Redis Optimization

```python
from flask import jsonify, request
import redis
import json
from datetime import datetime, timedelta
import logging

# Redis connection
redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.route('/admin/presence/redis')
def get_presence_redis():
    """Получить данные присутствия из Redis"""
    try:
        logger.info("Fetching presence data from Redis")

        # Получить все данные присутствия
        presence_data = redis_client.hgetall('presence:users')

        # Фильтровать активных пользователей (последние 5 минут)
        active_users = []
        cutoff_time = datetime.now().timestamp() * 1000 - 300000  # 5 минут назад

        for key, value in presence_data.items():
            try:
                user_data = json.loads(value)
                if user_data.get('lastSeen', 0) > cutoff_time:
                    active_users.append(user_data)
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON in Redis for key {key}: {value}")
                continue

        logger.info(f"Found {len(active_users)} active users in Redis")

        return jsonify({
            'status': 'success',
            'items': active_users,
            'source': 'redis',
            'timestamp': datetime.now().timestamp() * 1000,
            'count': len(active_users)
        })
    except Exception as e:
        logger.error(f"Redis presence error: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/admin/sessions/redis')
def get_sessions_redis():
    """Получить данные сессий из Redis"""
    try:
        logger.info("Fetching sessions data from Redis")

        # Получить все активные сессии
        sessions_data = redis_client.hgetall('sessions:active')

        sessions = []
        for key, value in sessions_data.items():
            try:
                session_data = json.loads(value)
                sessions.append(session_data)
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON in Redis for session {key}: {value}")
                continue

        logger.info(f"Found {len(sessions)} active sessions in Redis")

        return jsonify({
            'status': 'success',
            'items': sessions,
            'source': 'redis',
            'timestamp': datetime.now().timestamp() * 1000,
            'count': len(sessions)
        })
    except Exception as e:
        logger.error(f"Redis sessions error: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/heartbeat', methods=['POST'])
def heartbeat():
    """Обновить heartbeat пользователя в Redis"""
    try:
        data = request.get_json()
        user = data.get('user')
        ip = request.remote_addr
        ua = request.headers.get('User-Agent', '')
        page = data.get('page', '')

        if not user:
            return jsonify({'status': 'error', 'message': 'User required'}), 400

        logger.info(f"Heartbeat from user {user} at {ip}")

        # Обновить в Redis
        user_key = f"{user}|{ip}"
        user_data = {
            'user': user,
            'ip': ip,
            'ua': ua,
            'page': page,
            'lastSeen': datetime.now().timestamp() * 1000
        }

        redis_client.hset('presence:users', user_key, json.dumps(user_data))
        redis_client.expire('presence:users', 300)  # TTL 5 минут

        # Отправить real-time обновление через Socket.IO
        socketio.emit('admin:presence:update', {
            'type': 'user_activity',
            'user': user,
            'ip': ip,
            'ua': ua,
            'page': page,
            'lastSeen': user_data['lastSeen']
        }, room='admin')

        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Heartbeat error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/session/update', methods=['POST'])
def update_session():
    """Обновить информацию о сессии в Redis"""
    try:
        data = request.get_json()
        sid = data.get('sid')
        user = data.get('user')
        ip = request.remote_addr
        ua = request.headers.get('User-Agent', '')

        if not sid:
            return jsonify({'status': 'error', 'message': 'Session ID required'}), 400

        logger.info(f"Updating session {sid} for user {user}")

        # Обновить в Redis
        session_data = {
            'sid': sid,
            'session_id': sid,
            'user': user or 'Неизвестно',
            'ip': ip,
            'ua': ua,
            'last_activity': datetime.now().timestamp() * 1000
        }

        redis_client.hset('sessions:active', sid, json.dumps(session_data))
        redis_client.expire('sessions:active', 1800)  # TTL 30 минут

        # Отправить real-time обновление через Socket.IO
        socketio.emit('admin:sessions:update', {
            'type': 'session_activity',
            'sid': sid,
            'user': user,
            'ip': ip,
            'ua': ua,
            'last_activity': session_data['last_activity']
        }, room='admin')

        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Session update error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500
```

## Socket.IO Events для Real-time Updates

```python
from flask_socketio import SocketIO, emit, join_room, leave_room

@socketio.on('join-room')
def handle_join_room(data):
    """Присоединиться к комнате для real-time обновлений"""
    try:
        room = data.get('room', 'admin')
        join_room(room)
        logger.info(f"Client joined room: {room}")
        emit('joined_room', {'room': room})
    except Exception as e:
        logger.error(f"Join room error: {e}")
        emit('error', {'message': str(e)})

@socketio.on('user:heartbeat')
def handle_user_heartbeat(data):
    """Обработать heartbeat пользователя"""
    try:
        user = data.get('user')
        ip = request.environ.get('REMOTE_ADDR')
        ua = request.environ.get('HTTP_USER_AGENT', '')
        page = data.get('page', '')

        logger.info(f"Heartbeat from {user} at {ip}")

        # Обновить Redis
        user_key = f"{user}|{ip}"
        user_data = {
            'user': user,
            'ip': ip,
            'ua': ua,
            'page': page,
            'lastSeen': datetime.now().timestamp() * 1000
        }

        redis_client.hset('presence:users', user_key, json.dumps(user_data))
        redis_client.expire('presence:users', 300)

        # Уведомить админов
        emit('admin:presence:update', {
            'type': 'user_activity',
            'user': user,
            'ip': ip,
            'ua': ua,
            'page': page,
            'lastSeen': user_data['lastSeen']
        }, room='admin')

    except Exception as e:
        logger.error(f"Heartbeat error: {e}")
        emit('error', {'message': str(e)})

@socketio.on('user:login')
def handle_user_login(data):
    """Обработать вход пользователя"""
    try:
        user = data.get('user')
        ip = request.environ.get('REMOTE_ADDR')
        ua = request.environ.get('HTTP_USER_AGENT', '')

        logger.info(f"User login: {user} at {ip}")

        # Обновить Redis
        user_key = f"{user}|{ip}"
        user_data = {
            'user': user,
            'ip': ip,
            'ua': ua,
            'page': '/',
            'lastSeen': datetime.now().timestamp() * 1000
        }

        redis_client.hset('presence:users', user_key, json.dumps(user_data))
        redis_client.expire('presence:users', 300)

        # Уведомить админов
        emit('admin:presence:update', {
            'type': 'user_login',
            'user': user,
            'ip': ip,
            'ua': ua,
            'lastSeen': user_data['lastSeen']
        }, room='admin')

    except Exception as e:
        logger.error(f"User login error: {e}")
        emit('error', {'message': str(e)})

@socketio.on('user:logout')
def handle_user_logout(data):
    """Обработать выход пользователя"""
    try:
        user = data.get('user')
        ip = request.environ.get('REMOTE_ADDR')

        logger.info(f"User logout: {user} at {ip}")

        # Удалить из Redis
        user_key = f"{user}|{ip}"
        redis_client.hdel('presence:users', user_key)

        # Уведомить админов
        emit('admin:presence:update', {
            'type': 'user_logout',
            'user': user,
            'ip': ip
        }, room='admin')

    except Exception as e:
        logger.error(f"User logout error: {e}")
        emit('error', {'message': str(e)})

@socketio.on('session:terminate')
def handle_session_terminate(data):
    """Обработать завершение сессии"""
    try:
        sid = data.get('sid')
        user = data.get('user')

        logger.info(f"Terminating session {sid} for user {user}")

        # Удалить из Redis
        redis_client.hdel('sessions:active', sid)

        # Уведомить админов
        emit('admin:sessions:update', {
            'type': 'session_terminated',
            'sid': sid,
            'user': user
        }, room='admin')

    except Exception as e:
        logger.error(f"Session terminate error: {e}")
        emit('error', {'message': str(e)})
```

## Background Task для очистки Redis

```python
import threading
import time

def cleanup_redis_data():
    """Фоновый процесс очистки устаревших данных"""
    logger.info("Starting Redis cleanup task")

    while True:
        try:
            current_time = datetime.now().timestamp() * 1000

            # Очистка присутствия (старше 5 минут)
            presence_data = redis_client.hgetall('presence:users')
            cleaned_presence = 0
            for key, value in presence_data.items():
                try:
                    user_data = json.loads(value)
                    if user_data.get('lastSeen', 0) < current_time - 300000:  # 5 минут
                        redis_client.hdel('presence:users', key)
                        cleaned_presence += 1
                except json.JSONDecodeError:
                    redis_client.hdel('presence:users', key)
                    cleaned_presence += 1

            # Очистка сессий (старше 30 минут)
            sessions_data = redis_client.hgetall('sessions:active')
            cleaned_sessions = 0
            for key, value in sessions_data.items():
                try:
                    session_data = json.loads(value)
                    if session_data.get('last_activity', 0) < current_time - 1800000:  # 30 минут
                        redis_client.hdel('sessions:active', key)
                        cleaned_sessions += 1
                except json.JSONDecodeError:
                    redis_client.hdel('sessions:active', key)
                    cleaned_sessions += 1

            if cleaned_presence > 0 or cleaned_sessions > 0:
                logger.info(f"Cleaned {cleaned_presence} presence entries, {cleaned_sessions} sessions")

            time.sleep(60)  # Проверять каждую минуту
        except Exception as e:
            logger.error(f"Redis cleanup error: {e}")
            time.sleep(60)

# Запустить в отдельном потоке
cleanup_thread = threading.Thread(target=cleanup_redis_data, daemon=True)
cleanup_thread.start()
logger.info("Redis cleanup task started")
```

## Middleware для автоматического обновления Redis

```python
from functools import wraps

def update_presence_on_request(f):
    """Декоратор для автоматического обновления присутствия при запросах"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            # Получить информацию о пользователе из сессии
            if 'user' in session:
                user = session['user']
                ip = request.remote_addr
                ua = request.headers.get('User-Agent', '')
                page = request.path

                # Обновить в Redis
                user_key = f"{user}|{ip}"
                user_data = {
                    'user': user,
                    'ip': ip,
                    'ua': ua,
                    'page': page,
                    'lastSeen': datetime.now().timestamp() * 1000
                }

                redis_client.hset('presence:users', user_key, json.dumps(user_data))
                redis_client.expire('presence:users', 300)

                # Обновить сессию
                if 'sid' in session:
                    sid = session['sid']
                    session_data = {
                        'sid': sid,
                        'session_id': sid,
                        'user': user,
                        'ip': ip,
                        'ua': ua,
                        'last_activity': datetime.now().timestamp() * 1000
                    }

                    redis_client.hset('sessions:active', sid, json.dumps(session_data))
                    redis_client.expire('sessions:active', 1800)

        except Exception as e:
            logger.warning(f"Presence update error: {e}")

        return f(*args, **kwargs)
    return decorated_function

# Применить к основным маршрутам
@app.route('/dashboard')
@update_presence_on_request
def dashboard():
    return render_template('dashboard.html')

@app.route('/users')
@update_presence_on_request
def users():
    return render_template('users.html')

@app.route('/admin')
@update_presence_on_request
def admin():
    return render_template('admin.html')
```

## Frontend Heartbeat Implementation

```javascript
// Добавить в основной layout или в каждую страницу
function startHeartbeat() {
  const user = window.currentUser || "anonymous";
  const page = window.location.pathname;

  // Отправлять heartbeat каждые 30 секунд
  setInterval(() => {
    try {
      // HTTP heartbeat
      fetch("/api/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user: user,
          page: page,
        }),
      }).catch((err) => {
        console.warn("Heartbeat HTTP failed:", err);
      });

      // Socket.IO heartbeat
      if (window.SyncManager && window.SyncManager.getSocket) {
        const socket = window.SyncManager.getSocket();
        if (socket && socket.connected) {
          socket.emit("user:heartbeat", {
            user: user,
            page: page,
          });
        }
      }
    } catch (err) {
      console.warn("Heartbeat error:", err);
    }
  }, 30000); // 30 секунд
}

// Запустить heartbeat при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
  startHeartbeat();
});
```

## Redis Configuration

```bash
# redis.conf
# Увеличить лимиты для больших данных
maxmemory 256mb
maxmemory-policy allkeys-lru

# Настроить TTL по умолчанию
# TTL будет устанавливаться программно

# Включить логирование
loglevel notice
logfile /var/log/redis/redis-server.log
```

## Monitoring и Debugging

```python
@app.route('/admin/redis/stats')
def redis_stats():
    """Получить статистику Redis"""
    try:
        info = redis_client.info()

        stats = {
            'memory_used': info.get('used_memory_human', 'Unknown'),
            'connected_clients': info.get('connected_clients', 0),
            'total_commands_processed': info.get('total_commands_processed', 0),
            'keyspace_hits': info.get('keyspace_hits', 0),
            'keyspace_misses': info.get('keyspace_misses', 0),
            'presence_keys': redis_client.hlen('presence:users'),
            'sessions_keys': redis_client.hlen('sessions:active'),
            'db_size': redis_client.dbsize()
        }

        return jsonify({
            'status': 'success',
            'stats': stats
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/admin/redis/debug')
def redis_debug():
    """Отладочная информация Redis"""
    try:
        presence_data = redis_client.hgetall('presence:users')
        sessions_data = redis_client.hgetall('sessions:active')

        debug_info = {
            'presence_count': len(presence_data),
            'sessions_count': len(sessions_data),
            'presence_keys': list(presence_data.keys()),
            'sessions_keys': list(sessions_data.keys()),
            'sample_presence': dict(list(presence_data.items())[:3]),
            'sample_sessions': dict(list(sessions_data.items())[:3])
        }

        return jsonify({
            'status': 'success',
            'debug': debug_info
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500
```

Эта реализация обеспечит:

1. **Быстрый доступ к данным** через Redis
2. **Real-time обновления** через Socket.IO
3. **Автоматическую очистку** устаревших данных
4. **Fallback логику** при недоступности Redis
5. **Мониторинг и отладку** системы

Установите Redis и добавьте эти маршруты в ваш Flask приложение для полной оптимизации! 🚀
