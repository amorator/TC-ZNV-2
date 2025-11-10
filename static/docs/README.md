## Индекс документации

### Руководства
- Пользователь: [USER_GUIDE.md](?doc=USER_GUIDE.md)
- Администратор: [ADMIN_GUIDE.md](?doc=ADMIN_GUIDE.md)
- Разработчик: [DEVELOPER_GUIDE.md](?doc=DEVELOPER_GUIDE.md)

### Справочно
- Поиск и пагинация: [SEARCH_AND_PAGINATION.md](?doc=SEARCH_AND_PAGINATION.md)

### Скриншоты
- Админ: [/static/docs/images/admin/](\/static\/docs\/images\/admin\/)
- Пользователь: [/static/docs/images/user/](\/static\/docs\/images\/user\/)
- Разработчик: [/static/docs/images/developer/](\/static\/docs\/images\/developer\/)

#### Генерация скриншотов (Headless Chrome/Chromium)
1) Установка:
```
scripts/install_docs_screens.sh
```
2) Съёмка скриншотов (укажите свои доступы):
```
ZNF_BASE_URL="http://localhost:8000" ZNF_USER="admin" ZNF_PASS="admin" scripts/run_docs_screens.sh
```
Скрины будут сохранены в `static/docs/images/user/` и используются в `USER_GUIDE.md`.

Актуальные примеры:
- Админ: [/static/docs/images/admin/users_search.png](\/static\/docs\/images\/admin\/users_search.png), [/static/docs/images/admin/categories_dual_search.png](\/static\/docs\/images\/admin\/categories_dual_search.png)
- Пользователь: [/static/docs/images/user/files.png](\/static\/docs\/images\/user\/files.png)
- Разработчик: [/static/docs/images/developer/orders_q.png](\/static\/docs\/images\/developer\/orders_q.png)

