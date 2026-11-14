"""Sanity test for the health endpoint — also confirms the test harness works."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "deploy_target": "local", "git_sha": "unknown"}


def test_health_reports_the_deploy_target_and_build(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "deploy_target", "lambda")
    monkeypatch.setattr(settings, "git_sha", "c7deb41")

    body = client.get("/health").json()

    assert body["deploy_target"] == "lambda"
    assert body["git_sha"] == "c7deb41"
