"""Database session & engine setup.

Intentionally a placeholder — the current health-check slice needs no database.

When we add PostgreSQL (Aurora Serverless v2) this module will define:
  * the SQLAlchemy ``engine`` (from ``settings.database_url``),
  * a ``SessionLocal`` factory,
  * the declarative ``Base`` that models inherit from,

and ``app/api/deps.py`` will expose a ``get_db`` dependency that yields a session.
Schema changes will be managed with Alembic migrations (never hand-edited).
"""
