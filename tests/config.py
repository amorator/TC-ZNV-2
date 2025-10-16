"""Конфигурация UI/интеграционных тестов.
"""

# Базовый URL тестируемого сервера
BASE_URL = 'https://znv.vts.vitebsk.energo.net:8080'

# Учетные данные админа для UI сценариев
LOGIN = 'admin'
PASSWORD = 'admin'

# Настройки Selenium/браузера
PAGE_LOAD_TIMEOUT_SEC = 30
SCRIPT_TIMEOUT_SEC = 30
HEADLESS = True
ACCEPT_INSECURE_CERTS = True
