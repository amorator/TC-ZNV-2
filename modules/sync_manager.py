"""
Универсальный модуль синхронизации для всех страниц приложения.

Архитектура синхронизации:
- Сервер эмитит события в комнаты (rooms) для таргетированной доставки
- Клиенты подписываются только на нужные им комнаты
- События содержат унифицированные поля: reason, seq, worker, scope
- Поддерживается мягкое обновление (soft refresh) с дебаунсом
- Автоматический idle-guard для обновления после периодов неактивности

Комнаты (rooms):
- index: главная страница
- files: страница файлов
- users: страница пользователей  
- groups: страница групп
- categories: страница категорий
- registrators: страница регистраторов
- admin: административная страница

Формат события:
{
    'reason': 'updated|added|deleted|toggled',
    'seq': 1234567890123,  # timestamp в миллисекундах
    'worker': 12345,       # ID процесса/воркера
    'scope': 'global|room:name',  # область действия
    ...data                # дополнительные данные события
}
"""

import logging
import time
import os
from typing import Dict, Any, Optional, Callable
from flask_socketio import emit

_log = logging.getLogger(__name__)

class SyncManager:
    """Менеджер синхронизации для всех компонентов приложения."""
    
    def __init__(self, socketio):
        """Инициализация менеджера синхронизации.
        
        Args:
            socketio: Flask-SocketIO экземпляр
        """
        # Разрешаем экземпляр Socket.IO из параметра или из Flask current_app
        self.socketio = socketio
        if not self.socketio:
            from flask import current_app
            self.socketio = getattr(current_app, 'socketio', None)
        self._event_handlers = {}
    
    def emit_change(self, event_name: str, data: Dict[str, Any], reason: str = "updated") -> None:
        """Универсальная функция для отправки событий синхронизации.
        
        Args:
            event_name: Название события (например, 'categories:changed')
            data: Данные для отправки
            reason: Причина изменения (updated, added, deleted, toggled)
        """
        if not self.socketio:
            _log.warning(f"[sync] emit skipped (no socketio) event={event_name}")
            return
        # Унифицированный формат события
        payload = {
            'reason': reason,
            'seq': int(time.time() * 1000),  # timestamp в миллисекундах
            'worker': os.getpid(),  # ID процесса/воркера
            'scope': 'global',  # область действия события
            **data
        }
        dbg_id = data.get('subcategory_id') or data.get('category_id') or data.get('id')
        # Унифицированное логирование событий
        if _log.isEnabledFor(logging.DEBUG):
            _log.debug(f"[sync] emit {event_name}: reason={reason} seq={payload['seq']} worker={payload['worker']} scope={payload['scope']} id={dbg_id}")
        # Emit via Flask-SocketIO (Redis manager handles cross-worker delivery)
        # Server-side emit to all clients on namespace when no room specified
        self.socketio.emit(event_name, payload, namespace='/')

    def emit_to_room(self, event_name: str, data: Dict[str, Any], room: str,
                     reason: str = "updated") -> None:
        """Отправить событие в конкретную комнату (room).

        Args:
            event_name: название события ('files:changed' и т.д.)
            data: полезная нагрузка
            room: имя комнаты (например, 'files', 'categories')
            reason: причина изменения
        """
        if not self.socketio:
            _log.warning(f"[sync] emit_to_room skipped (no socketio) event={event_name} room={room}")
            return
        # Унифицированный формат события для комнаты
        payload = {
            'reason': reason,
            'seq': int(time.time() * 1000),
            'worker': os.getpid(),
            'scope': f'room:{room}',
            **data
        }
        self.socketio.emit(event_name, payload, namespace='/', room=room)

    def emit_dependent(self, primary_event: str, primary_data: Dict[str, Any],
                       reason: str, dependent_events: Optional[list] = None) -> None:
        """Отправить основное событие и зависимые (например, обновить files после categories/registrators).

        Args:
            primary_event: основное событие (например, 'categories:changed')
            primary_data: данные основного события
            reason: причина изменения
            dependent_events: список кортежей (event_name, data, room_or_none)
        """
        self.emit_change(primary_event, primary_data, reason)
        if not dependent_events:
            return
        for dep in dependent_events:
            if not isinstance(dep, (list, tuple)) or len(dep) < 2:
                continue
            dep_event = dep[0]
            dep_data = dep[1] or {}
            dep_room = dep[2] if len(dep) > 2 else None
            if dep_room:
                self.emit_to_room(dep_event, dep_data, dep_room, reason)
            else:
                self.emit_change(dep_event, dep_data, reason)
    
    def register_handler(self, event_name: str, handler: Callable) -> None:
        """Регистрация обработчика события.
        
        Args:
            event_name: Название события
            handler: Функция-обработчик
        """
        self._event_handlers[event_name] = handler
    
    def get_handler(self, event_name: str) -> Optional[Callable]:
        """Получение обработчика события.
        
        Args:
            event_name: Название события
            
        Returns:
            Обработчик или None
        """
        return self._event_handlers.get(event_name)

# Специализированные функции для разных типов синхронизации
def emit_categories_changed(socketio, reason: str, **data):
    """Отправка события изменения категорий (единый путь)."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('categories:changed', data, reason)

def emit_subcategories_changed(socketio, reason: str, **data):
    """Отправка события изменения подкатегорий (единый путь)."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('subcategories:changed', data, reason)

def emit_files_changed(socketio, reason: str, **data):
    """Отправка события изменения файлов."""
    sync_manager = SyncManager(socketio)
    # Emit broadly and also to the files room for scoped listeners
    sync_manager.emit_change('files:changed', data, reason)
    sync_manager.emit_to_room('files:changed', data, 'files', reason)

def emit_users_changed(socketio, reason: str, **data):
    """Отправка события изменения пользователей."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('users:changed', data, reason)
    sync_manager.emit_to_room('users:changed', data, 'users', reason)

def emit_groups_changed(socketio, reason: str, **data):
    """Отправка события изменения групп."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('groups:changed', data, reason)
    sync_manager.emit_to_room('groups:changed', data, 'groups', reason)

def emit_registrators_changed(socketio, reason: str, **data):
    """Отправка события изменения регистраторов."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('registrators:changed', data, reason)

def emit_admin_changed(socketio, reason: str, **data):
    """Отправка события изменения админки."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('admin:changed', data, reason)

