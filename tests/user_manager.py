#!/usr/bin/env python3
"""
Утилита для автоматического создания и управления тестовыми пользователями.
Создаёт пользователей с разными ролями для полноценного тестирования RBAC.
"""

import os
import time
import requests
import socket
from urllib.parse import urlparse
from typing import Dict, List, Optional, Tuple
from tests.config import (
    BASE_URL as DEFAULT_BASE,
    LOGIN as DEFAULT_LOGIN,
    PASSWORD as DEFAULT_PASSWORD,
    ACCEPT_INSECURE_CERTS,
)


class TestUserManager:
    """Менеджер тестовых пользователей для автоматизации RBAC тестирования."""

    def __init__(self,
                 base_url: str = None,
                 admin_login: str = None,
                 admin_password: str = None):
        self.base_url = base_url or DEFAULT_BASE
        self.admin_login = admin_login or DEFAULT_LOGIN
        self.admin_password = admin_password or DEFAULT_PASSWORD
        self.session = requests.Session()
        # При необходимости разрешаем самоподписанные сертификаты в тестовой среде
        if ACCEPT_INSECURE_CERTS:
            self.session.verify = False
        # Если передан CERT_FILE, requests сам подхватит через REQUESTS_CA_BUNDLE/SSL_CERT_FILE
        self.created_users = []

    def _ensure_server_reachable(self):
        """Проверяем доступность сервера."""
        parsed = urlparse(self.base_url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)

        try:
            socket.getaddrinfo(host, port)
        except Exception as e:
            raise ConnectionError(f'Host not resolvable: {host}') from e

        try:
            response = self.session.head(self.base_url,
                                         timeout=5,
                                         allow_redirects=True)
            # Некоторые сервера блокируют HEAD — пробуем GET как fallback
            if response.status_code in (405, 501):
                response = self.session.get(self.base_url,
                                            timeout=5,
                                            allow_redirects=True)
        except requests.exceptions.ConnectionError as e:
            raise ConnectionError(
                f'Server not reachable: {self.base_url}') from e
        except requests.exceptions.Timeout as e:
            raise ConnectionError(f'Server timeout: {self.base_url}') from e
        except Exception as e:
            raise ConnectionError(f'Network error: {e}') from e

    def login_admin(self) -> bool:
        """Входим в систему как администратор."""
        try:
            # Получаем страницу логина
            login_page = self.session.get(f'{self.base_url}/login')
            if login_page.status_code not in [200, 302]:
                return False

            # Отправляем данные логина
            login_data = {
                'login': self.admin_login,
                'password': self.admin_password
            }

            response = self.session.post(f'{self.base_url}/login',
                                         data=login_data,
                                         allow_redirects=True)

            # Проверяем успешность входа (редирект на главную или наличие сессии)
            return response.status_code in [200, 302
                                            ] and '/login' not in response.url

        except Exception as e:
            print(f"Admin login failed: {e}")
            return False

    def create_user(self,
                    username: str,
                    password: str,
                    is_admin: bool = False,
                    groups: List[str] = None) -> bool:
        """Создаём пользователя через API."""
        try:
            user_data = {
                'login': username,
                'password': password,
                'is_admin': '1' if is_admin else '0'
            }

            # Добавляем группы если указаны
            if groups:
                user_data['groups'] = ','.join(groups)

            response = self.session.post(f'{self.base_url}/users/add',
                                         data=user_data)

            # Проверяем успешность создания
            success = response.status_code in [200, 302]
            if success:
                self.created_users.append(username)
                print(f"Created user: {username} (admin={is_admin})")

            return success

        except Exception as e:
            print(f"Failed to create user {username}: {e}")
            return False

    def create_group(self, group_name: str, description: str = None) -> bool:
        """Создаём группу через API."""
        try:
            group_data = {
                'group_name': group_name,
                'description': description or f'Test group {group_name}'
            }

            response = self.session.post(f'{self.base_url}/groups/add',
                                         data=group_data)

            success = response.status_code in [200, 302]
            if success:
                print(f"Created group: {group_name}")

            return success

        except Exception as e:
            print(f"Failed to create group {group_name}: {e}")
            return False

    def delete_user(self, username: str) -> bool:
        """Удаляем пользователя."""
        try:
            response = self.session.post(f'{self.base_url}/users/delete',
                                         data={'login': username})
            success = response.status_code in [200, 302]
            if success and username in self.created_users:
                self.created_users.remove(username)
                print(f"Deleted user: {username}")
            return success
        except Exception as e:
            print(f"Failed to delete user {username}: {e}")
            return False

    def cleanup_all_users(self):
        """Удаляем всех созданных тестовых пользователей."""
        for username in self.created_users.copy():
            self.delete_user(username)

    def create_test_users_suite(self) -> Dict[str, Dict]:
        """Создаёт полный набор тестовых пользователей с разными ролями."""
        print("Creating test users suite...")

        # Сначала создаём группы
        groups = ['qa_readers', 'qa_writers', 'qa_managers']
        for group in groups:
            self.create_group(group, f'QA test group: {group}')

        # Определяем набор пользователей
        users_config = {
            'qa_admin': {
                'password': 'QAtest123!',
                'is_admin': True,
                'description': 'QA Admin user'
            },
            'qa_manager': {
                'password': 'QAtest123!',
                'is_admin': False,
                'groups': ['qa_managers'],
                'description': 'QA Manager user'
            },
            'qa_writer': {
                'password': 'QAtest123!',
                'is_admin': False,
                'groups': ['qa_writers'],
                'description': 'QA Writer user'
            },
            'qa_reader': {
                'password': 'QAtest123!',
                'is_admin': False,
                'groups': ['qa_readers'],
                'description': 'QA Reader user'
            },
            'qa_regular': {
                'password': 'QAtest123!',
                'is_admin': False,
                'groups': [],
                'description': 'QA Regular user (no special groups)'
            }
        }

        created_users = {}

        # Создаём пользователей
        for username, config in users_config.items():
            success = self.create_user(username=username,
                                       password=config['password'],
                                       is_admin=config.get('is_admin', False),
                                       groups=config.get('groups', []))

            if success:
                created_users[username] = config
            else:
                print(f"Warning: Failed to create user {username}")

        return created_users

    def get_user_credentials(self, username: str) -> Optional[Tuple[str, str]]:
        """Получаем учётные данные пользователя."""
        if username == 'admin':
            return self.admin_login, self.admin_password

        # Для тестовых пользователей используем стандартный пароль
        return username, 'QAtest123!'


def create_test_users() -> TestUserManager:
    """Создаёт менеджер и полный набор тестовых пользователей."""
    manager = TestUserManager()

    try:
        manager._ensure_server_reachable()
        print(f"Server reachable: {manager.base_url}")

        if not manager.login_admin():
            raise ConnectionError("Failed to login as admin")

        print("Admin login successful")

        # Создаём полный набор тестовых пользователей
        users = manager.create_test_users_suite()
        print(f"Created {len(users)} test users")

        return manager

    except Exception as e:
        print(f"Failed to setup test users: {e}")
        raise


if __name__ == '__main__':
    """Запуск утилиты для создания тестовых пользователей."""
    import sys

    try:
        manager = create_test_users()
        print("\nTest users created successfully!")
        print("Users available:")
        for username in manager.created_users:
            print(f"  - {username}")

        # Сохраняем информацию о созданных пользователях
        with open('/tmp/qa_test_users.txt', 'w') as f:
            for username in manager.created_users:
                f.write(f"{username}:QAtest123!\n")

        print(f"\nCredentials saved to /tmp/qa_test_users.txt")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
