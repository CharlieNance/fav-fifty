"""Shared FastAPI dependencies.

Common dependencies live here and are injected into routes via ``Depends(...)``.
This keeps routes thin and tests easy — a test can override a dependency to inject
a fake (e.g. a throwaway DB session or a stubbed user).

Coming in later phases, e.g.::

    def get_db() -> Iterator[Session]:
        '''Yield a database session, closing it afterwards.'''
        ...

    def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
        '''Validate the Cognito JWT and return the authenticated user.'''
        ...
"""
