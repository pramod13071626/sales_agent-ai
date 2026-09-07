"""Import-level smoke tests for the content_pipeline app.

Run from this app's own directory (see .github/workflows/code-quality.yml) so
`import config`/`import paths` resolve here, not to the root app's modules of
the same name. Avoids anything touching a real Apify/Postgres connection.
"""


def test_config_imports_with_safe_defaults():
    import config

    assert isinstance(config.ACTORS, dict)
    assert "linkedin" in config.ACTORS


def test_paths_are_anchored_to_this_directory():
    import os

    import paths

    assert paths.PROJECT_ROOT == os.path.dirname(os.path.abspath(paths.__file__))
    assert paths.OUTPUT_DIR.startswith(paths.PROJECT_ROOT)


def test_store_path_uses_company_key():
    import paths

    path = paths.store_path("acme")
    assert path.endswith("acme_output.json")
