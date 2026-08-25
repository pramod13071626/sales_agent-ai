"""
Main Execution Script — Enterprise Sales AI Pipeline
Coordinates account firmographics, LOB discovery, 4-tier hierarchy, AI Persona synthesis,
and generates both:
1. `output/<company>_enriched.json`
2. `output/<company>_social_and_content.json`
100% Dynamic, Zero Hardcoding.
"""

import sys
import argparse
from pathlib import Path

# Add project root to sys.path
PIPELINE_ROOT = Path(__file__).resolve().parent
sys.path.append(str(PIPELINE_ROOT))

import config
from collectors.account_collector import scrape_account
from collectors.sublob_collector import scrape_sublobs
from collectors.hierarchy_collector import scrape_hierarchy
from collectors.persona_enricher import build_persona_dossier
from collectors.lob_enricher import enrich_lob_segments
from serializer import PipelineSerializer
from db.writer import persist_to_db

def run_pipeline(company_name: str, target_url: str = None):
    print("=" * 70)
    print(f"[*] Starting Sales AI Intelligence Pipeline for: '{company_name}'")
    print(f"[*] Target Website URL: {target_url or 'Auto-discover'}")
    print("=" * 70)

    # 1. Scrape & Normalize Account
    account_data = scrape_account(company_name, target_url)
    sec_cik = account_data.get("sec_cik")

    # 2. Discover Sub-LOBs / Sub-Organizations
    sublobs_raw = scrape_sublobs(company_name)

    # 3. Enrich LOB Segments
    sublobs_data = enrich_lob_segments(company_name, sublobs_raw)

    # 4. Build 4-Tier Hierarchy for Account
    account_domain = account_data.get("domain") or account_data.get("primary_domain") or target_url
    account_hierarchy = scrape_hierarchy(account_domain, company_name, sec_cik=sec_cik)

    # 5. Synthesize AI Persona Dossiers for C-Suite Leadership
    c_suite = account_hierarchy.get("c_suite", [])
    if c_suite:
        ceo = c_suite[0]
        ceo["persona_dossier"] = build_persona_dossier(
            ceo.get("name"), ceo.get("title"), company_name, ceo.get("linkedin_url")
        )
        # Update verified LinkedIn URL on CEO if Exa found it
        if ceo["persona_dossier"].get("level_3_personal_touch", {}).get("social_media", {}).get("profile_url"):
            verified_url = ceo["persona_dossier"]["level_3_personal_touch"]["social_media"]["profile_url"]
            ceo["linkedin_url"] = verified_url
            ceo["required_person_data"]["linkedin_url"] = verified_url

        if len(c_suite) > 1:
            exec2 = c_suite[1]
            exec2["persona_dossier"] = build_persona_dossier(
                exec2.get("name"), exec2.get("title"), company_name, exec2.get("linkedin_url")
            )
            if exec2["persona_dossier"].get("level_3_personal_touch", {}).get("social_media", {}).get("profile_url"):
                verified_url = exec2["persona_dossier"]["level_3_personal_touch"]["social_media"]["profile_url"]
                exec2["linkedin_url"] = verified_url
                exec2["required_person_data"]["linkedin_url"] = verified_url

    # 6. Extract Hierarchies for Each LOB
    lobs_hierarchies = []
    for lob in sublobs_data:
        lob_domain = lob.get("domain")
        lob_name = lob.get("name")
        if lob_domain and lob_domain != account_domain:
            print(f"[*] Extracting hierarchy for LOB: '{lob_name}' (domain: {lob_domain})...")
            lob_hier = scrape_hierarchy(lob_domain, lob_name, sec_cik=sec_cik)
        else:
            lob_hier = account_hierarchy
        lobs_hierarchies.append(lob_hier)

    # 7. Assemble Master Documents
    master_doc = PipelineSerializer.build_master_payload(
        account_data=account_data,
        account_hierarchy=account_hierarchy,
        lobs_data=sublobs_data,
        lobs_hierarchies=lobs_hierarchies
    )

    social_and_content_doc = PipelineSerializer.build_social_and_content_payload(
        account_data=account_data,
        account_hierarchy=account_hierarchy,
        lobs_data=sublobs_data
    )

    # 8. Save Both Artifacts
    safe_name = company_name.lower().replace(" ", "_").replace(".", "").replace(",", "")
    out_file_enriched = config.OUTPUT_DIR / f"{safe_name}_enriched.json"
    out_file_content = config.OUTPUT_DIR / f"{safe_name}_social_and_content.json"

    PipelineSerializer.save_json(master_doc, out_file_enriched)
    PipelineSerializer.save_json(social_and_content_doc, out_file_content)

    # 9. Persist to PostgreSQL Database
    try:
        persist_to_db(master_doc, social_and_content_doc)
    except Exception as e:
        print(f"[!] Database persistence warning: {e}")
        print("[!] JSON files were saved successfully. DB sync can be retried later.")

    print("=" * 70)
    print(f"Pipeline Completed Successfully!")
    print(f"1. Enriched Master JSON: {out_file_enriched}")
    print(f"2. Social & Content Launchpad JSON: {out_file_content}")
    print(f"3. PostgreSQL Database: sales_ai (local)")
    print("=" * 70)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sales AI Intelligence Pipeline")
    parser.add_argument("--name", "-n", type=str, help="Target company name (e.g. 'BNY', 'BlackRock')")
    parser.add_argument("--url", "-u", type=str, help="Target company website URL (e.g. 'https://www.bny.com')")
    args = parser.parse_args()

    target_name = args.name
    target_url = args.url

    if not target_name:
        target_name = input("Enter target company name: ").strip()
    if not target_url:
        target_url = input("Enter target company website URL (optional, press Enter to auto-discover): ").strip()
        if not target_url:
            target_url = None

    run_pipeline(target_name, target_url)
