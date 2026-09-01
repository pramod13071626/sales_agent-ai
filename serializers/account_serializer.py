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
        """Serializes the complete corporate account structure across all 93 fields dynamically."""
        name = account_data.get("name") or account_data.get("legal_name") or "Corporate Account"
        legal_name = account_data.get("legal_name") or name
        domain = account_data.get("primary_domain") or account_data.get("domain")
        website_url = account_data.get("website_url") or (f"https://{domain}" if domain else None)
        
        req_account = cls.build_required_account(account_data)

        # Helper to extract from either flat or nested dict
        def _get(*keys, default=None):
            for k in keys:
                if k in account_data and account_data[k] is not None:
                    return account_data[k]
                # Also check in nested sub-dicts
                for sub_k in ["firmographics", "location", "contact_and_social", "financials_and_funding", "market_and_ipo", "acquisitions_and_suborgs", "web_traffic_and_growth", "tech_and_patents", "key_people"]:
                    sub_dict = account_data.get(sub_k)
                    if isinstance(sub_dict, dict) and k in sub_dict and sub_dict[k] is not None:
                        return sub_dict[k]
            return default

        # Multi-source intelligence preservation
        multi_source = account_data.get("multi_source_intelligence") or {}
        
        return {
            "required_account": req_account,
            "identity": {
                "name": name,
                "legal_name": legal_name,
                "aliases": _get("aliases", default=[]),
                "domain": domain,
                "primary_domain": domain,
                "website_url": website_url,
                "company_url": _get("crunchbase_url", "company_url"),
                "crunchbase_url": _get("crunchbase_url"),
                "operating_status": _get("operating_status", default="active"),
                "company_type": _get("company_type", default="for_profit")
            },
            "firmographics": {
                "founded_date": _get("founded_date"),
                "founded_year": _get("founded_year"),
                "employee_count_range": _get("employee_count_range"),
                "short_description": _get("short_description"),
                "full_description": _get("full_description") or _get("short_description"),
                "industries": _get("industries", default=[]),
                "industry_groups": _get("industry_groups", default=[]),
                "keywords": _get("keywords", default=[])
            },
            "location": {
                "headquarters_location": _get("headquarters_location"),
                "street_address": _get("street_address"),
                "city": _get("city"),
                "state": _get("state"),
                "postal_code": _get("postal_code"),
                "country": _get("country"),
                "headquarters_regions": _get("headquarters_regions", default=[])
            },
            "contact_and_social": {
                "phone_number": _get("phone_number"),
                "sanitized_phone": _get("sanitized_phone"),
                "contact_email": _get("contact_email"),
                "linkedin_url": _get("linkedin_url"),
                "twitter_url": _get("twitter_url"),
                "twitter_handle": _get("twitter_handle"),
                "facebook_url": _get("facebook_url"),
                "github_url": _get("github_url"),
                "glassdoor_url": _get("glassdoor_url"),
                "blog_url": _get("blog_url"),
                "youtube_channel_id": _get("youtube_channel_id")
            },
            "financials_and_funding": {
                "estimated_revenue_range": _get("estimated_revenue_range"),
                "total_funding_amount": _get("total_funding_amount"),
                "total_funding_amount_usd": _get("total_funding_amount_usd"),
                "total_funding_amount_currency": _get("total_funding_amount_currency", "total_funding_currency"),
                "last_funding_type": _get("last_funding_type"),
                "last_funding_date": _get("last_funding_date"),
                "num_funding_rounds": _get("num_funding_rounds"),
                "funding_status": _get("funding_status")
            },
            "market_and_ipo": {
                "stock_symbol": _get("stock_symbol", "ticker"),
                "stock_exchange": _get("stock_exchange"),
                "stock_symbol_url": _get("stock_symbol_url"),
                "sec_cik": str(_get("sec_cik")).zfill(10) if _get("sec_cik") else None,
                "sec_name": _get("sec_name"),
                "ipo_status": _get("ipo_status"),
                "ipo_date": _get("ipo_date")
            },
            "acquisitions_and_suborgs": {
                "num_suborganizations": _get("num_suborganizations"),
                "num_acquisitions": _get("num_acquisitions")
            },
            "web_traffic_and_growth": {
                "global_traffic_rank": _get("global_traffic_rank"),
                "monthly_visits": _get("monthly_visits"),
                "bounce_rate": _get("bounce_rate"),
                "visit_duration": _get("visit_duration"),
                "page_views_per_visit": _get("page_views_per_visit"),
                "heat_score": _get("heat_score"),
                "trend_score_90d": _get("trend_score_90d")
            },
            "tech_and_patents": {
                "active_tech_count": _get("active_tech_count"),
                "it_spend": _get("it_spend"),
                "patents_granted": _get("patents_granted"),
                "trademarks_registered": _get("trademarks_registered"),
                "total_apps": _get("total_apps"),
                "total_downloads": _get("total_downloads")
            },
            "key_people": {
                "num_founders": _get("num_founders"),
                "founders": _get("founders", default=[]),
                "num_contacts": _get("num_contacts")
            },
            "multi_source_intelligence": multi_source,
            "organisational_hierarchy_tree": tree_root,
            "hierarchy": account_hierarchy
        }
