# Worker класс (для WebSocket через gevent-websocket)
worker_class = "geventwebsocket.gunicorn.workers.GeventWebSocketWorker"

# Количество воркеров (рекомендуется: 2 * CPU cores + 1)
workers = 5

# Количество соединений на воркер для gevent
worker_connections = 1000

# Таймауты (увеличены для загрузки больших файлов)
timeout = 3600  # 1 час для больших файлов
graceful_timeout = 30  # Время на graceful shutdown (уменьшено для быстрого выхода)
keepalive = 120  # HTTP keep-alive timeout

# Логи
capture_output = True
loglevel = "info"  # Изменено с debug на info для production
#accesslog = "logs/gaccess.log"  # access log из-за конфигурации gunicorn не пишется, альтернатива - accesslog - настроено в middleware.py
errorlog = "logs/gerror.log"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Сокет
bind = "unix:server.sock"

# Безопасность и производительность
max_requests = 1000  # Перезапуск воркера после N запросов (предотвращение утечек памяти)
max_requests_jitter = 100  # Случайная задержка для равномерного перезапуска
preload_app = True  # Загрузка приложения до форка воркеров (экономия памяти)

# Обработка сигналов для корректного завершения
def worker_int_handler(worker):
    """Handle worker interrupt signal gracefully."""
    try:
        worker.alive = False
        worker.kill()
    except:
        pass

worker_int = worker_int_handler

# Ограничения запросов
limit_request_line = 4094  # Максимальный размер HTTP заголовка
limit_request_fields = 100  # Максимальное количество заголовков
limit_request_field_size = 8190  # Максимальный размер одного заголовка

# Процессы
user = "system"  # Пользователь для запуска воркеров
group = "http"  # Группа для запуска воркеров
umask = 0o007  # Права доступа для создаваемых файлов

# Переменные окружения (Python 3.13 в виртуальном окружении)
raw_env = [
    'PYTHONPATH=/usr/share/znv2',
    'PWD=/usr/share/znv2',
]

# Обработка сигналов
worker_tmp_dir = "/dev/shm"  # Использование RAM для временных файлов

# PID файл
pidfile = "/var/run/znv2.pid"
