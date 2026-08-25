import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

POSTGRES_DB = os.getenv("POSTGRES_DB", "sales_ai")
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgres")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

# Redis & Celery Configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
if REDIS_PASSWORD:
    REDIS_URL = os.getenv("REDIS_URL", f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}")
else:
    REDIS_URL = os.getenv("REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}")

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", REDIS_URL)
CELERY_SCHEDULE_DAYS = int(os.getenv("CELERY_SCHEDULE_DAYS", "15"))

# Monid.ai Gateway
MONID_API_KEY = os.getenv("MONID_API_KEY", "")
MONID_BASE_URL = os.getenv("MONID_BASE_URL", "https://api.monid.ai/v1")

# Apify
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")

# AI Enrichment APIs
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
EXA_API_KEY = os.getenv("EXA_API_KEY", "")
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "")
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")

DEFAULT_HIERARCHY_LIMIT = int(os.getenv("DEFAULT_HIERARCHY_LIMIT", "50"))
OUTPUT_DIR = BASE_DIR / os.getenv("OUTPUT_DIR", "output")
RAW_APIFY_DIR = OUTPUT_DIR / "raw" / "apify"
RAW_APOLLO_DIR = OUTPUT_DIR / "raw" / "apollo"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
RAW_APIFY_DIR.mkdir(parents=True, exist_ok=True)
RAW_APOLLO_DIR.mkdir(parents=True, exist_ok=True)
