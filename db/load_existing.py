"""
Load Existing JSONs — Loads all existing enriched JSON files into the database.
Run: python pipeline/db/load_existing.py
"""

import sys
import json
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE_ROOT))

import config
from db.writer import persist_to_db


def load_company(company_slug: str):
    """Loads a single company's enriched + social JSONs into the database."""
    enriched_path = config.OUTPUT_DIR / f"{company_slug}_enriched.json"
    social_path = config.OUTPUT_DIR / f"{company_slug}_social_and_content.json"

    if not enriched_path.exists():
        print(f"[SKIP] {enriched_path.name} not found.")
        return

    print(f"[*] Loading {enriched_path.name} into database...")
    with open(enriched_path, "r", encoding="utf-8") as f:
        enriched_doc = json.load(f)

    social_doc = None
    if social_path.exists():
        with open(social_path, "r", encoding="utf-8") as f:
            social_doc = json.load(f)
        print(f"[*] Also loading {social_path.name}...")

    persist_to_db(enriched_doc, social_doc)


if __name__ == "__main__":
    # Auto-discover all enriched JSONs in the output directory
    output_dir = config.OUTPUT_DIR
    enriched_files = sorted(output_dir.glob("*_enriched.json"))

    if not enriched_files:
        print("[!] No enriched JSON files found in output directory.")
        sys.exit(1)

    print(f"[*] Found {len(enriched_files)} enriched JSON file(s) to load:")
    for ef in enriched_files:
        print(f"    - {ef.name}")

    print()
    for ef in enriched_files:
        slug = ef.stem.replace("_enriched", "")
        load_company(slug)

    print("\n[DONE] All existing data loaded into sales_ai database.")
