"""
Hierarchy Collector — Maps Organization Hierarchy across 4 Strict Tiers:
- c_suite
- vp_level
- director_level
- manager_level

Embeds `required_person_data` with comprehensive, official scraping target URLs for EVERY contact across all tiers.
Merges verified C-Suite leadership from Crunchbase raw profile + live Apollo contacts via Monid.ai.
100% Dynamic, Zero Hardcoding.
"""

import json
import re
import urllib.parse
from typing import Dict, List, Any, Optional
import requests
import config

C_SUITE_KEYWORDS = ["ceo", "cio", "cto", "cfo", "cmo", "coo", "chief", "president", "founder", "co-founder", "partner", "general counsel", "chairman", "vice chair"]
VP_KEYWORDS = ["vp", "vice president", "svp", "senior vice president", "evp", "executive vice president", "head of", "head"]
DIRECTOR_KEYWORDS = ["director", "managing director", "associate director", "sr. director", "senior director"]
MANAGER_KEYWORDS = ["manager", "lead", "team lead", "general manager", "sr manager", "senior manager", "principal"]

def classify_title(title: str, raw_seniority: Optional[str] = None) -> str:
    if raw_seniority:
        s = raw_seniority.lower()
        if s in ["c_suite", "founder", "owner"]:
            return "c_suite"
        elif s in ["vp", "head"]:
            return "vp_level"
        elif s in ["director"]:
            return "director_level"
        elif s in ["manager", "senior"]:
            return "manager_level"

    t = (title or "").lower()
    
    # Check VP Level first to prevent 'Vice President' matching C-suite 'President'
    for kw in VP_KEYWORDS:
        if re.search(r"\b" + re.escape(kw) + r"\b", t):
            return "vp_level"
    # Check C-Suite
    for kw in C_SUITE_KEYWORDS:
        if kw == "president" and ("vice president" in t or "vp" in t or "2nd" in t or "second" in t):
            continue
        if re.search(r"\b" + re.escape(kw) + r"\b", t):
            return "c_suite"
    # Check Director Level
    for kw in DIRECTOR_KEYWORDS:
        if re.search(r"\b" + re.escape(kw) + r"\b", t):
            return "director_level"
    # Check Manager Level
    for kw in MANAGER_KEYWORDS:
        if re.search(r"\b" + re.escape(kw) + r"\b", t):
            return "manager_level"
    return "other"

def clean_person_name(name: str) -> Dict[str, Any]:
    """Cleans names and correctly handles obfuscated Apollo patterns (e.g. 'Matthew Ri***t' -> 'Matthew R.')."""
    if not name:
        return {"clean_name": "unknown_person", "display_name_person": "Unknown Person", "is_obfuscated": False}
    
    is_obfuscated = "*" in name
    if is_obfuscated:
        parts = name.split()
        if len(parts) > 1:
            first = parts[0]
            last_init = parts[1][0].upper() if parts[1] else ""
            clean_name = f"{first} {last_init}."
        else:
            clean_name = parts[0].replace("*", "")
    else:
        clean_name = re.sub(r"[\*\_\-]+", "", name).strip()
    
    slug_key = re.sub(r"[^a-z0-9]+", "_", clean_name.lower()).strip("_")
    return {
        "clean_name": clean_name,
        "slug_key": slug_key,
        "is_obfuscated": is_obfuscated
    }

