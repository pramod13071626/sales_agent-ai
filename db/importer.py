"""
Standalone Database Importer — Dedicated handler for UI/CLI 'Dump to Database' trigger.
Imports pre-validated enriched & social JSON runs into PostgreSQL.
100% Dynamic, Zero Hardcoding.
"""

import sys
import re
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


def backfill_enriched_personas(account_key_or_all: str = "all") -> Dict[str, Any]:
    """
    Backfill enriched persona data into the DB from per-persona enriched JSON files.

    Reads every JSON file from output/enriched/personas/<folder>/ and merges them
    into matching Persona records in the DB. This resolves the issue where personas
    imported from the main account enriched JSON have empty enriched columns because
    the enrichment data only exists in per-persona JSON files.

    Args:
        account_key_or_all: account key slug to backfill (e.g. 'blackrock', 'dtcc'),
                            or 'all' to process every available folder.

    Returns:
        Dict with backfill result stats.
    """
    from db.create_tables import ensure_schema_compatibility
    from db.connection import get_session
    from db.models.account import Account
    from db.repositories.persona_repo import PersonaRepository

    ensure_schema_compatibility()

    enriched_base = PIPELINE_ROOT / "output" / "enriched" / "personas"
    if not enriched_base.exists():
        return {"status": "error", "message": f"Enriched personas base dir not found: {enriched_base}"}

    # Collect folders to process
    if account_key_or_all.lower() == "all":
        folders = [f for f in enriched_base.iterdir() if f.is_dir()]
    else:
        slug = re.sub(r"[^a-z0-9]+", "_", account_key_or_all.lower()).strip("_")
        folders = [f for f in enriched_base.iterdir() if f.is_dir() and slug in f.name.lower().replace(" ", "_")]

    if not folders:
        return {"status": "error", "message": f"No enriched persona folders found for '{account_key_or_all}' in {enriched_base}"}

    print(f"[*] [Backfill] Processing {len(folders)} account folder(s)...")

    total_personas = 0
    results_by_account = {}

    for folder in sorted(folders):
        json_files = list(folder.glob("*_enriched.json"))
        if not json_files:
            continue

        # Try to detect account from first JSON file's metadata
        first_file = json_files[0]
        with open(first_file, encoding="utf-8") as f:
            sample = json.load(f)

        account_name_hint = sample.get("account_display_name") or sample.get("account_name") or folder.name

        session = get_session()
        try:
            # Find matching account in DB by key or display_name
            # Use multi-token word matching to handle special chars (e.g. & in folder names)
            acc = None

            def _find_account(hint: str) -> "Optional[Account]":
                """Try multiple strategies to match account by hint text."""
                # Strategy 1: slugified key match
                slug = re.sub(r"[^a-z0-9]+", "_", hint.lower()).strip("_")
                found = session.query(Account).filter(Account.key.ilike(f"%{slug}%")).first()
                if found:
                    return found
                # Strategy 2: display_name ILIKE with cleaned hint
                clean = re.sub(r"[^a-z0-9 ]+", " ", hint.lower()).strip()
                found = session.query(Account).filter(Account.display_name.ilike(f"%{clean}%")).first()
                if found:
                    return found
                # Strategy 3: match on significant words (≥5 chars) from hint
                words = [w for w in re.split(r"[^a-z0-9]+", hint.lower()) if len(w) >= 5]
                for word in words:
                    found = session.query(Account).filter(
                        Account.display_name.ilike(f"%{word}%")
                    ).first()
                    if found:
                        return found
                return None

            for attempt in [account_name_hint, str(folder.name)]:
                acc = _find_account(attempt)
                if acc:
                    break

            if not acc:
                print(f"[!] [Backfill] No account found in DB for folder '{folder.name}' — skipping")
                results_by_account[folder.name] = {"status": "skipped", "reason": "account not found in DB"}
                continue


            print(f"[+] [Backfill] Account matched: '{acc.display_name}' (id={acc.id}), {len(json_files)} personas to import")

            persona_repo = PersonaRepository(session)
            count = persona_repo.upsert_all_from_enriched_folder(acc, folder)
            session.commit()

            total_personas += count
            results_by_account[acc.key] = {
                "status": "success",
                "account_display_name": acc.display_name,
                "personas_upserted": count,
                "folder": str(folder),
            }
            print(f"[+] [Backfill] '{acc.display_name}': {count} personas committed.")

        except Exception as e:
            session.rollback()
            print(f"[!] [Backfill] Error for '{folder.name}': {e}")
            results_by_account[folder.name] = {"status": "error", "message": str(e)}
        finally:
            session.close()

    return {
        "status": "success",
        "total_personas_upserted": total_personas,
        "accounts_processed": len(results_by_account),
        "by_account": results_by_account,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sales AI Pipeline — Standalone Database Importer (UI Button Hook)")
    parser.add_argument("--file", type=str, help="Path to an _enriched.json file")
    parser.add_argument("--dir", type=str, help="Path to a date-partitioned run directory")
    parser.add_argument("--skip-validation", action="store_true", help="Skip pre-DB validation checks")
    parser.add_argument("--backfill", type=str, metavar="ACCOUNT_KEY",
                        help="Backfill enriched data from output/enriched/personas/<account_slug>/ into DB for an existing account. "
                             "Provide the account key (e.g. 'blackrock') or 'all' to backfill every account.")

    args = parser.parse_args()

    if args.backfill:
        result = backfill_enriched_personas(args.backfill)
        print(f"\n[Result]: {json.dumps(result, indent=2)}")
    else:
        target_path = args.file or args.dir
        if not target_path:
            print("[!] Please specify --file <path>, --dir <path>, or --backfill <account_key>.")
            parser.print_help()
            sys.exit(1)

        try:
            res = import_run_to_db(target_path, require_validation=not args.skip_validation)
            print(f"\n[Result]: {json.dumps(res, indent=2)}")
        except Exception as e:
            print(f"\n[!] Importer Error: {e}")
            sys.exit(1)
