import os
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# PostgreSQL Database Configuration
POSTGRES_DB = os.getenv("POSTGRES_DB", "sales_ai")
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgres")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

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
DATA_GOV_API_KEY = os.getenv("DATA_GOV_API_KEY", "")
DIFFBOT_TOKEN = os.getenv("DIFFBOT_TOKEN", "")

# OpenAI (persona dossier synthesis)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

DEFAULT_HIERARCHY_LIMIT = int(os.getenv("DEFAULT_HIERARCHY_LIMIT", "50"))
OUTPUT_DIR = BASE_DIR / os.getenv("OUTPUT_DIR", "output")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_run_output_dirs(company_name: str, run_dt: datetime = None):
    """
    Generates date-partitioned, source-categorized directory paths for a pipeline run.
    Structure:
        output/
        └── YYYY-MM-DD/
            └── <company>_<HHMMSS>/
                ├── raw/
                │   ├── apify/
                │   ├── apollo/
                │   ├── sec_edgar/
                │   ├── exa/
                │   └── tavily/
    """
    dt = run_dt or datetime.now(timezone.utc)
    date_str = dt.strftime("%Y-%m-%d")
    time_str = dt.strftime("%H%M%S")
    timestamp_str = f"{date_str.replace('-', '')}_{time_str}"
    safe_name = company_name.lower().replace(" ", "_").replace(".", "").replace(",", "")

    # Base date folder
    date_dir = OUTPUT_DIR / date_str
    run_dir = date_dir / f"{safe_name}_{time_str}"

    # Raw source directories
    raw_dir = run_dir / "raw"
    raw_apify_dir = raw_dir / "apify"
    raw_apollo_dir = raw_dir / "apollo"
    raw_sec_dir = raw_dir / "sec_edgar"
    raw_exa_dir = raw_dir / "exa"
    raw_tavily_dir = raw_dir / "tavily"

    # Enriched output directories
    enriched_dir = run_dir / "enriched"
    enriched_lobs_dir = enriched_dir / "lobs"
    enriched_personas_dir = enriched_dir / "personas"
    enriched_lobs_company_dir = enriched_lobs_dir / safe_name
    enriched_personas_company_dir = enriched_personas_dir / safe_name

    # Create all directories atomically
    for d in [
        date_dir, run_dir, raw_dir,
        raw_apify_dir, raw_apollo_dir, raw_sec_dir, raw_exa_dir, raw_tavily_dir,
        enriched_dir, enriched_lobs_dir, enriched_personas_dir,
        enriched_lobs_company_dir, enriched_personas_company_dir
    ]:
        d.mkdir(parents=True, exist_ok=True)

    return {
        "date_str": date_str,
        "time_str": time_str,
        "timestamp_str": timestamp_str,
        "safe_name": safe_name,
        "run_dir": run_dir,
        "raw_dir": raw_dir,
        "raw_apify_dir": raw_apify_dir,
        "raw_apollo_dir": raw_apollo_dir,
        "raw_sec_dir": raw_sec_dir,
        "raw_exa_dir": raw_exa_dir,
        "raw_tavily_dir": raw_tavily_dir,
        "enriched_dir": enriched_dir,
        "enriched_lobs_dir": enriched_lobs_dir,
        "enriched_personas_dir": enriched_personas_dir,
        "enriched_lobs_company_dir": enriched_lobs_company_dir,
        "enriched_personas_company_dir": enriched_personas_company_dir,
        "enriched_json_path": enriched_dir / f"{safe_name}_enriched_{timestamp_str}.json",
        "social_json_path": enriched_dir / f"{safe_name}_social_and_content_{timestamp_str}.json",
        "validation_report_path": enriched_dir / f"{safe_name}_validation_report_{timestamp_str}.json",
        "telemetry_json_path": enriched_dir / f"{safe_name}_telemetry_{timestamp_str}.json",
    }
