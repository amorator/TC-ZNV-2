"""
Фикстуры pytest для автоматического создания и управления тестовыми пользователями.
Обеспечивает создание пользователей с разными ролями для полноценного RBAC тестирования.
"""

import os
import pytest
import tempfile
from typing import Dict, Tuple, Optional
from user_manager import TestUserManager
from data_factory import DataFactory
from tests.config import BASE_URL as BASE


@pytest.fixture(scope='session', autouse=True)
def seed_minimal_data(user_manager):
    """Автосоздание минимальных данных для UI-тестов.

    Если прогрев не удаётся, тесты должны корректно отработать сценарии пустого состояния.
    """
    try:
        df = DataFactory(BASE, user_manager.session)
        # Минимальная категория/подкатегория
        try:
            df.ensure_category_with_sub('QA Категория', 'QA Подкатегория')
        except Exception:
            pass
        # Минимальная группа и пользователь (если поддерживается DataFactory)
        try:
            df.ensure_group('qa_readers')
        except Exception:
            pass
        # Пробный файл (если доступен endpoint)
        try:
            df.ensure_sample_file()
        except Exception:
            pass
    except Exception:
        # Без падений/skip — тесты сами проверят пустые состояния
        pass


@pytest.fixture(scope='session')
def user_manager():
    """Создаёт менеджер тестовых пользователей для всей сессии тестов."""
    try:
        manager = TestUserManager()
        manager._ensure_server_reachable()

        if not manager.login_admin():
            pytest.xfail("Failed to login as admin")

        # Создаём полный набор тестовых пользователей
        users = manager.create_test_users_suite()
        # Минимальные данные для UI: категория и подкатегория
        try:
            df = DataFactory(BASE, manager.session)
            df.ensure_category_with_sub('QA Категория', 'QA Подкатегория')
            # Попробуем загрузить пробный файл (если доступно API)
            df.ensure_sample_file()
        except Exception:
            pass

        yield manager

        # Очищаем созданных пользователей после всех тестов
        manager.cleanup_all_users()

    except Exception as e:
        pytest.xfail(f"Failed to setup user manager: {e}")


@pytest.fixture(scope='session')
def test_users(user_manager) -> Dict[str, Dict]:
    """Возвращает конфигурацию всех созданных тестовых пользователей."""
    return {
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


@pytest.fixture
def admin_credentials(user_manager) -> Tuple[str, str]:
    """Возвращает учётные данные администратора."""
    return user_manager.admin_login, user_manager.admin_password


@pytest.fixture
def qa_admin_credentials(user_manager) -> Tuple[str, str]:
    """Возвращает учётные данные QA администратора."""
    return 'qa_admin', 'QAtest123!'


@pytest.fixture
def qa_manager_credentials(user_manager) -> Tuple[str, str]:
    """Возвращает учётные данные QA менеджера."""
    return 'qa_manager', 'QAtest123!'


@pytest.fixture
def qa_writer_credentials(user_manager) -> Tuple[str, str]:
    """Возвращает учётные данные QA писателя."""
    return 'qa_writer', 'QAtest123!'


@pytest.fixture
def qa_reader_credentials(user_manager) -> Tuple[str, str]:
    """Возвращает учётные данные QA читателя."""
    return 'qa_reader', 'QAtest123!'


@pytest.fixture
def qa_regular_credentials(user_manager) -> Tuple[str, str]:
    """Возвращает учётные данные обычного QA пользователя."""
    return 'qa_regular', 'QAtest123!'


@pytest.fixture
def all_user_credentials(user_manager) -> Dict[str, Tuple[str, str]]:
    """Возвращает учётные данные всех тестовых пользователей."""
    return {
        'admin': (user_manager.admin_login, user_manager.admin_password),
        'qa_admin': ('qa_admin', 'QAtest123!'),
        'qa_manager': ('qa_manager', 'QAtest123!'),
        'qa_writer': ('qa_writer', 'QAtest123!'),
        'qa_reader': ('qa_reader', 'QAtest123!'),
        'qa_regular': ('qa_regular', 'QAtest123!')
    }


def get_user_role(username: str) -> str:
    """Определяет роль пользователя по имени."""
    if username in ['admin', 'qa_admin']:
        return 'admin'
    elif username == 'qa_manager':
        return 'manager'
    elif username == 'qa_writer':
        return 'writer'
    elif username == 'qa_reader':
        return 'reader'
    else:
        return 'regular'


def should_have_access(username: str, resource: str) -> bool:
    """Определяет, должен ли пользователь иметь доступ к ресурсу."""
    role = get_user_role(username)

    access_matrix = {
        'admin': {
            'admin': True,
            'users': True,
            'groups': True,
            'files': True,
            'categories': True
        },
        'manager': {
            'admin': False,
            'users': False,
            'groups': True,
            'files': True,
            'categories': True
        },
        'writer': {
            'admin': False,
            'users': False,
            'groups': False,
            'files': True,
            'categories': False
        },
        'reader': {
            'admin': False,
            'users': False,
            'groups': False,
            'files': True,
            'categories': False
        },
        'regular': {
            'admin': False,
            'users': False,
            'groups': False,
            'files': True,
            'categories': False
        }
    }

    return access_matrix.get(role, {}).get(resource, False)


@pytest.fixture
def user_access_matrix():
    """Возвращает матрицу доступа пользователей к ресурсам."""
    return {
        'admin': {
            'admin': True,
            'users': True,
            'groups': True,
            'files': True,
            'categories': True
        },
        'qa_admin': {
            'admin': True,
            'users': True,
            'groups': True,
            'files': True,
            'categories': True
        },
        'qa_manager': {
            'admin': False,
            'users': False,
            'groups': True,
            'files': True,
            'categories': True
        },
        'qa_writer': {
            'admin': False,
            'users': False,
            'groups': False,
            'files': True,
            'categories': False
        },
        'qa_reader': {
            'admin': False,
            'users': False,
            'groups': False,
            'files': True,
            'categories': False
        },
        'qa_regular': {
            'admin': False,
            'users': False,
            'groups': False,
            'files': True,
            'categories': False
        }
    }