def build_required_person_data(
    name: str,
    title: str,
    company_name: str,
    linkedin_url: Optional[str] = None,
    twitter_handle: Optional[str] = None,
    sec_cik: Optional[str] = None
) -> Dict[str, Any]:
    """Builds compulsory required_person_data block with all official scraping target URLs."""
    name_info = clean_person_name(name)
    clean_name = name_info["clean_name"]
    slug_key = name_info["slug_key"]
    
    display_title = f"{title}, {company_name}" if company_name else title
    display_name = f"{clean_name} ({display_title})".strip()

    encoded_name = urllib.parse.quote_plus(f'"{clean_name}"')
    encoded_news_query = urllib.parse.quote_plus(f'"{clean_name}" {company_name}')
    encoded_patent_inventor = urllib.parse.quote_plus(clean_name)
    encoded_search = urllib.parse.quote_plus(f"{clean_name} {company_name}")
    trends_query = urllib.parse.quote_plus(clean_name)

    sec_insider_url = f"https://www.sec.gov/edgar/searchedgar/companysearch?CIK={sec_cik}&type=4" if sec_cik else None

    return {
        "key": slug_key,
        "display_name": display_name,
        "linkedin_url": linkedin_url,
        "twitter_handle": twitter_handle,
        "twitter_live_url": f"https://x.com/search?q={encoded_name}&f=live",
        "reddit_query": f'"{clean_name}"',
        "reddit_rss_url": f"https://www.reddit.com/search.rss?q={encoded_name}&sort=new",
        "sec_cik": None,
        "sec_insider_trades_url": sec_insider_url,
        "news_query": f'"{clean_name}"',
        "rss_url": f"https://news.google.com/rss/search?q={encoded_news_query}&hl=en-US&gl=US&ceid=US:en",
        "patents_query": clean_name,
        "google_patents_url": f"https://patents.google.com/?inventor={encoded_patent_inventor}&sort=new",
        "google_scholar_url": f"https://scholar.google.com/scholar?q={encoded_search}",
        "openalex_author_url": f"https://api.openalex.org/authors?search={encoded_patent_inventor}",
        "orcid_search_url": f"https://pub.orcid.org/v3.0/search/?q={encoded_patent_inventor}",
        "wikidata_person_url": f"https://www.wikidata.org/w/api.php?action=wbsearchentities&search={encoded_patent_inventor}&language=en&format=json",
        "youtube_interviews_url": f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(f'{clean_name} {company_name} interview keynote')}",
        "podcast_search_url": f"https://www.google.com/search?q={urllib.parse.quote_plus(f'{clean_name} {company_name} podcast interview')}",
        "google_trends_url": f"https://trends.google.com/trends/explore?q={trends_query}",
        "youtube_channel_id": None
    }

def save_raw_apollo_response(company_name: str, tag: str, data: Any):
    safe_name = company_name.lower().replace(" ", "_").replace(".", "").replace(",", "")
    out_file = config.RAW_APOLLO_DIR / f"{safe_name}_{tag}_raw.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[+] [RawStorage] Exact Monid (Apollo) raw response saved to: {out_file}")

def extract_crunchbase_csuite(company_name: str, sec_cik: Optional[str] = None) -> List[Dict[str, Any]]:
    """Extracts top verified C-Suite leaders directly from the raw Crunchbase profile."""
    safe_name = company_name.lower().replace(" ", "_").replace(".", "").replace(",", "")
    raw_cb_file = config.RAW_APIFY_DIR / f"{safe_name}_account_crunchbase_raw.json"
    
    c_suite_people = []
    if raw_cb_file.exists():
        try:
            with open(raw_cb_file, "r", encoding="utf-8") as f:
                raw_items = json.load(f)
                if raw_items and isinstance(raw_items, list):
                    item = raw_items[0]
                    emp_list = item.get("current_employees_image_list", []) or item.get("current_employees_featured_order_field", []) or []
                    for emp in emp_list:
                        person_ident = emp.get("person_identifier", {})
                        name = person_ident.get("value")
                        permalink = person_ident.get("permalink")
                        title = emp.get("title") or ""
                        
                        if name and title:
                            tier = classify_title(title)
                            if tier == "c_suite":
                                req_data = build_required_person_data(name, title, company_name, linkedin_url=None, sec_cik=sec_cik)
                                person_entry = {
                                    "required_person_data": req_data,
                                    "id": person_ident.get("uuid"),
                                    "name": name,
                                    "first_name": name.split()[0] if name else None,
                                    "last_name": " ".join(name.split()[1:]) if len(name.split()) > 1 else None,
                                    "title": title,
                                    "tier": "c_suite",
                                    "seniority_raw": "c_suite",
                                    "departments": ["Executive"],
                                    "email": None,
                                    "email_status": None,
                                    "phone": None,
                                    "phone_numbers": [],
                                    "linkedin_url": None,
                                    "crunchbase_permalink": permalink,
                                    "city": None,
                                    "state": None,
                                    "country": None,
                                    "employment_history": [],
                                    "source": "crunchbase",
                                    "raw_data": emp
                                }
                                c_suite_people.append(person_entry)
        except Exception as e:
            print(f"[!] Error extracting C-Suite from Crunchbase: {e}")
    return c_suite_people

