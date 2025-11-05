# Search and Pagination Behavior

This project standardizes search persistence and pagination using URL parameters across key pages. LocalStorage-based search persistence has been removed in favor of URL-driven state.

## Global Rules

- Search is persisted in the URL using explicit parameters.
- Clearing search removes only its own `q` parameter and preserves pagination where applicable.
- Pagination parameters are reflected in the URL and preserved across soft reloads.
- Inline `onclick` handlers on clear buttons are removed; event listeners manage clearing robustly.

## Pages

### Users (`/users`)
- Search parameter: `q`
- Pagination parameters: `page`, `page_size`
- Behavior:
  - Typing in the search input updates `q` and hides the pager while searching.
  - Clearing search removes `q`, restores pager, and keeps or restores `page`/`page_size`.
  - Pager clicks update `page`/`page_size` in the URL and are respected on reload.

### Groups (`/groups`)
- Search parameter: `q`
- Pagination parameters: `page`, `page_size`
- Mirrors Users behavior.

### Orders (`/orders`)
- Search parameter: `q`
- Pagination parameters: `page`, `page_size`
- Behavior:
  - Clear button removes `q` while preserving `page`/`page_size` and triggers a table reload.
  - Debounced search requests to reduce server load.

### Files (`/files`)
- Search parameter: `q`
- Pagination parameters: `page`, `page_size`
- Behavior:
  - Search updates `q`, `page`, and `page_size` in the URL.
  - Clear button removes `q` and reloads the page list; pager state stays in the URL.

### Categories (`/categories`) and Registrators (`/registrators`)
- Two independent search inputs and pagers: Groups and Users.
- URL parameters:
  - Groups: `q_groups`, `page_groups`, `page_size_groups`
  - Users: `q_users`, `page_users`, `page_size_users`
- Behavior:
  - Each input restores from its own `q_*` parameter and updates only that parameter on input/change.
  - Each clear button removes only its corresponding `q_*` and reloads just its table.
  - Pagination of one table does not reset the search or pagination of the other.
  - The generic `q` is removed whenever `q_groups` or `q_users` is set.
- Navigation defaults:
  - Top menu links to `/categories` and `/registrators` are rewritten to append defaults if missing:
    - `page_groups=1&page_size_groups=10&page_users=1&page_size_users=10`
  - On initial load of these pages, missing pager params are added to the current URL as above.

## DOM and Event Handling

- Clear button handling is attached via `addEventListener` (capture phase when needed) and removes any inline `onclick` attributes.
- Debouncing is used for `input` events to avoid excessive requests.
- Delegated click handlers provide robustness for dynamically re-rendered buttons.

## Backend Expectations

- Endpoints accept `q`, `page`, and `page_size` parameters:
  - `/api/users`, `/api/groups`, `/files/search`, `/api/orders/search`
- Categories/Registrators use `/api/users` and `/api/groups` with their respective `q_*` values mapped to `q` on the request.

## Notes

- URL updates use `window.history.replaceState` to avoid full reloads.
- Pagination normalization ensures pager links always contain explicit `page` and `page_size`.

