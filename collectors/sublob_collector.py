"""
Sub-LOB Collector — Extracts all Lines of Business / Sub-Organizations / Subsidiaries.
Extracts and normalizes clean subsidiary profiles from Crunchbase raw records.
Saves exact raw API responses into output/raw/apify/.
"""

import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from apify_client import ApifyClient
import config
from .account_collector import extract_domain, unwrap, save_raw_apify_response, slugify

def scrape_sublobs(
    parent_account_name: str,
    expected_count: int = 0,
    raw_apify_dir: Optional[Path] = None
) -> List[Dict[str, Any]]:
    print(f"[*] [SubLOBCollector] Discovering sub-organizations for: '{parent_account_name}'...")
    
    safe_name = parent_account_name.lower().replace(" ", "_").replace(".", "").replace(",", "")
    target_apify_dir = raw_apify_dir if raw_apify_dir else config.RAW_APIFY_DIR
    raw_parent_file = target_apify_dir / f"{safe_name}_account_crunchbase_raw.json"
    if not raw_parent_file.exists():
        raw_parent_file = config.RAW_APIFY_DIR / f"{safe_name}_account_crunchbase_raw.json"
    
    sublobs = []
    seen_names = set()
    parent_clean = parent_account_name.strip().lower()

    if raw_parent_file.exists():
        try:
            with open(raw_parent_file, "r", encoding="utf-8") as f:
                raw_items = json.load(f)
                if raw_items and isinstance(raw_items, list):
                    parent_raw = raw_items[0]
                    suborg_list = parent_raw.get("sub_organizations_image_list", []) or []
                    
                    for sub in suborg_list:
                        identifier = sub.get("identifier", {})
                        raw_name = identifier.get("value") or sub.get("name") or ""
                        # Strip prefixes like "BNY owns ", "Company owns "
                        clean_sub_name = re.sub(r"^.*?owns\s+", "", raw_name, flags=re.IGNORECASE).strip()
                        if not clean_sub_name:
                            clean_sub_name = raw_name.strip()
                        
                        permalink = identifier.get("permalink") or slugify(clean_sub_name)
                        clean_key = clean_sub_name.lower()
                        
                        if clean_sub_name and clean_key != parent_clean and clean_key not in seen_names:
                            sublob_entry = {
                                "name": clean_sub_name,
                                "domain": f"{slugify(clean_sub_name)}.com",
                                "website_url": f"https://www.crunchbase.com/organization/{permalink}",
                                "crunchbase_url": f"https://www.crunchbase.com/organization/{permalink}",
                                "relationship_type": "Sub-Organization / Division",
                                "short_description": f"Division / Subsidiary of {parent_account_name}",
                                "full_description": None,
                                "employee_count_range": None,
                                "estimated_revenue_range": None,
                                "headquarters_location": None,
                                "city": None,
                                "state": None,
                                "country": None,
                                "postal_code": None,
                                "phone_number": None,
                                "contact_email": None,
                                "linkedin_url": None,
                                "twitter_url": None,
                                "facebook_url": None,
                                "total_funding_amount": None,
                                "industries": [],
                                "raw_data": sub
                            }
                            sublobs.append(sublob_entry)
                            seen_names.add(clean_key)
        except Exception as e:
            print(f"[!] Error parsing sub-organizations from raw cache: {e}")

    # Save sublobs raw response
    save_raw_apify_response(parent_account_name, "sublobs_crunchbase", sublobs, out_dir=raw_apify_dir)
    print(f"[+] [SubLOBCollector] Identified {len(sublobs)} clean sub-organization(s) for '{parent_account_name}'.")
    return sublobs
