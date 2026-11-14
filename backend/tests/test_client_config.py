"""``GET /api/v1/config/client`` — the public runtime config clients validate against."""

from collections.abc import Callable

from fastapi.testclient import TestClient

from app.core.runtime_settings import Limits, RuntimeSettings


def test_client_config_is_public_and_serves_the_defaults(client: TestClient) -> None:
    response = client.get("/config/client")

    assert response.status_code == 200
    assert response.json() == {"limits": {"max_tags_per_list": 25}}


def test_client_config_follows_the_runtime_settings(
    client: TestClient, set_runtime_settings: Callable[[RuntimeSettings], None]
) -> None:
    set_runtime_settings(RuntimeSettings(limits=Limits(max_tags_per_list=7)))

    assert client.get("/config/client").json()["limits"]["max_tags_per_list"] == 7
