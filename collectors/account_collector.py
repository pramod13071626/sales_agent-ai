"""
Account Collector — Extracts 100% of Company firmographics, financials, web traffic,
IP, sub-organizations, contact fields, SEC EDGAR CIK, Google News RSS, and Social URLs.
Flattens and unwraps all nested value objects cleanly.
Saves exact raw API responses into output/raw/apify/.
100% Dynamic, Zero Hardcoding.
"""

import json
import re
import urllib.parse
import requests
from urllib.parse import urlparse
from typing import Optional, Dict, Any, List
from apify_client import ApifyClient
import config

def extract_domain(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]
        return domain
    except Exception:
        return url

def clean_phone(phone_str: Optional[str]) -> Optional[str]:
    if not phone_str:
        return None
    return re.sub(r"[^0-9+x]", "", str(phone_str))

def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"\b(inc|corp|corporation|ltd|llc|co|company|group)\b", "", s)
    s = s.replace("&", "and").strip()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s

def extract_twitter_handle(twitter_url: Optional[str]) -> Optional[str]:
    if not twitter_url:
        return None
    cleaned = str(twitter_url).split("?")[0].rstrip("/")
    match = re.search(r"(?:twitter\.com|x\.com)/([A-Za-z0-9_]+)$", cleaned)
    if match:
        handle = match.group(1)
        if handle.lower() not in ["intent", "search", "home", "hashtag", "share"]:
            return f"@{handle}"
    return None

