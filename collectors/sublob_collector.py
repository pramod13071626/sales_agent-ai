import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
import config
from .account_collector import save_raw_apify_response, slugify


def scrape_sublobs(
    parent_account_name: str,
    expected_count: int = 0,
    raw_apify_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    print(f"[*] [SubLOBCollector] Discovering sub-organizations for: '{parent_account_name}'...")

    safe_name = parent_account_name.lower().replace(" ", "_").replace(".", "").replace(",", "")
    default_apify = getattr(config, "RAW_APIFY_DIR", config.BASE_DIR / "output" / "raw" / "apify")
    target_apify_dir = raw_apify_dir if raw_apify_dir else default_apify
    raw_parent_file = target_apify_dir / f"{safe_name}_account_crunchbase_raw.json"
    if not raw_parent_file.exists():
        raw_parent_file = default_apify / f"{safe_name}_account_crunchbase_raw.json"

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
                        clean_sub_name = re.sub(
                            r"^.*?owns\s+", "", raw_name, flags=re.IGNORECASE
                        ).strip()
                        if not clean_sub_name:
                            clean_sub_name = raw_name.strip()

                        permalink = identifier.get("permalink") or slugify(clean_sub_name)
                        clean_key = clean_sub_name.lower()

                        if (
                            clean_sub_name
                            and clean_key != parent_clean
                            and clean_key not in seen_names
                        ):
                            cb_url = f"https://www.crunchbase.com/organization/{permalink}"
                            sublob_entry = {
                                "name": clean_sub_name,
                                "domain": f"{slugify(clean_sub_name)}.com",
                                "website_url": cb_url,
                                "crunchbase_url": cb_url,
                                "relationship_type": "Sub-Organization / Division",
                                "short_description": (
                                    f"Division / Subsidiary of {parent_account_name}"
                                ),
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
                                "raw_data": sub,
                            }
                            sublobs.append(sublob_entry)
                            seen_names.add(clean_key)
        except Exception as e:
            print(f"[!] Error parsing sub-organizations from raw cache: {e}")

    save_raw_apify_response(
        parent_account_name, "sublobs_crunchbase", sublobs, out_dir=raw_apify_dir
    )
    print(
        f"[+] [SubLOBCollector] Identified {len(sublobs)} clean sub-organization(s) "
        f"for '{parent_account_name}'."
    )
    return sublobs


def extract_commercial_operating_divisions(
    company_name: str,
    domain: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Stream B: 100% Dynamic Enterprise Commercial Operating Divisions & Segment Extractor.
    Discovers authentic corporate operating business units and client-facing divisions
    dynamically using public web intelligence, corporate sitelinks, Wikipedia structural sections,
    cascading LLM organizational analysis, and SEC segment descriptions without hardcoding.
    """
    if not company_name:
        return []

    divisions: List[Dict[str, Any]] = []
    seen_names = set()
    parent_clean = company_name.lower().strip()

    # 1. Dynamic AI Organizational Architecture Analysis (Cascading Gemini Models)
    gemini_key = getattr(config, "GEMINI_API_KEY", "")
    if gemini_key:
        models = [
            "gemini-flash-latest",
            "gemini-flash-lite-latest",
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.5-flash",
        ]
        prompt = f"""You are an enterprise research analyst specializing in corporate organizational structures and Fortune 500 operating models.
Analyze the corporate organizational structure and operating architecture of:
Company: '{company_name}'
Domain: '{domain or "N/A"}'

Identify the authentic primary operational business units, commercial client-facing divisions, and reportable operating segments for this enterprise (for example: client divisions, wealth management groups, institutional divisions, investment management divisions, or specialized enterprise business units).
STRICT REQUIREMENTS:
- Base results strictly on real-world facts and corporate structure for {company_name}.
- Do NOT fabricate or hallucinate imaginary divisions.
- Return a JSON array of objects with the following schema:
[
  {{
    "name": "Exact Division / Operating Unit Name",
    "lob_name": "Short descriptor / taxonomy (e.g. Retail Wealth Management, Institutional Asset Management, Advisor Services)",
    "domain": "specific subdomain (e.g. institutional.vanguard.com) or primary domain",
    "relationship_type": "Commercial Operating Division",
    "overview": "Detailed 2-3 sentence description of this operating division, its customer base, products, and commercial role."
  }}
]
"""
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.1,
            },
        }

        for m in models:
            try:
                import requests
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={gemini_key}"
                resp = requests.post(url, json=payload, timeout=15)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts and "text" in parts[0]:
                            extracted = json.loads(parts[0]["text"])
                            if isinstance(extracted, list):
                                for item in extracted:
                                    n = (item.get("name") or "").strip()
                                    n_clean = n.lower()
                                    if n and n_clean != parent_clean and n_clean not in seen_names:
                                        seen_names.add(n_clean)
                                        divisions.append({
                                            "name": n,
                                            "lob_name": item.get("lob_name") or n,
                                            "domain": item.get("domain") or domain,
                                            "relationship_type": item.get("relationship_type") or "Commercial Operating Division",
                                            "overview": item.get("overview") or f"{n} operating division of {company_name}.",
                                            "source": f"Dynamic AI Organizational Analysis ({m})",
                                        })
                                print(f"[+] [CommercialDivisions] Extracted {len(divisions)} operating divisions via {m}")
                                break
            except Exception as ai_err:
                print(f"[!] [CommercialDivisions] Model {m} note: {ai_err}")

    # 2. Dynamic Wikipedia Structure & Operating Segments Extractor
    try:
        import urllib.request
        import urllib.parse
        enc_query = urllib.parse.quote_plus(f"{company_name}")
        search_url = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={enc_query}&limit=3&namespace=0&format=json"
        req = urllib.request.Request(
            search_url,
            headers={"User-Agent": "SalesAgentIntelBot/1.0 (https://example.com/bot; bot@example.com)"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            titles = data[1] if len(data) > 1 and data[1] else []

        for page_title in titles[:2]:
            sec_url = f"https://en.wikipedia.org/w/api.php?action=parse&page={urllib.parse.quote_plus(page_title)}&prop=sections|text&format=json"
            sec_req = urllib.request.Request(
                sec_url,
                headers={"User-Agent": "SalesAgentIntelBot/1.0 (https://example.com/bot; bot@example.com)"}
            )
            with urllib.request.urlopen(sec_req, timeout=8) as s_resp:
                s_data = json.loads(s_resp.read().decode("utf-8"))
                sections = s_data.get("parse", {}).get("sections", [])
                for s in sections:
                    line = s.get("line", "").strip()
                    line_low = line.lower()
                    if any(term in line_low for term in ["division", "operating segment", "business unit", "operations", "services", "client"]):
                        clean_line = re.sub(r"<[^>]+>", "", line).strip()
                        clean_k = clean_line.lower()
                        if clean_line and clean_k not in seen_names and clean_k != parent_clean and len(clean_line) < 60:
                            seen_names.add(clean_k)
                            divisions.append({
                                "name": clean_line,
                                "lob_name": clean_line,
                                "domain": domain,
                                "relationship_type": "Commercial LOB / Division",
                                "overview": f"{clean_line} operating business unit under {company_name}.",
                                "source": "Dynamic Corporate Web & Structural Analysis",
                            })
    except Exception as e:
        print(f"[!] [CommercialDivisions] Dynamic Wikipedia extractor note: {e}")

    # 3. Dynamic Serper / Google Knowledge Graph Corporate Sitelinks Extractor
    try:
        serper_key = getattr(config, "SERPER_API_KEY", None)
        if serper_key:
            import requests
            query = f'"{company_name}" site:{domain}' if domain else f'"{company_name}" corporate divisions lines of business'
            headers = {"X-API-KEY": serper_key, "Content-Type": "application/json"}
            payload = {"q": query, "num": 10}
            serp_res = requests.post("https://google.serper.dev/search", json=payload, headers=headers, timeout=10)
            if serp_res.ok:
                serp_data = serp_res.json()
                sitelinks = serp_data.get("sitelinks", []) or []
                for sl in sitelinks:
                    title = sl.get("title", "").strip()
                    link = sl.get("link", "")
                    if title and title.lower() not in seen_names and len(title) < 50:
                        seen_names.add(title.lower())
                        subdomain = None
                        if link:
                            m = re.search(r"https?://([^/]+)", link)
                            if m:
                                subdomain = m.group(1)
                        divisions.append({
                            "name": title,
                            "lob_name": title,
                            "domain": subdomain or domain,
                            "website_url": link,
                            "relationship_type": "Commercial LOB / Division",
                            "overview": f"{title} operating division of {company_name}.",
                            "source": "Google SERP & Domain Sitelinks",
                        })
                # Check organic results for corporate division subdomains
                for org in serp_data.get("organic", [])[:8]:
                    link = org.get("link", "")
                    title = org.get("title", "")
                    snippet = org.get("snippet", "")
                    m = re.search(r"https?://([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)", link)
                    if m:
                        sub = m.group(1).lower()
                        excluded_subdomains = {
                            "www", "m", "help", "support", "en", "login", "logon", "signin",
                            "auth", "account", "mail", "portal", "secure", "app", "status",
                            "api", "dev", "careers", "jobs", "events", "press", "media",
                            "static", "assets", "cdn", "staging", "test", "demo"
                        }
                        if sub not in excluded_subdomains and len(sub) > 2:
                            unit_name = f"{sub.capitalize()} Division"
                            # Skip if an AI or SERP division already covers this concept (e.g. 'investor' -> Retail Investor Group)
                            already_covered = any(sub in s.lower() for s in seen_names)
                            if not already_covered and unit_name.lower() not in seen_names:
                                seen_names.add(unit_name.lower())
                                divisions.append({
                                    "name": unit_name,
                                    "lob_name": unit_name,
                                    "domain": f"{sub}.{m.group(2)}",
                                    "website_url": link,
                                    "relationship_type": "Commercial LOB / Division",
                                    "overview": snippet or f"{unit_name} operating unit of {company_name}.",
                                    "source": "Dynamic Corporate Subdomain Analysis",
                                })
    except Exception as e:
        print(f"[!] [CommercialDivisions] Dynamic SERP extractor note: {e}")

    # 4. Dynamic SEC Form 10-K Item 1 / Form ADV Segment Extractor from Raw Cache
    try:
        sec_dir = getattr(config, "OUTPUT_DIR", None)
        if sec_dir:
            for sec_file in (sec_dir / "raw" / "sec_10k_chunks").glob(f"*{slugify(company_name)}*.json"):
                with open(sec_file, "r", encoding="utf-8") as sf:
                    chunks = json.load(sf)
                    if isinstance(chunks, list):
                        for c in chunks:
                            text_body = c.get("text", "")
                            seg_matches = re.findall(r"(?:operating segments?|reportable segments?|business segments?)[^:\n]*:\s*([^\.]+)", text_body, re.IGNORECASE)
                            for match in seg_matches:
                                parts = re.split(r",|\sand\s|;", match)
                                for p in parts:
                                    clean_p = p.strip().strip("-•*").strip()
                                    if clean_p and len(clean_p) > 3 and len(clean_p) < 50 and clean_p.lower() not in seen_names:
                                        seen_names.add(clean_p.lower())
                                        divisions.append({
                                            "name": clean_p,
                                            "lob_name": clean_p,
                                            "domain": domain,
                                            "relationship_type": "Reportable Operating Segment (SEC Form 10-K)",
                                            "overview": f"Reportable operating business segment disclosed in SEC regulatory filings for {company_name}.",
                                            "source": "SEC Form 10-K Item 1 Segment Disclosures",
                                        })
    except Exception as e:
        print(f"[!] [CommercialDivisions] Dynamic SEC segment extractor note: {e}")

    print(f"[+] [CommercialDivisions] Discovered {len(divisions)} dynamic operating divisions for '{company_name}'.")
    return divisions

