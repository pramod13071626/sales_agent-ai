"""Which .env file the content pipeline reads.

Inside the sales_agent-ai monorepo there is ONE .env, at the repo root, shared
with the main app. A .env next to this file still wins if one exists — that is
how a standalone checkout of this pipeline keeps working (the production
server instead injects ~/data_scrapper.env through docker-compose env_file).

Neither file overrides variables already set in the real environment.
"""
import os

from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL_ENV = os.path.join(_HERE, ".env")
MONOREPO_ENV = os.path.normpath(os.path.join(_HERE, "..", "..", ".env"))


def load_env() -> None:
    for path in (LOCAL_ENV, MONOREPO_ENV):
        if os.path.exists(path):
            load_dotenv(path)
