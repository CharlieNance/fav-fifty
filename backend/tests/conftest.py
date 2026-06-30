"""Shared pytest fixtures.

Fixtures defined here are available to every test without importing. As the app
grows this is where we'll add things like a test database session and an
authenticated test client.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    """A TestClient wrapping a fresh app instance for each test."""
    return TestClient(create_app())