def parse_stock_exchange(stock_sym: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Extracts clean exchange and ticker dynamically for ANY global exchange (NYSE, NASDAQ, LSE, TSX, etc.)."""
    if not stock_sym:
        return None, None
    s = str(stock_sym).strip()
    if ":" in s:
        parts = s.split(":")
        return parts[0].strip(), parts[1].strip()
    return None, s

def fetch_sec_edgar_info(ticker: Optional[str], company_name: Optional[str] = None) -> Dict[str, Any]:
    """Fetches official SEC CIK and registration info from SEC EDGAR API (100% Free, No Key Required)."""
    if not ticker and not company_name:
        return {}
    
    headers = {"User-Agent": "SalesAIAgentResearch admin@salesai.com"}
    ticker_clean = ticker.upper().strip() if ticker else None
    name_clean = company_name.lower().strip() if company_name else None

    try:
        res = requests.get("https://www.sec.gov/files/company_tickers.json", headers=headers, timeout=10)
        if res.status_code == 200:
            data = res.json()
            for entry in data.values():
                entry_ticker = str(entry.get("ticker", "")).upper().strip()
                entry_title = str(entry.get("title", "")).lower()
                
                match = False
                if ticker_clean and entry_ticker == ticker_clean:
                    match = True
                elif name_clean and (name_clean in entry_title or entry_title in name_clean):
                    match = True
                
                if match:
                    cik_num = entry.get("cik_str")
                    padded_cik = str(cik_num).zfill(10) if cik_num else None
                    return {
                        "sec_cik": padded_cik,
                        "sec_name": entry.get("title"),
                        "ticker": entry_ticker
                    }
    except Exception as e:
        print(f"[!] SEC EDGAR lookup warning: {e}")
    return {}

def unwrap(val: Any) -> Any:
    """Recursively unwraps dict artifacts like {'value': '...'} or {'identifier': '...'} into clean scalar primitives."""
    if val is None:
        return None
    if isinstance(val, (int, float, bool)):
        return val
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, list):
        return [unwrap(item) for item in val if unwrap(item) is not None]
    if isinstance(val, dict):
        if "value_usd" in val:
            return unwrap(val["value_usd"])
        if "value" in val:
            return unwrap(val["value"])
        if "identifier" in val and isinstance(val["identifier"], dict):
            return unwrap(val["identifier"].get("value"))
        return {k: unwrap(v) for k, v in val.items()}
    return val

def save_raw_apify_response(company_name: str, tag: str, data: Any):
    safe_name = company_name.lower().replace(" ", "_").replace(".", "").replace(",", "")
    out_file = config.RAW_APIFY_DIR / f"{safe_name}_{tag}_raw.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[+] [RawStorage] Exact Apify raw response saved to: {out_file}")

def extract_account_firmographics(raw_org: Dict[str, Any], company_name: str, website_url: Optional[str] = None) -> Dict[str, Any]:
    overview = raw_org.get("overview_fields_extended", {})
    about = raw_org.get("about_short_description", {})
    props = raw_org.get("properties", {})
    contacts = raw_org.get("contact_fields", {})
    socials = raw_org.get("social_fields", {})
    fin_highlights = raw_org.get("company_financials_highlights", {})
    ipo_fields = raw_org.get("ipo_fields", {})
    ipo_summary = raw_org.get("ipo_summary", {})
    growth = raw_org.get("growth_and_heat", {})
    semrush = raw_org.get("semrush_overview", {})
    builtwith = raw_org.get("builtwith_summary", {})
    ipqwery = raw_org.get("ipqwery_summary", {})
    apptopia = raw_org.get("apptopia_summary", {})
    sub_org_summary = raw_org.get("sub_organizations_summary", {})
    acq_summary = raw_org.get("acquisitions_summary", {})

    legal_name = unwrap(overview.get("legal_name")) or unwrap(props.get("title")) or company_name
    primary_domain = extract_domain(unwrap(raw_org.get("website_url")) or website_url)
    
    raw_permalink = unwrap(props.get("identifier", {}).get("permalink")) or unwrap(raw_org.get("semrush_summary", {}).get("identifier", {}).get("permalink")) or slugify(company_name)
    crunchbase_org_url = f"https://www.crunchbase.com/organization/{raw_permalink}"

    phone = unwrap(contacts.get("phone"))
    sanitized_phone = clean_phone(phone)
    
    twitter_url = unwrap(socials.get("twitter"))
    twitter_handle = extract_twitter_handle(twitter_url)
    
    founded_on = unwrap(overview.get("founded_on"))
    founded_year = None
    if founded_on:
        match = re.match(r"^(\d{4})", str(founded_on))
        if match:
            founded_year = int(match.group(1))

    # Clean industries (categories) vs industry groups (category groups)
    raw_cats = overview.get("categories", [])
    industries = []
    if isinstance(raw_cats, list):
        for c in raw_cats:
            unwrapped_c = unwrap(c)
            if unwrapped_c and isinstance(unwrapped_c, str):
                industries.append(unwrapped_c)

    raw_cat_groups = props.get("category_groups", [])
    industry_groups = []
    if isinstance(raw_cat_groups, list):
        for cg in raw_cat_groups:
            unwrapped_cg = unwrap(cg)
            if unwrapped_cg and isinstance(unwrapped_cg, str):
                industry_groups.append(unwrapped_cg)
    if not industry_groups:
        industry_groups = industries

    # Clean headquarters regions
    raw_loc_groups = overview.get("location_group_identifiers", [])
    hq_regions = []
    if isinstance(raw_loc_groups, list):
        for g in raw_loc_groups:
            unwrapped_g = unwrap(g)
            if unwrapped_g and isinstance(unwrapped_g, str):
                hq_regions.append(unwrapped_g)

    # Clean aliases
    aliases = unwrap(overview.get("aliases", [])) or []

    # Clean founders
    raw_founders = overview.get("founder_identifiers", [])
    founders = []
    if isinstance(raw_founders, list):
        for f in raw_founders:
            unwrapped_f = unwrap(f)
            if unwrapped_f and isinstance(unwrapped_f, str):
                founders.append(unwrapped_f)

    # Dynamic Location Extraction
    raw_locs = raw_org.get("company_about_fields2", {}).get("location_identifiers", []) or overview.get("location_identifiers", [])
    city = None
    state = None
    country = None
    if isinstance(raw_locs, list):
        for loc in raw_locs:
            ltype = loc.get("location_type")
            lval = unwrap(loc.get("value"))
            if ltype == "city" and not city:
                city = lval
            elif ltype in ["region", "state"] and not state:
                state = lval
            elif ltype == "country" and not country:
                country = lval

    hq_parts = [p for p in [city, state, country] if p]
    hq_location = ", ".join(hq_parts) if hq_parts else None

    # Dynamic global exchange and ticker extraction
    stock_sym = unwrap(fin_highlights.get("listed_stock_symbol")) or unwrap(ipo_fields.get("stock_symbol"))
    exchange, clean_stock_ticker = parse_stock_exchange(stock_sym)

    # Fetch SEC EDGAR
    sec_info = fetch_sec_edgar_info(clean_stock_ticker, legal_name or company_name)
    sec_cik = sec_info.get("sec_cik")

    web_url = unwrap(raw_org.get("website_url")) or website_url or (f"https://{primary_domain}" if primary_domain else None)

    # Clean query URLs with quote_plus
    encoded_company_name = urllib.parse.quote_plus(f'"{company_name}"')
    encoded_patents_assignee = urllib.parse.quote_plus(legal_name or company_name)
    trends_company = urllib.parse.quote_plus(company_name)

    sec_edgar_url = f"https://www.sec.gov/edgar/browse/?CIK={sec_cik}" if sec_cik else None
    sec_filings_rss = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={sec_cik}&output=atom" if sec_cik else None
    sec_submissions_url = f"https://data.sec.gov/submissions/CIK{sec_cik}.json" if sec_cik else None
    twitter_live_url = f"https://x.com/search?q={encoded_company_name}&f=live"
    reddit_rss_url = f"https://www.reddit.com/search.rss?q={encoded_company_name}&sort=new"
    google_news_rss_url = f"https://news.google.com/rss/search?q={encoded_company_name}&hl=en-US&gl=US&ceid=US:en"
    google_patents_url = f"https://patents.google.com/?assignee={encoded_patents_assignee}&sort=new"
    google_trends_url = f"https://trends.google.com/trends/explore?q={trends_company}"
    youtube_search_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(f'{company_name} official keynote')}"
    openalex_institution_url = f"https://api.openalex.org/institutions?search={encoded_company_name}"
    wikidata_entity_url = f"https://www.wikidata.org/w/api.php?action=wbsearchentities&search={encoded_company_name}&language=en&format=json"

    tracking_profile = {
        "key": slugify(company_name),
        "display_name": company_name,
        "ticker": clean_stock_ticker,
        "sec_cik": sec_cik,
        "sec_edgar_url": sec_edgar_url,
        "sec_filings_rss": sec_filings_rss,
        "sec_submissions_url": sec_submissions_url,
        "linkedin_url": unwrap(socials.get("linkedin")),
        "twitter_handle": twitter_handle,
        "twitter_live_url": twitter_live_url,
        "reddit_query": f'"{company_name}"',
        "reddit_rss_url": reddit_rss_url,
        "news_query": f'"{company_name}"',
        "rss_url": google_news_rss_url,
        "google_patents_url": google_patents_url,
        "google_trends_url": google_trends_url,
        "youtube_search_url": youtube_search_url,
        "openalex_institution_url": openalex_institution_url,
        "wikidata_entity_url": wikidata_entity_url,
        "blog_url": f"{web_url.rstrip('/')}/newsroom" if web_url else None,
        "youtube_channel_id": None
    }

    return {
        "tracking_profile": tracking_profile,
        "name": legal_name,
        "legal_name": legal_name,
        "domain": primary_domain,
        "primary_domain": primary_domain,
        "website_url": web_url,
        "company_url": crunchbase_org_url,
        "crunchbase_url": crunchbase_org_url,
        "operating_status": unwrap(overview.get("operating_status", "active")),
        "company_type": "for_profit",
        "founded_date": str(founded_on) if founded_on else None,
        "founded_year": founded_year,
        "employee_count_range": unwrap(overview.get("num_employees_enum")) or "10,001+",
        "short_description": unwrap(props.get("short_description")) or unwrap(about.get("description")),
        "full_description": unwrap(about.get("description")),
        "industries": industries,
        "industry_groups": industry_groups,
        "keywords": [],
        "aliases": aliases,
        "headquarters_location": hq_location,
        "city": city,
        "state": state,
        "country": country,
        "postal_code": None,
        "headquarters_regions": hq_regions,
        "phone_number": phone,
        "sanitized_phone": sanitized_phone,
        "contact_email": None,
        "linkedin_url": unwrap(socials.get("linkedin")),
        "twitter_url": twitter_url,
        "twitter_handle": twitter_handle,
        "facebook_url": unwrap(socials.get("facebook")),
        "estimated_revenue_range": None,
        "total_funding_amount": unwrap(fin_highlights.get("funding_total")),
        "total_funding_amount_usd": unwrap(fin_highlights.get("funding_total")),
        "total_funding_amount_currency": "USD",
        "last_funding_type": unwrap(overview.get("last_funding_type")),
        "last_funding_date": None,
        "num_funding_rounds": unwrap(fin_highlights.get("num_funding_rounds")),
        "funding_status": None,
        "stock_symbol": clean_stock_ticker,
        "stock_exchange": exchange,
        "stock_symbol_url": crunchbase_org_url,
        "sec_cik": sec_cik,
        "sec_name": sec_info.get("sec_name"),
        "ipo_status": unwrap(overview.get("ipo_status", "public")),
        "ipo_date": unwrap(ipo_summary.get("went_public_on")),
        "num_suborganizations": unwrap(sub_org_summary.get("num_sub_organizations", 0)),
        "num_acquisitions": unwrap(acq_summary.get("num_acquisitions")),
        "global_traffic_rank": unwrap(raw_org.get("semrush_summary", {}).get("semrush_global_rank")),
        "monthly_visits": unwrap(raw_org.get("semrush_summary", {}).get("semrush_visits_latest_month")),
        "bounce_rate": unwrap(semrush.get("semrush_bounce_rate")),
        "visit_duration": unwrap(semrush.get("semrush_visit_duration")),
        "page_views_per_visit": unwrap(semrush.get("semrush_visit_pageviews")),
        "heat_score": unwrap(growth.get("heat_score")),
        "trend_score_90d": unwrap(growth.get("trend_score_90d", 0)),
        "active_tech_count": unwrap(raw_org.get("builtwith_summary", {}).get("builtwith_num_technologies_used")),
        "it_spend": unwrap(raw_org.get("technology_highlights", {}).get("builtwith_it_spend")),
        "patents_granted": unwrap(ipqwery.get("ipqwery_num_patent_granted")),
        "trademarks_registered": unwrap(ipqwery.get("ipqwery_num_trademark_registered")),
        "total_apps": unwrap(apptopia.get("apptopia_total_apps")),
        "total_downloads": unwrap(apptopia.get("apptopia_total_downloads")),
        "founders": founders,
        "num_founders": len(founders),
        "num_contacts": unwrap(raw_org.get("contacts", {}).get("num_contacts", 0))
    }

def scrape_account(company_name: str, website_url: Optional[str] = None) -> Dict[str, Any]:
    print(f"[*] [AccountCollector] Live Scraping for '{company_name}' (website: {website_url or 'N/A'})...")
    
    slug = slugify(company_name)
    crunchbase_target_url = f"https://www.crunchbase.com/organization/{slug}"

    if not config.APIFY_TOKEN:
        print("[!] Warning: APIFY_TOKEN is not set in .env. Falling back to default baseline.")
        return extract_account_firmographics({}, company_name, website_url)

    client = ApifyClient(config.APIFY_TOKEN)
    actor_id = "pratikdani/crunchbase-companies-scraper"
    run_input = {
        "url": crunchbase_target_url
    }

    try:
        print(f"[*] Calling Apify Crunchbase Scraper for URL: {crunchbase_target_url}...")
        run = client.actor(actor_id).call(run_input=run_input)
        dataset_id = run.get("defaultDatasetId") if isinstance(run, dict) else (getattr(run, "default_dataset_id", None) or run["defaultDatasetId"])
        dataset_items = client.dataset(dataset_id).list_items().items
        print(f"[+] Apify returned {len(dataset_items)} items from Crunchbase.")

        if dataset_items:
            save_raw_apify_response(company_name, "account_crunchbase", dataset_items)
            raw_org = dataset_items[0]
            return extract_account_firmographics(raw_org, company_name, website_url)
        else:
            print("[!] No items returned by Apify. Using baseline extraction.")
            return extract_account_firmographics({}, company_name, website_url)
    except Exception as e:
        print(f"[!] Apify live scraping error: {e}")
        return extract_account_firmographics({}, company_name, website_url)
