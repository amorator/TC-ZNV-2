# Архитектура синхронизации

## Обзор

Система синхронизации обеспечивает real-time обновления данных между сервером и клиентами через Socket.IO и Redis pub/sub.

## Компоненты

### Серверная часть (Python)

- **SyncManager** (`modules/sync_manager.py`) - центральный менеджер для эмиссии событий
- **Redis pub/sub** - для обмена событиями между воркерами Gunicorn
- **Socket.IO rooms** - для таргетированной доставки событий

### Клиентская часть (JavaScript)

- **SyncManager** (`static/js/sync.js`) - универсальный модуль синхронизации
- **Utils** (`static/js/utils.js`) - общие утилиты (showToast, validateForm, etc.)
- **Page-specific modules** - обработчики для конкретных страниц

## Комнаты (Rooms)

События доставляются в комнаты для таргетированной синхронизации:

- `index` - главная страница
- `files` - страница файлов
- `users` - страница пользователей
- `groups` - страница групп
- `categories` - страница категорий
- `registrators` - страница регистраторов
- `admin` - административная страница

## Формат событий

Все события имеют унифицированную структуру:

```json
{
  "reason": "updated|added|deleted|toggled",
  "seq": 1234567890123,
  "worker": 12345,
  "scope": "global|room:name",
  "id": "item_id",
  "data": "..."
}
```

### Поля события

- `reason` - причина изменения
- `seq` - timestamp в миллисекундах для упорядочивания
- `worker` - ID процесса/воркера, отправившего событие
- `scope` - область действия (`global` или `room:name`)
- `id` - идентификатор измененного элемента
- `data` - дополнительные данные события

## Зависимости между событиями

- `categories:changed` → обновляет `categories` и мягко обновляет `files`
- `registrators:changed` → обновляет `registrators` и мягко обновляет `files`
- Остальные события обновляют только свои страницы

## Клиентская подписка

Каждая страница подписывается на свои события:

```javascript
// При загрузке страницы
SyncManager.joinRoom("files");
SyncManager.on("files:changed", refreshFilesData);
SyncManager.startIdleGuard(refreshFilesData, 30);
```

## Мягкое обновление (Soft Refresh)

Вместо полной перезагрузки страницы используется мягкое обновление:

- Обновляются только данные (таблицы, списки)
- Сохраняется состояние UI (открытые модалы, позиция скролла)
- Дебаунс предотвращает частые обновления

## Idle Guard

Автоматическое обновление после периодов неактивности:

- По умолчанию: 30 секунд без событий
- Настраивается через `config.ini` (`sync_idle_seconds`)
- Срабатывает только если нет активности

## Отладка

Для включения отладочного вывода:

```javascript
// Только на главной странице
window.__syncDebug = true;

// Или глобально
window.__syncDebug = true;
```

## Конфигурация

### Nginx

```nginx
location /socket.io {
    include proxy_params;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_pass http://unix:/usr/share/znf/server.sock:;
}
```

### Gunicorn

```python
# gunicorn.conf.py
worker_class = "gevent"
workers = 5
preload_app = False  # Важно для Socket.IO
```

### Redis

```ini
# config.ini
[redis]
socket = /var/run/redis/redis.sock
password = znf25!
db = 0
```

## Устранение неполадок

1. **События не доходят** - проверьте Redis соединение и Nginx конфигурацию
2. **Дублирование событий** - убедитесь что `preload_app = False` в Gunicorn
3. **Медленные обновления** - проверьте настройки `sync_idle_seconds`
4. **Ошибки Socket.IO** - отключите блокировку рекламы и защиту от отслеживания
