# Fav Fifty — Backend (FastAPI)

The Python API for Fav Fifty. **Status: skeleton** — a `/health` endpoint and its test,
plus documented placeholder folders for the layers we'll fill in next. No database or
auth code yet.

## Layout

```
backend/
├── pyproject.toml          # project metadata, dependencies, tool config (ruff, pytest)
├── .python-version         # pins Python 3.12
├── app/
│   ├── main.py             # app factory + entrypoint (create_app, registers routers)
│   ├── core/               # cross-cutting concerns
│   │   └── config.py       # Settings (pydantic-settings, reads env / .env)
│   ├── api/                # HTTP layer
│   │   ├── deps.py         # shared Depends() — get_db, get_current_user (later)
│   │   └── routes/         # one router module per feature
│   │       └── health.py   # GET /health
│   ├── schemas/            # Pydantic request/response models (the API contract)
│   ├── services/           # business logic — routers delegate here
│   ├── models/             # SQLAlchemy ORM models (DB tables) — added with Postgres
│   └── db/
│       └── session.py      # engine / session / Base — placeholder until Postgres
└── tests/
    ├── conftest.py         # shared fixtures (e.g. the `client` fixture)
    └── test_health.py      # sanity test
```

## How a request flows (the layering)

```
HTTP request
   → api/routes/*       (validate input via schemas, call a service)
      → services/*      (business rules, authorization, orchestration)
         → models/ + db (read/write the database)
   ← schemas/*          (shape the response)
```

Why this split: routers stay thin, business logic is unit-testable without HTTP, and
the public API (schemas) can evolve independently of the database (models). Each new
feature — lists, items, tags, comments — adds a slice across these same layers.

## Prerequisites

- **Python 3.12**
- **[uv](https://docs.astral.sh/uv/)** (recommended) — fast installer/runner. Plain `pip` works too.

## Running locally

> Dependencies aren't installed yet — these are the commands for when you are ready.

With **uv** (from `backend/`):

```bash
uv sync --extra dev                  # create venv + install deps
uv run uvicorn app.main:app --reload # serve at http://localhost:8000
```

With **pip**:

```bash
python -m venv .venv && source .venv/Scripts/activate   # Windows; use bin/activate on macOS/Linux
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Then visit:
- http://localhost:8000/health → `{"status": "ok"}`
- http://localhost:8000/docs → auto-generated Swagger UI

## Tests & linting

```bash
uv run pytest          # or: pytest
uv run ruff check .    # lint
uv run ruff format .   # format
```

## Configuration

Config is read from environment variables via `app/core/config.py` (pydantic-settings).
For local dev, create `backend/.env` (git-ignored) or export real env vars. The
repo-root [`.env.example`](../.env.example) documents every variable. Secrets never get
committed; in AWS they come from Secrets Manager / SSM.

## Backend roadmap

- [x] **Skeleton:** app factory, config, `/health`, test harness
- [ ] **Database layer:** add SQLAlchemy + Alembic; define `engine`/`SessionLocal`/`Base` in `db/session.py`; add `DATABASE_URL` to settings; `get_db` dependency
- [ ] **First models + migration:** `user`, `list`, `list_item`, `tag`, `list_tag`
- [ ] **Auth:** validate Cognito JWTs; `get_current_user`; protected `GET /me`
- [ ] **Lists feature slice:** schemas → service → router for list CRUD (owner-scoped), with tests
- [ ] **Items & tags:** ordered items (text/note/image URL), free-form tags; publish/unpublish
- [ ] **Containerization:** `Dockerfile` for deployment to Lightsail

See [../docs/NEXT_STEPS.md](../docs/NEXT_STEPS.md) for the full project roadmap.
