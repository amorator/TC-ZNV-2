## Developer Guide

### Frontend: URL-based Search & Pagination
- Use `URLSearchParams` to read/write `q`, `page`, `page_size`.
- Categories/Registrators use `q_groups`, `q_users`, and separate pager params.
- Prefer `history.replaceState` to avoid reloads.
- Clear handlers must remove only their own `q*`.

### Backend Expectations
- Endpoints accept `q`, `page`, `page_size`.
- Categories/Registrators map `q_groups`/`q_users` to backend `q`.

### Scripts
- `scripts/bruteforce_md5.py`: CPU and Hashcat backends. See `BRUTEFORCE.md`.

### Screenshot Automation
- Headless Chrome via Playwright (.venv).
- Script: `scripts/docs_screenshots.py` (login, navigate, capture).
- Output paths under `docs/images/{user,admin,developer}`.
- To regenerate interactive scenarios, re-run the script after login env vars are set.

### Images
- See `docs/images/developer/` for screenshots.

Example (Orders with `q` parameter in URL):

![Orders with q](/usr/share/znf/docs/images/developer/20251105_090241_orders_q.png)

