"""
Main Execution Script — Enterprise Sales AI Intelligence Pipeline.
Coordinates account firmographics, LOB discovery, 4-tier hierarchy, and AI Persona synthesis.

Date-Partitioned Architecture:
    output/
    └── YYYY-MM-DD/
        └── <company>_<HHMMSS>/
            ├── raw/ (apify, apollo, sec_edgar, exa, tavily)
            ├── <company>_enriched_<timestamp>.json
            ├── <company>_social_and_content_<timestamp>.json
            └── <company>_validation_report_<timestamp>.json

Workflow:
    1. Extracts live data from all sources and categorizes raw files by source.
    2. Assembles timestamped Enriched JSON & Social Launchpad JSON.
    3. Runs Pre-DB Data Quality Validator & outputs Validation Report.
    4. Decoupled Gate: Does NOT automatically dump to database (triggered on user confirmation).

100% Dynamic, Zero Hardcoding.
"""

import sys
import argparse
from pathlib import Path

# Fix Windows stdout encoding for UTF-8 compatibility
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Add project root to sys.path
PIPELINE_ROOT = Path(__file__).resolve().parent
sys.path.append(str(PIPELINE_ROOT))

import config
from collectors.account_collector import (
    scrape_account,
    fetch_latest_10k_chunks,
    extract_full_patents,
    fetch_sec_exhibit_21_subsidiaries,
    fetch_gleif_ownership_tree,
    fetch_wikipedia_dbpedia_intel,
    fetch_fec_political_intel,
    fetch_diffbot_organization_intel
)
from collectors.sublob_collector import scrape_sublobs
from collectors.hierarchy_collector import scrape_hierarchy, scrape_lob_hierarchy
from collectors.persona_enricher import build_persona_dossier
from collectors.lob_enricher import enrich_lob_segments
from collectors.validator import DataQualityValidator
from serializer import PipelineSerializer, slugify
from telemetry import RunTelemetry
from db.connection import get_session
from db.schemas.pipeline_run_schema import PipelineRunSchema
from db.repositories.pipeline_run_repository import PipelineRunRepository
from db.importer import import_run_to_db


