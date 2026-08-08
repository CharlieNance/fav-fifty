---
name: run
description: Use when asked to run, start, launch, or drive the Fav Fifty app — a Vue 3 SPA talking to a FastAPI backend. Covers booting all three local services and signing in without real Google/Cognito credentials. Project-specific bits only; chromium-cli (or whatever browser driver is available) handles the mechanics of driving the page.
---

# Running Fav Fifty locally

Fav Fifty is a **browser-driven web app**: a Vue 3 + Vite SPA (port 5173) calling a
FastAPI backend (port 8000), backed by Postgres. There is no native/desktop shell and
no separate CLI to exercise — to check a change, boot all three and drive the SPA in a
real browser.

## 1. Start everything

```bash
./tools/run_dev.sh
```

Starts Postgres (via `docker compose`), the backend (`uv run uvicorn app.main:app
--reload`), and the frontend (`npm run dev`) in the background. Logs land in
`logs/backend.log` / `logs/frontend.log` (git-ignored) — tail those if something
doesn't come up. Safe to rerun; it skips anything already running.

- Frontend: **http://localhost:5173**
- Backend + Swagger docs: **http://localhost:8000/docs**

First time only: `cd backend && uv sync --extra dev`, `cd frontend && npm install`,
and copy `backend/.env.example` → `backend/.env` (defaults work as-is for local dev —
see below). Run `./tools/verify_alembic.sh` if you're unsure the DB schema is current;
`./tools/db_reset.sh` wipes and rebuilds it from migrations if state gets weird.

When done: `./tools/stop_dev.sh` (stops backend + frontend; leaves Postgres running,
which is fine — `docker compose down` if you want it stopped too).

## 2. Signing in — use the dev-login stub, not real Google auth

Real "Continue with Google" goes through Cognito, which needs live `COGNITO_*` /
`GOOGLE_*` credentials (see [docs/SETUP.md](../../../docs/SETUP.md)) — **don't try to
drive that flow**, it can't be automated and isn't configured for most local checkouts.

Instead, with `backend/.env` left at its defaults (all `COGNITO_*` values blank,
`APP_ENV=development`), the login page renders a second button:

**🧪 Dev login (stub)**

Click it (or `POST http://localhost:8000/auth/dev-login` directly if you only need an
authenticated session and don't care about the UI) to sign in as a fixed dev user —
no form, no redirect, one request. It sets the same `HttpOnly` session cookie the real
flow would. Only rendered in Vite dev mode and only live when the backend is genuinely
in `development` (404s otherwise — see `backend/app/api/routes/auth.py` and
`backend/tests/test_auth.py`).

Typical flow for a chromium-cli script: navigate to `http://localhost:5173/login`,
click **"🧪 Dev login (stub)"**, wait for the redirect back to `/`, then continue with
whatever you're actually testing.

## 3. If `chromium-cli` (or similar) isn't available

Fall back to whatever browser automation is available, or ask the user to check the
change manually — the steps above (boot, then dev-login) are what matters; the browser
driver is just the mechanics.