def run_monid_endpoint(provider: str, endpoint: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{config.MONID_BASE_URL}/run"
    headers = {
        "Authorization": f"Bearer {config.MONID_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "provider": provider,
        "endpoint": endpoint,
        "input": input_data
    }
    import time
    res = requests.post(url, headers=headers, json=payload, timeout=60)
    res.raise_for_status()
    data = res.json()
    if data.get("status") == "RUNNING":
        run_id = data.get("runId")
        poll_url = f"{config.MONID_BASE_URL}/runs/{run_id}"
        for _ in range(30):
            time.sleep(2)
            poll_res = requests.get(poll_url, headers=headers, timeout=30)
            poll_data = poll_res.json()
            if poll_data.get("status") in ["COMPLETED", "SUCCESS", "FAILED"]:
                return poll_data
    return data

def fetch_apollo_hierarchy_via_monid(company_domain: str, company_name: Optional[str] = None, sec_cik: Optional[str] = None) -> List[Dict[str, Any]]:
    print(f"[*] [Hierarchy] Querying Monid.ai for domain: '{company_domain}' (org: '{company_name or 'N/A'}')...")
    
    if not config.MONID_API_KEY:
        print("[!] Warning: MONID_API_KEY is not set in .env. Live Monid calls require MONID_API_KEY.")
        return []

    input_payload = {
        "body": {
            "q_organization_domains": company_domain,
            "person_seniorities": ["c_suite", "vp", "director", "manager"],
            "person_titles": ["Chief", "President", "VP", "Vice President", "Director", "Manager", "Head", "Lead"],
            "page": 1,
            "per_page": 50
        }
    }

    try:
        data = run_monid_endpoint("apollo", "/mixed_people/api_search", input_payload)
        save_raw_apollo_response(company_name or company_domain, "hierarchy_apollo", data)

        people_list = []
        if isinstance(data, dict):
            output_obj = data.get("output", {})
            if isinstance(output_obj, dict):
                people_list = output_obj.get("people", [])
            elif isinstance(output_obj, list):
                people_list = output_obj
        elif isinstance(data, list):
            people_list = data

        print(f"[+] [Hierarchy] Monid returned {len(people_list)} live contacts.")
        
        contacts = []
        for p in people_list:
            first_name = p.get("first_name")
            last_name_obf = p.get("last_name_obfuscated")
            full_name = f"{first_name} {last_name_obf}".strip() if first_name else (last_name_obf or "Unknown")
            title = p.get("title") or ""
            person_id = p.get("id")
            tier = classify_title(title)

            req_data = build_required_person_data(full_name, title, company_name or "", sec_cik=sec_cik)
            contact_entry = {
                "required_person_data": req_data,
                "id": person_id,
                "name": full_name,
                "first_name": first_name,
                "last_name": last_name_obf,
                "title": title,
                "tier": tier,
                "seniority_raw": None,
                "departments": [],
                "email": None,
                "email_status": None,
                "phone": None,
                "phone_numbers": [],
                "linkedin_url": None,
                "city": None,
                "state": None,
                "country": None,
                "employment_history": [],
                "source": "monid",
                "raw_data": p
            }
            contacts.append(contact_entry)
        return contacts
    except Exception as e:
        print(f"[!] Monid Apollo search failed: {e}")
        return []

def scrape_hierarchy(company_domain: str, company_name: Optional[str] = None, sec_cik: Optional[str] = None) -> Dict[str, Any]:
    print(f"[*] [Hierarchy] Building 4-tier hierarchy for '{company_name or company_domain}'...")
    
    hierarchy = {
        "c_suite": [],
        "vp_level": [],
        "director_level": [],
        "manager_level": []
    }

    if company_name:
        cb_csuite = extract_crunchbase_csuite(company_name, sec_cik=sec_cik)
        for person in cb_csuite:
            hierarchy["c_suite"].append(person)

    contacts = fetch_apollo_hierarchy_via_monid(company_domain, company_name, sec_cik=sec_cik)
    
    seen_ids = {p.get("id") for p in hierarchy["c_suite"] if p.get("id")}
    
    for c in contacts:
        cid = c.get("id")
        if cid and cid in seen_ids:
            continue
        
        tier = c.get("tier")
        if tier in hierarchy:
            hierarchy[tier].append(c)
            if cid:
                seen_ids.add(cid)

    print(f"[+] [Hierarchy] Categorized for '{company_name or company_domain}': "
          f"C-Suite ({len(hierarchy['c_suite'])}), VPs ({len(hierarchy['vp_level'])}), "
          f"Directors ({len(hierarchy['director_level'])}), Managers ({len(hierarchy['manager_level'])})")
    
    return hierarchy
