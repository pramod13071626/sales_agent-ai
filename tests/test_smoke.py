"""Import-level smoke tests. Fail fast if the package graph is broken.

Deliberately avoids anything that touches a real database or network —
these run in CI with no secrets and no Postgres available.
"""

from datetime import UTC, datetime


def test_config_imports_with_safe_defaults():
    import config

    assert config.DATABASE_URL
    assert config.OUTPUT_DIR.exists()


def test_get_run_output_dirs_is_deterministic_per_call():
    import config

    dirs = config.get_run_output_dirs("Test Co.", run_dt=datetime(2026, 1, 1, tzinfo=UTC))
    assert dirs["safe_name"] == "test_co"
    assert dirs["date_str"] == "2026-01-01"


def test_account_schema_validates_minimal_payload():
    from db.schemas.account_schema import AccountSchema

    account = AccountSchema(key="acme", legal_name="Acme Corp")
    assert account.key == "acme"
    assert account.industries == []
