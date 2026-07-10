"""Shared FastAPI dependencies.

Injected into routes via ``Depends(...)`` to keep routes thin and tests easy — a
test can override a dependency to inject a fake (e.g. a throwaway DB session).

``get_db`` is defined in ``app/db/session.py`` and re-exported here so routes have
a single, predictable import location for dependencies.
"""

from app.db.session import get_db

__all__ = ["get_db"]

# Coming in later phases, e.g.:
#
#   def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
#       '''Validate the Cognito JWT and return the authenticated user.'''
#       ...