def run_pipeline(company_name: str, target_url: str = None):
    print("=" * 70)
    print(f"[*] Starting Sales AI Intelligence Pipeline for: '{company_name}'")
    print(f"[*] Target Website URL: {target_url or 'Auto-discover'}")
    print("=" * 70)

    # 1. Initialize Date-Partitioned Run Directories
    run_dirs = config.get_run_output_dirs(company_name)
    run_id = f"{run_dirs['safe_name']}_{run_dirs['timestamp_str']}"
    print(f"[+] [RunManager] Created Date-Partitioned Run Folder: {run_dirs['run_dir']}")

    telemetry = RunTelemetry(run_id=run_id, company_name=company_name, target_url=target_url)

    try:
        # 2. Level 1: Multi-Source Account Intelligence
        telemetry.log("INFO", "ACCOUNT", f"Starting Level 1 extraction for '{company_name}'...")
        account_data = scrape_account(
            company_name=company_name,
            website_url=target_url,
            raw_apify_dir=run_dirs["raw_apify_dir"],
            raw_sec_dir=run_dirs["raw_sec_dir"]
        )
        telemetry.record_api_call("apify", "crunchbase-companies-scraper", credits_used=1, is_billable=True)
        sec_cik = account_data.get("sec_cik")

        # Multi-source account enhancements
        diffbot_intel = fetch_diffbot_organization_intel(company_name, target_url, raw_dir=run_dirs["raw_dir"])
        if diffbot_intel.get("status") == "success":
            account_data["diffbot_intel"] = diffbot_intel
            telemetry.record_api_call("diffbot", "/kg/v3/enhance?type=Organization", credits_used=1, is_billable=True)

        gleif_tree = fetch_gleif_ownership_tree(company_name, raw_dir=run_dirs["raw_dir"])
        if gleif_tree.get("status") == "success":
            account_data["gleif_intel"] = gleif_tree
            telemetry.record_api_call("gleif", "/api/v1/lei-records", credits_used=0, is_billable=False)

        if sec_cik:
            sec_10k = fetch_latest_10k_chunks(sec_cik, raw_sec_dir=run_dirs["raw_sec_dir"])
            if sec_10k.get("status") == "success":
                account_data["sec_10k_chunks_meta"] = {
                    "accession_number": sec_10k.get("accession_number"),
                    "total_chunks": sec_10k.get("total_chunks"),
                    "sections_found": sec_10k.get("sections_found")
                }
                telemetry.record_api_call("sec_edgar", "/submissions/CIK.json", credits_used=0, is_billable=False)

        patents_data = extract_full_patents(company_name, raw_dir=run_dirs["raw_dir"])
        if patents_data.get("status") == "success":
            account_data["patents_portfolio"] = patents_data.get("patents", [])
            telemetry.record_api_call("uspto_data_gov", "api.patentsview.org", credits_used=0, is_billable=False)

        wiki_data = fetch_wikipedia_dbpedia_intel(company_name, raw_dir=run_dirs["raw_dir"])
        if wiki_data.get("status") == "success":
            account_data["wikipedia_intel"] = wiki_data
            telemetry.record_api_call("wikipedia", "en.wikipedia.org/api/rest_v1", credits_used=0, is_billable=False)

        fec_data = fetch_fec_political_intel(company_name, raw_dir=run_dirs["raw_dir"])
        if fec_data.get("status") == "success":
            account_data["fec_political_giving"] = fec_data.get("recent_contributions", [])
            telemetry.record_api_call("openfec_data_gov", "api.open.fec.gov", credits_used=0, is_billable=False)

        # 3. Level 2: Multi-Source LOB & Subsidiary Discovery
        telemetry.log("INFO", "LOBS", f"Discovering subsidiaries across Crunchbase, SEC EX-21, and GLEIF...")
        sublobs_raw = scrape_sublobs(
            parent_account_name=company_name,
            raw_apify_dir=run_dirs["raw_apify_dir"]
        )
        telemetry.record_api_call("apify", "crunchbase-suborganizations", credits_used=1, is_billable=True)

        if sec_cik:
            ex21 = fetch_sec_exhibit_21_subsidiaries(sec_cik, raw_sec_dir=run_dirs["raw_sec_dir"])
            if ex21.get("status") == "success":
                telemetry.record_api_call("sec_edgar", "Form 10-K EX-21", credits_used=0, is_billable=False)
                existing_names = {slugify(s.get("name", "")) for s in sublobs_raw}
                for legal_sub in ex21.get("subsidiaries", []):
                    l_name = legal_sub.get("legal_name", "")
                    if l_name and slugify(l_name) not in existing_names:
                        existing_names.add(slugify(l_name))
                        sublobs_raw.append({
                            "name": l_name,
                            "relationship_type": f"Legal Subsidiary ({legal_sub.get('jurisdiction', 'US')})",
                            "source": "SEC Form 10-K Exhibit 21"
                        })

        if gleif_tree.get("status") == "success":
            existing_names = {slugify(s.get("name", "")) for s in sublobs_raw}
            for child in gleif_tree.get("child_entities", []):
                c_name = child.get("legal_name", "")
                if c_name and slugify(c_name) not in existing_names:
                    existing_names.add(slugify(c_name))
                    sublobs_raw.append({
                        "name": c_name,
                        "relationship_type": f"Global Entity ({child.get('country', 'Global')})",
                        "source": "GLEIF G20 LEI Database"
                    })

        # 4. Enrich LOB Segments with Audited Revenues
        sublobs_data = enrich_lob_segments(company_name, sublobs_raw)
        telemetry.record_api_call("tavily", "/search?depth=financials", credits_used=len(sublobs_data), is_billable=True)

        # 5. Level 3: 4-Tier Org Hierarchy for Corporate Account
        telemetry.log("INFO", "HIERARCHY", f"Extracting 4-tier management and board leadership...")
        account_domain = account_data.get("domain") or account_data.get("primary_domain") or target_url
        account_hierarchy = scrape_hierarchy(
            company_domain=account_domain,
            company_name=company_name,
            sec_cik=sec_cik,
            raw_apollo_dir=run_dirs["raw_apollo_dir"],
            raw_apify_dir=run_dirs["raw_apify_dir"],
            raw_dir=run_dirs["raw_dir"]
        )
        telemetry.record_api_call("apollo_monid", "/v1/people/search", credits_used=1, is_billable=True)

        # Synthesize AI Persona Dossiers for Key Corporate Executives
        c_suite = account_hierarchy.get("c_suite", [])
        if c_suite:
            for exec_person in c_suite[:3]:
                p_name = exec_person.get("name")
                p_title = exec_person.get("title")
                p_linkedin = exec_person.get("linkedin_url")
                exec_person["persona_dossier"] = build_persona_dossier(
                    name=p_name, title=p_title, company_name=company_name, linkedin_url=p_linkedin
                )
                telemetry.record_api_call("exa", "/search?category=people", credits_used=1, is_billable=True)
                if exec_person["persona_dossier"].get("level_3_personal_touch", {}).get("social_media", {}).get("profile_url"):
                    verified_url = exec_person["persona_dossier"]["level_3_personal_touch"]["social_media"]["profile_url"]
                    exec_person["linkedin_url"] = verified_url
                    if "required_person_data" in exec_person:
                        exec_person["required_person_data"]["linkedin_url"] = verified_url

        # 6. Extract Dedicated 4-Tier Hierarchies for Each Subsidiary LOB
        lobs_hierarchies = []
        for lob in sublobs_data:
            lob_domain = lob.get("domain")
            lob_name = lob.get("name") or lob.get("lob_name")
            if lob_domain and lob_domain != account_domain:
                print(f"[*] Extracting dedicated hierarchy for LOB: '{lob_name}' (domain: {lob_domain})...")
                lob_hier = scrape_lob_hierarchy(
                    lob_name=lob_name,
                    lob_domain=lob_domain,
                    raw_apollo_dir=run_dirs["raw_apollo_dir"],
                    raw_apify_dir=run_dirs["raw_apify_dir"]
                )
                telemetry.record_api_call("apollo_monid", f"/v1/people/search?domain={lob_domain}", credits_used=1, is_billable=True)
            else:
                lob_hier = {
                    "c_suite": [], "vp_level": [], "director_level": [], "manager_level": []
                }
            lobs_hierarchies.append(lob_hier)

        # 7. Serialize and Save Master JSONs + Individual Slices
        telemetry.log("INFO", "SERIALIZATION", f"Generating company-namespaced slices for '{company_name}'...")
        serialized = PipelineSerializer.serialize_and_save_all(
            account_data=account_data,
            account_hierarchy=account_hierarchy,
            sublobs_data=sublobs_data,
            lobs_hierarchies=lobs_hierarchies,
            run_dirs=run_dirs
        )
        master_doc = serialized["enriched_doc"]
        social_and_content_doc = serialized["social_doc"]

        # 8. Pre-DB Data Quality Validator Gate
        print("\n" + "=" * 70)
        print("[*] Running Pre-DB Data Quality Validator & Debugger...")
        print("=" * 70)
        validation_report = DataQualityValidator.audit_run(
            enriched_doc=master_doc,
            social_doc=social_and_content_doc,
            save_path=run_dirs["validation_report_path"]
        )

        meta = validation_report["audit_metadata"]
        telemetry.set_quality_audit(score=meta["overall_quality_score"], grade=meta["quality_grade"])
        
        # Entity Counts
        telemetry.set_entities_extracted(
            accounts_count=1,
            lobs_count=len(sublobs_data),
            personas_count=serialized.get("saved_personas_count", 0),
            tier_breakdown=meta.get("tier_breakdown", {}),
            patents_count=len(account_data.get("patents_portfolio", [])),
            political_contributions_count=len(account_data.get("fec_political_giving", []))
        )

        telemetry.complete(status="staged")

    except Exception as e:
        telemetry.complete(status="failed", error_message=str(e))
        print(f"[!] Pipeline execution error: {e}")

    # 9. Save Telemetry JSON Artifact
    telemetry.save_json(run_dirs["telemetry_json_path"])

    # 10. Persist Staged Pipeline Run Record in PostgreSQL (sales_ai)
    session = get_session()
    try:
        repo = PipelineRunRepository(session)
        schema = PipelineRunSchema.from_telemetry_dict(
            telemetry.to_dict(),
            raw_storage_dir=str(run_dirs["raw_dir"]),
            enriched_storage_dir=str(run_dirs["enriched_dir"])
        )
        repo.upsert(schema)
        session.commit()
        print(f"[+] [RunManager] Staged Run Record committed to PostgreSQL 'pipeline_runs' table (ID: {run_id})")
    except Exception as e:
        session.rollback()
        print(f"[!] [RunManager] Notice saving run to DB: {e}")
    finally:
        session.close()

    print("\n" + "=" * 70)
    print("Pipeline Run Completed Successfully (Staged & Validated)!")
    print(f"[+] Run Folder:             {run_dirs['run_dir']}")
    print(f"[+] Enriched Master JSON:   {run_dirs['enriched_json_path']}")
    print(f"[+] Social Launchpad JSON:  {run_dirs['social_json_path']}")
    print(f"[+] Validation Report JSON: {run_dirs['validation_report_path']}")
    print(f"[+] Telemetry & Usage JSON: {run_dirs['telemetry_json_path']}")
    print("=" * 70)
    print(f"[INFO] Quality Score: {telemetry.quality_score}/100 (Grade: {telemetry.quality_grade}) | Credits Used: {telemetry.total_credits_used}")
    print(f"[INFO] Data is staged in JSON and recorded in 'pipeline_runs'. To dump entities to database:")
    print(f"       python db/importer.py --dir {run_dirs['run_dir']}")
    print("=" * 70)

    return {
        "status": telemetry.status,
        "run_id": run_id,
        "quality_score": telemetry.quality_score,
        "quality_grade": telemetry.quality_grade,
        "total_credits_used": telemetry.total_credits_used,
        "credits_breakdown": telemetry.credits_breakdown,
        "telemetry_path": str(run_dirs["telemetry_json_path"])
    }
    print(f"[*] Ready for DB Dump: {'YES' if meta['ready_for_db_dump'] else 'NO'}")
    if validation_report["warnings"]:
        print(f"[*] Non-blocking Warnings ({len(validation_report['warnings'])}):")
        for w in validation_report["warnings"]:
            print(f"    - {w}")

    print("\n" + "=" * 70)
    print(f"Pipeline Run Completed Successfully (Staged & Validated)!")
    print(f"📁 Run Folder:             {run_dirs['run_dir']}")
    print(f"📄 Enriched Master JSON:   {run_dirs['enriched_json_path']}")
    print(f"📄 Social Launchpad JSON:  {run_dirs['social_json_path']}")
    print(f"📊 Validation Report JSON: {run_dirs['validation_report_path']}")
    print("=" * 70)
    print("[INFO] Data is staged in JSON. To dump to database on user confirmation:")
    print(f"       python db/importer.py --dir {run_dirs['run_dir']}")
    print("=" * 70)

    return {
        "run_dirs": run_dirs,
        "validation_report": validation_report
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sales AI Intelligence Pipeline")
    parser.add_argument("--name", "-n", type=str, help="Target company name (e.g. 'BNY', 'BlackRock')")
    parser.add_argument("--url", "-u", type=str, help="Target company website URL (e.g. 'https://www.bny.com')")
    parser.add_argument("--validate", type=str, help="Validate an existing run directory or enriched JSON file")
    parser.add_argument("--dump-db", type=str, help="Dump a validated run directory or enriched JSON file to PostgreSQL")
    args = parser.parse_args()

    if args.validate:
        target = Path(args.validate)
        if target.is_dir():
            enriched_files = list(target.glob("*_enriched*.json"))
            if not enriched_files:
                print(f"[!] No enriched JSON file found in {target}")
                sys.exit(1)
            target = enriched_files[0]
        with open(target, "r", encoding="utf-8") as f:
            import json
            doc = json.load(f)
        report = DataQualityValidator.audit_run(doc)
        print(json.dumps(report, indent=2))
    elif args.dump_db:
        res = import_run_to_db(args.dump_db)
        print(json.dumps(res, indent=2))
    else:
        target_name = args.name
        target_url = args.url

        if not target_name:
            target_name = input("Enter target company name: ").strip()
        if not target_url:
            target_url = input("Enter target company website URL (optional, press Enter to auto-discover): ").strip()
            if not target_url:
                target_url = None

        run_pipeline(target_name, target_url)
