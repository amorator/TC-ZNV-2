"""Универсальный модуль синхронизации для всех страниц приложения."""

import logging
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
        try:
            self.socketio = socketio
            if not self.socketio:
                try:
                    from flask import current_app
                    self.socketio = getattr(current_app, 'socketio', None)
                except Exception:
                    self.socketio = None
        except Exception:
            try:
                from flask import current_app
                self.socketio = getattr(current_app, 'socketio', None)
            except Exception:
                self.socketio = None
        self._event_handlers = {}
    
    def emit_change(self, event_name: str, data: Dict[str, Any], reason: str = "updated") -> None:
        """Универсальная функция для отправки событий синхронизации.
        
        Args:
            event_name: Название события (например, 'categories:changed')
            data: Данные для отправки
            reason: Причина изменения (updated, added, deleted, toggled)
        """
        try:
            if not self.socketio:
                _log.warning(f"[sync] emit skipped (no socketio) event={event_name}")
                return
            payload = {
                'reason': reason,
                **data
            }
            try:
                dbg_id = data.get('subcategory_id') or data.get('category_id') or data.get('id')
            except Exception:
                dbg_id = None
            # Demote to debug to avoid noisy logs in production
            try:
                if _log.isEnabledFor(logging.DEBUG):
                    _log.debug(f"[sync] emit {event_name}: reason={reason} id={dbg_id} payload={payload}")
            except Exception:
                pass
            # Prefer low-level server.emit to guarantee global broadcast
            try:
                server = getattr(self.socketio, 'server', None)
                if server is not None:
                    server.emit(event_name, payload, namespace='/')
                else:
                    # Fallback to Flask-SocketIO emit with broadcast flag
                    try:
                        self.socketio.emit(event_name, payload, namespace='/', broadcast=True)
                    except TypeError:
                        # If broadcast kw not supported, emit without it
                        self.socketio.emit(event_name, payload, namespace='/')
            except Exception:
                # Last resort simple emit
                try:
                    self.socketio.emit(event_name, payload)
                except Exception:
                    pass
        except Exception as e:
            _log.error(f"Failed to emit {event_name}: {e}")
    
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
    sync_manager.emit_change('files:changed', data, reason)

def emit_users_changed(socketio, reason: str, **data):
    """Отправка события изменения пользователей."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('users:changed', data, reason)

def emit_groups_changed(socketio, reason: str, **data):
    """Отправка события изменения групп."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('groups:changed', data, reason)

def emit_registrators_changed(socketio, reason: str, **data):
    """Отправка события изменения регистраторов."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('registrators:changed', data, reason)

def emit_admin_changed(socketio, reason: str, **data):
    """Отправка события изменения админки."""
    sync_manager = SyncManager(socketio)
    sync_manager.emit_change('admin:changed', data, reason)

