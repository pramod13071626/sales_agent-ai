"""
Account Serializer — High-Fidelity Master Corporate Account Serialization.
100% Dynamic, Zero Hardcoding.
"""

import re
import urllib.parse
from typing import Dict, Any, List, Optional


def slugify(text: str) -> str:
    """Converts raw string into a clean, deterministic slug key."""
    if not text:
        return "account"
    text = re.sub(r"^(the|a|an)\s+", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"[^a-zA-Z0-9\s\-_]", "", text).lower().strip()
    return re.sub(r"[\s\-_]+", "_", cleaned)


class AccountSerializer:
    """Serializes master corporate account intelligence across firmographics, markets, URLs, and multi-source intel."""

    @classmethod
    def build_required_account(cls, raw_acc: Dict[str, Any]) -> Dict[str, Any]:
        """Builds compulsory required_account block with all official scraping target URLs."""
        name = raw_acc.get("name") or "Company"
        ticker = raw_acc.get("stock_symbol") or raw_acc.get("ticker")
        web_url = raw_acc.get("website_url") or raw_acc.get("domain")
        if web_url and not web_url.startswith("http"):
            web_url = f"https://{web_url}"
        sec_cik = raw_acc.get("sec_cik")
        legal_name = raw_acc.get("legal_name") or name
        
        encoded_name = urllib.parse.quote_plus(f'"{name}"')
        encoded_legal = urllib.parse.quote_plus(legal_name)
        trends_name = urllib.parse.quote_plus(name)

        sec_edgar_url = f"https://www.sec.gov/edgar/browse/?CIK={sec_cik}" if sec_cik else None
        sec_filings_rss = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={sec_cik}&output=atom" if sec_cik else None
        sec_submissions_url = f"https://data.sec.gov/submissions/CIK{str(sec_cik).zfill(10)}.json" if sec_cik else None
        
        return {
            "key": raw_acc.get("key") or slugify(name),
            "display_name": legal_name,
            "ticker": ticker,
            "sec_cik": str(sec_cik).zfill(10) if sec_cik else None,
            "sec_edgar_url": sec_edgar_url,
            "sec_filings_rss": sec_filings_rss,
            "sec_submissions_url": sec_submissions_url,
            "linkedin_url": raw_acc.get("linkedin_url"),
            "twitter_handle": raw_acc.get("twitter_handle"),
            "twitter_live_url": f"https://x.com/search?q={encoded_name}&f=live",
            "reddit_query": f'"{name}"',
            "reddit_rss_url": f"https://www.reddit.com/search.rss?q={encoded_name}&sort=new",
            "news_query": f'"{name}"',
            "rss_url": f"https://news.google.com/rss/search?q={encoded_name}&hl=en-US&gl=US&ceid=US:en",
            "google_patents_url": f"https://patents.google.com/?assignee={encoded_legal}&sort=new",
            "google_trends_url": f"https://trends.google.com/trends/explore?q={trends_name}",
            "youtube_search_url": f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(f'{name} official keynote')}",
            "openalex_institution_url": f"https://api.openalex.org/institutions?search={encoded_name}",
            "wikidata_entity_url": f"https://www.wikidata.org/w/api.php?action=wbsearchentities&search={encoded_name}&language=en&format=json",
            "github_url": raw_acc.get("github_url") or f"https://github.com/{slugify(name).replace('_', '')}",
            "glassdoor_url": raw_acc.get("glassdoor_url") or f"https://www.glassdoor.com/Search/results.htm?keyword={encoded_name}",
            "blog_url": f"{web_url.rstrip('/')}/newsroom" if web_url else None,
            "youtube_channel_id": None
        }

    @classmethod
    def serialize_account(
        cls,
        account_data: Dict[str, Any],
        account_hierarchy: Dict[str, List[Dict[str, Any]]],
        tree_root: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Serializes the complete corporate account structure."""
        name = account_data.get("name") or "Corporate Account"
        legal_name = account_data.get("legal_name") or name
        domain = account_data.get("primary_domain") or account_data.get("domain")
        website_url = account_data.get("website_url") or (f"https://{domain}" if domain else None)
        
        req_account = cls.build_required_account(account_data)

        # Multi-source intelligence preservation
        multi_source = account_data.get("multi_source_intelligence") or {}
        
        return {
            "required_account": req_account,
            "identity": {
                "name": name,
                "legal_name": legal_name,
                "aliases": account_data.get("aliases", []),
                "domain": domain,
                "primary_domain": domain,
                "website_url": website_url,
                "company_url": account_data.get("crunchbase_url") or account_data.get("company_url"),
                "crunchbase_url": account_data.get("crunchbase_url"),
                "operating_status": account_data.get("operating_status", "active"),
                "company_type": account_data.get("company_type", "for_profit")
            },
            "firmographics": {
                "founded_date": account_data.get("founded_date"),
                "founded_year": account_data.get("founded_year"),
                "employee_count_range": account_data.get("employee_count_range"),
                "short_description": account_data.get("short_description"),
                "full_description": account_data.get("full_description") or account_data.get("short_description"),
                "industries": account_data.get("industries", []),
                "keywords": account_data.get("keywords", [])
            },
            "location": {
                "headquarters_location": account_data.get("headquarters_location"),
                "street_address": account_data.get("street_address"),
                "city": account_data.get("city"),
                "state": account_data.get("state"),
                "postal_code": account_data.get("postal_code"),
                "country": account_data.get("country")
            },
            "market_and_ipo": {
                "stock_symbol": account_data.get("stock_symbol") or account_data.get("ticker"),
                "stock_exchange": account_data.get("stock_exchange"),
                "stock_symbol_url": account_data.get("stock_symbol_url"),
                "sec_cik": str(account_data.get("sec_cik")).zfill(10) if account_data.get("sec_cik") else None
            },
            "multi_source_intelligence": multi_source,
            "organisational_hierarchy_tree": tree_root,
            "hierarchy": account_hierarchy
        }
