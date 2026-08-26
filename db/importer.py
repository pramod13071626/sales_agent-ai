"""
Standalone Database Importer — Dedicated handler for UI/CLI 'Dump to Database' trigger.
Imports pre-validated enriched & social JSON runs into PostgreSQL.
100% Dynamic, Zero Hardcoding.
"""

import sys
import json
import argparse
from pathlib import Path
from typing import Dict, Any, Union, Optional

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE_ROOT))

from db.writer import persist_to_db
from collectors.validator import DataQualityValidator


def import_run_to_db(
    target: Union[str, Path],
    require_validation: bool = True
) -> Dict[str, Any]:
    """
    Imports a specific run folder or enriched JSON file into the PostgreSQL database.

    Args:
        target: Path to a run directory (e.g. output/2026-08-25/blackrock_153022/)
                OR direct path to an _enriched.json file.
        require_validation: If True, audits data first and blocks if critical errors exist.

    Returns:
        Structured result dict with DB status, counts, and commit timestamp.
    """
    path = Path(target)

    # 1. Resolve enriched and social JSON file paths
    if path.is_dir():
        enriched_files = list(path.glob("enriched/*_enriched*.json")) or list(path.glob("*_enriched*.json")) or list(path.rglob("*_enriched*.json"))
        social_files = list(path.glob("enriched/*_social_and_content*.json")) or list(path.glob("*_social_and_content*.json")) or list(path.rglob("*_social_and_content*.json"))
        if not enriched_files:
            raise FileNotFoundError(f"No enriched JSON file found in directory: {path}")
        enriched_path = enriched_files[0]
        social_path = social_files[0] if social_files else None
    else:
        enriched_path = path
        # Try to find matching social JSON in same directory
        stem = enriched_path.name.replace("_enriched", "_social_and_content")
        candidate = enriched_path.parent / stem
        social_path = candidate if candidate.exists() else None

    print(f"[*] [DB Importer] Reading: {enriched_path.name}...")
    with open(enriched_path, "r", encoding="utf-8") as f:
        enriched_doc = json.load(f)

    social_doc = None
    if social_path and social_path.exists():
        print(f"[*] [DB Importer] Reading matching launchpad: {social_path.name}...")
        with open(social_path, "r", encoding="utf-8") as f:
            social_doc = json.load(f)

    # 2. Pre-DB Validation Gate
    if require_validation:
        print("[*] [DB Importer] Running Pre-DB Validation Gate...")
        audit = DataQualityValidator.audit_run(enriched_doc, social_doc)
        meta = audit["audit_metadata"]
        score = meta["overall_quality_score"]
        grade = meta["quality_grade"]
        ready = meta["ready_for_db_dump"]

        print(f"    - Quality Score: {score}/100 (Grade: {grade})")
        if audit["critical_errors"]:
            msg = f"DB Dump Aborted. Critical validation errors found: {audit['critical_errors']}"
            print(f"[!] {msg}")
            return {"status": "error", "message": msg, "audit": audit}

    # 3. Synchronize Schema & Persist to PostgreSQL via Repositories
    print("[*] [DB Importer] Ensuring schema compatibility and persisting data into PostgreSQL (sales_ai)...")
    from db.create_tables import ensure_schema_compatibility
    ensure_schema_compatibility()
    persist_to_db(enriched_doc, social_doc)

    company_name = enriched_doc.get("account", {}).get("identity", {}).get("name") or "Unknown"
    account_key = enriched_doc.get("account", {}).get("required_account", {}).get("key") or "unknown"
    summary = enriched_doc.get("summary_meta", {}) or {}

    result = {
        "status": "success",
        "account_key": account_key,
        "company_name": company_name,
        "lobs_imported": summary.get("lobs_count", len(enriched_doc.get("lobs", []))),
        "personas_imported": summary.get("total_contacts_captured", 0),
        "source_file": str(enriched_path),
        "message": f"Successfully dumped '{company_name}' to sales_ai database."
    }
    print(f"[+] [DB Importer] {result['message']}")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sales AI Pipeline — Standalone Database Importer (UI Button Hook)")
    parser.add_argument("--file", type=str, help="Path to an _enriched.json file")
    parser.add_argument("--dir", type=str, help="Path to a date-partitioned run directory")
    parser.add_argument("--skip-validation", action="store_true", help="Skip pre-DB validation checks")

    args = parser.parse_args()

    target_path = args.file or args.dir
    if not target_path:
        print("[!] Please specify --file <path> or --dir <path>.")
        parser.print_help()
        sys.exit(1)

    try:
        res = import_run_to_db(target_path, require_validation=not args.skip_validation)
        print(f"\n[Result]: {json.dumps(res, indent=2)}")
    except Exception as e:
        print(f"\n[!] Importer Error: {e}")
        sys.exit(1)
