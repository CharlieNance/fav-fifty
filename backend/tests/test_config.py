"""Deploy-time config guards: a deployed app can't boot with development behavior."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings

REAL_KEY = "a-real-secret-key-for-tests"


def _settings(**values: object) -> Settings:
    # _env_file=None: only the values given here, never a developer's backend/.env.
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def test_local_development_needs_nothing() -> None:
    assert _settings().is_development


@pytest.mark.parametrize("target", ["lightsail", "lambda"])
def test_a_deployed_target_refuses_development(target: str) -> None:
    with pytest.raises(ValidationError, match="dev-login"):
        _settings(deploy_target=target, origin_verify_secret="x", secret_key=REAL_KEY)


def test_the_box_requires_the_origin_secret() -> None:
    with pytest.raises(ValidationError, match="ORIGIN_VERIFY_SECRET"):
        _settings(deploy_target="lightsail", app_env="production", secret_key=REAL_KEY)


def test_a_hardened_box_boots() -> None:
    config = _settings(
        deploy_target="lightsail",
        app_env="production",
        secret_key=REAL_KEY,
        origin_verify_secret="s3cret",
    )
    assert not config.is_development
