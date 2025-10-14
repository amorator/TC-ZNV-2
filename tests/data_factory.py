#!/usr/bin/env python3
import os
import requests
from io import BytesIO
from urllib.parse import urljoin


class DataFactory:
    """Простая фабрика данных для подготовки минимальных сущностей к UI‑тестам."""

    def __init__(self, base_url: str, session: requests.Session | None = None):
        self.base_url = base_url.rstrip('/')
        self.session = session or requests.Session()
        # verify берётся из REQUESTS_CA_BUNDLE/SSL_CERT_FILE окружения автоматически

    def ensure_category_with_sub(self, cat_name: str, sub_name: str) -> None:
        """Пытается создать категорию и подкатегорию. Игнорирует ошибки, если уже существуют."""
        try:
            cats = self._get_json('/api/categories') or []
        except Exception:
            cats = []

        # Категория
        cat_id = None
        for c in cats:
            try:
                if str(c.get('display_name')
                       or '').strip().lower() == cat_name.lower():
                    cat_id = c.get('id')
                    break
            except Exception:
                pass

        if not cat_id:
            # Попробуем POST в несколько возможных маршрутов
            payload = {
                'display_name': cat_name,
                'folder_name': cat_name.replace(' ', '_').lower(),
                'enabled': 'on'
            }
            for path in [
                    '/admin/categories/add', '/categories/add',
                    '/admin/category/add'
            ]:
                try:
                    r = self.session.post(urljoin(self.base_url + '/',
                                                  path.lstrip('/')),
                                          data=payload,
                                          allow_redirects=True,
                                          timeout=10)
                    if r.status_code in (200, 201, 302):
                        break
                except Exception:
                    pass
            # перечитаем список
            try:
                cats = self._get_json('/api/categories') or []
            except Exception:
                cats = []
            for c in cats:
                if str(c.get('display_name')
                       or '').strip().lower() == cat_name.lower():
                    cat_id = c.get('id')
                    break

        if not cat_id:
            return  # не удалось — ничего страшного для тестов

        # Подкатегория
        try:
            subs = self._get_json(f'/api/subcategories/{cat_id}') or []
        except Exception:
            subs = []
        for s in subs:
            try:
                if str(s.get('display_name')
                       or '').strip().lower() == sub_name.lower():
                    return
            except Exception:
                pass
        payload_sub = {
            'category_id': str(cat_id),
            'display_name': sub_name,
            'folder_name': sub_name.replace(' ', '_').lower(),
            'enabled': 'on'
        }
        for path in [
                '/admin/subcategories/add', '/subcategories/add',
                '/admin/subcategory/add'
        ]:
            try:
                r = self.session.post(urljoin(self.base_url + '/',
                                              path.lstrip('/')),
                                      data=payload_sub,
                                      allow_redirects=True,
                                      timeout=10)
                if r.status_code in (200, 201, 302):
                    break
            except Exception:
                pass

    def ensure_sample_file(self,
                           did: int | None = None,
                           sdid: int | None = None) -> None:
        """Пытается загрузить тестовый файл через доступные маршруты. Если нет API — молча пропускает."""
        # Простой текст в качестве заглушки
        sample = BytesIO(b"sample test content")
        files = {'file': ('sample.txt', sample, 'text/plain')}
        data = {}
        if did is not None: data['did'] = str(did)
        if sdid is not None: data['sdid'] = str(sdid)
        for path in ['/files/add', '/admin/files/add', '/api/files/upload']:
            try:
                r = self.session.post(urljoin(self.base_url + '/',
                                              path.lstrip('/')),
                                      data=data,
                                      files=files,
                                      timeout=20)
                if r.status_code in (200, 201, 302):
                    return
            except Exception:
                pass

    def _get_json(self, path: str):
        url = urljoin(self.base_url + '/', path.lstrip('/'))
        r = self.session.get(url, timeout=10)
        r.raise_for_status()
        return r.json()
