"""Account Pydantic Schema — Validates and extracts all 89 account fields from raw JSON."""

from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel, field_validator


class AccountSchema(BaseModel):
    """Validates and maps enriched JSON → Account ORM fields."""

    # Identity
    key: str
    display_name: Optional[str] = None
    legal_name: Optional[str] = None
    domain: Optional[str] = None
    primary_domain: Optional[str] = None
    website_url: Optional[str] = None
    crunchbase_url: Optional[str] = None
    operating_status: Optional[str] = None
    company_type: Optional[str] = None

    # Firmographics
    founded_date: Optional[date] = None
    founded_year: Optional[int] = None
    employee_count_range: Optional[str] = None
    short_description: Optional[str] = None
    full_description: Optional[str] = None

    # Location
    headquarters_location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None

    # Contact & Social
    phone_number: Optional[str] = None
    sanitized_phone: Optional[str] = None
    contact_email: Optional[str] = None
    linkedin_url: Optional[str] = None
    twitter_url: Optional[str] = None
    twitter_handle: Optional[str] = None
    facebook_url: Optional[str] = None

    # Financials
    estimated_revenue_range: Optional[str] = None
    total_funding_amount: Optional[int] = None
    total_funding_amount_usd: Optional[int] = None
    total_funding_currency: Optional[str] = None
    last_funding_type: Optional[str] = None
    last_funding_date: Optional[date] = None
    num_funding_rounds: Optional[int] = None
    funding_status: Optional[str] = None

    # Market & IPO
    stock_symbol: Optional[str] = None
    stock_exchange: Optional[str] = None
    sec_cik: Optional[str] = None
    sec_name: Optional[str] = None
    ipo_status: Optional[str] = None
    ipo_date: Optional[date] = None

    # Acquisitions
    num_suborganizations: Optional[int] = 0
    num_acquisitions: Optional[int] = None

    # Web Traffic
    global_traffic_rank: Optional[int] = None
    monthly_visits: Optional[int] = None
    bounce_rate: Optional[float] = None
    visit_duration: Optional[float] = None
    page_views_per_visit: Optional[float] = None
    heat_score: Optional[int] = None
    trend_score_90d: Optional[float] = None

    # Tech & Patents
    active_tech_count: Optional[int] = None
    it_spend: Optional[str] = None
    patents_granted: Optional[int] = None
    trademarks_registered: Optional[int] = None
    total_apps: Optional[int] = None
    total_downloads: Optional[int] = None

    # Key People
    num_founders: Optional[int] = 0
    num_contacts: Optional[int] = None

    # Pipeline Run Metadata
    extracted_at: Optional[datetime] = None
    schema_version: Optional[str] = None
    lobs_count: Optional[int] = 0
    total_contacts_captured: Optional[int] = 0
    c_suite_count: Optional[int] = 0
    vp_count: Optional[int] = 0
    director_count: Optional[int] = 0
    manager_count: Optional[int] = 0

    # Account Scraping URLs
    sec_edgar_url: Optional[str] = None
    sec_filings_rss: Optional[str] = None
    sec_submissions_url: Optional[str] = None
    twitter_live_url: Optional[str] = None
    reddit_query: Optional[str] = None
    reddit_rss_url: Optional[str] = None
    news_query: Optional[str] = None
    rss_url: Optional[str] = None
    google_patents_url: Optional[str] = None
    google_trends_url: Optional[str] = None
    youtube_search_url: Optional[str] = None
    openalex_institution_url: Optional[str] = None
    wikidata_entity_url: Optional[str] = None
    github_url: Optional[str] = None
    glassdoor_url: Optional[str] = None
    blog_url: Optional[str] = None
    youtube_channel_id: Optional[str] = None

    # Array & JSONB Fields
    industries: List[str] = []
    industry_groups: List[str] = []
    aliases: List[str] = []
    founders: List[str] = []
    headquarters_regions: List[str] = []
    keywords: List[str] = []
    multi_source_intelligence: Optional[dict] = None
    organisational_hierarchy_tree: Optional[dict] = None
    raw_data: Optional[dict] = None
    osint_feed_manifest: Optional[dict] = None

    model_config = {"from_attributes": True}

    @field_validator("founded_date", "last_funding_date", "ipo_date", mode="before")
    @classmethod
    def parse_date(cls, v):
        if v is None or v == "":
            return None
        if isinstance(v, date):
            return v
        try:
            return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return None

    @classmethod
    def from_enriched_json(cls, doc: dict) -> "AccountSchema":
        """Factory method: dynamically builds AccountSchema from any enriched JSON structure.

        Handles all three data formats:
          - Flat dict: {"key": "bny", "domain": "bny.com", ...}
          - Nested dict: {"account": {"identity": {...}, "firmographics": {...}, ...}}
          - Mixed (AccountService output): both flat + sub-dicts present simultaneously

        The unified _v() helper searches ALL possible locations so no field is ever missed.
        """
        # Unwrap top-level "account" key if present
        acct = doc.get("account", {}) if isinstance(doc.get("account"), dict) else doc
        if not isinstance(acct, dict):
            acct = doc

        # Collect all sub-dicts that may hold field values (order = priority)
        _sub_dicts = [
            acct.get("required_account", {}) if isinstance(acct.get("required_account"), dict) else {},
            acct.get("identity", {}) if isinstance(acct.get("identity"), dict) else {},
            acct.get("firmographics", {}) if isinstance(acct.get("firmographics"), dict) else {},
            acct.get("location", {}) if isinstance(acct.get("location"), dict) else {},
            acct.get("contact_and_social", {}) if isinstance(acct.get("contact_and_social"), dict) else {},
            acct.get("financials_and_funding", {}) if isinstance(acct.get("financials_and_funding"), dict) else {},
            acct.get("market_and_ipo", {}) if isinstance(acct.get("market_and_ipo"), dict) else {},
            acct.get("acquisitions_and_suborgs", {})
            if isinstance(acct.get("acquisitions_and_suborgs"), dict) else {},
            acct.get("web_traffic_and_growth", {}) if isinstance(acct.get("web_traffic_and_growth"), dict) else {},
            acct.get("tech_and_patents", {}) if isinstance(acct.get("tech_and_patents"), dict) else {},
            acct.get("key_people", {}) if isinstance(acct.get("key_people"), dict) else {},
        ]

        # summary_meta for pipeline tier breakdown (from full composite pipeline runs)
        summary = doc.get("summary_meta", {}) if isinstance(doc.get("summary_meta"), dict) else {}
        tier_bd = summary.get("tier_breakdown", {}) if isinstance(summary.get("tier_breakdown"), dict) else {}

        def _v(*keys):
            """Search all sub-dicts, then acct flat, then doc flat. Return first non-None match."""
            for k in keys:
                for d in _sub_dicts:
                    if isinstance(d, dict) and d.get(k) is not None:
                        return d[k]
                if isinstance(acct, dict) and acct.get(k) is not None:
                    return acct[k]
                if isinstance(doc, dict) and doc.get(k) is not None:
                    return doc[k]
            return None

        def _vl(*keys):
            """Like _v but always returns a list, filtering None/empty entries."""
            val = _v(*keys)
            if isinstance(val, list):
                return [x for x in val if x]
            return []

        resolved_key = _v("key", "name") or "unknown"
        resolved_display = _v("display_name", "legal_name", "name") or resolved_key

        return cls(
            key=resolved_key,
            display_name=resolved_display,
            legal_name=_v("legal_name", "name"),
            domain=_v("domain", "primary_domain"),
            primary_domain=_v("primary_domain", "domain"),
            website_url=_v("website_url"),
            crunchbase_url=_v("crunchbase_url", "company_url"),
            operating_status=_v("operating_status") or "active",
            company_type=_v("company_type") or "for_profit",
            founded_date=_v("founded_date"),
            founded_year=_v("founded_year"),
            employee_count_range=_v("employee_count_range"),
            short_description=_v("short_description", "overview_description"),
            full_description=_v("full_description", "short_description", "overview_description"),
            headquarters_location=_v("headquarters_location"),
            city=_v("city"),
            state=_v("state"),
            country=_v("country"),
            postal_code=_v("postal_code"),
            phone_number=_v("phone_number"),
            sanitized_phone=_v("sanitized_phone"),
            contact_email=_v("contact_email"),
            linkedin_url=_v("linkedin_url"),
            twitter_url=_v("twitter_url"),
            twitter_handle=_v("twitter_handle"),
            facebook_url=_v("facebook_url"),
            estimated_revenue_range=_v("estimated_revenue_range", "revenue"),
            total_funding_amount=_v("total_funding_amount"),
            total_funding_amount_usd=_v("total_funding_amount_usd", "total_funding_amount"),
            total_funding_currency=_v("total_funding_amount_currency", "total_funding_currency") or "USD",
            last_funding_type=_v("last_funding_type"),
            last_funding_date=_v("last_funding_date"),
            num_funding_rounds=_v("num_funding_rounds"),
            funding_status=_v("funding_status"),
            stock_symbol=_v("stock_symbol", "ticker"),
            stock_exchange=_v("stock_exchange"),
            sec_cik=_v("sec_cik"),
            sec_name=_v("sec_name"),
            ipo_status=_v("ipo_status"),
            ipo_date=_v("ipo_date"),
            num_suborganizations=_v("num_suborganizations"),
            num_acquisitions=_v("num_acquisitions"),
            global_traffic_rank=_v("global_traffic_rank"),
            monthly_visits=_v("monthly_visits"),
            bounce_rate=_v("bounce_rate"),
            visit_duration=_v("visit_duration"),
            page_views_per_visit=_v("page_views_per_visit"),
            heat_score=_v("heat_score"),
            trend_score_90d=_v("trend_score_90d"),
            active_tech_count=_v("active_tech_count"),
            it_spend=_v("it_spend"),
            patents_granted=_v("patents_granted"),
            trademarks_registered=_v("trademarks_registered"),
            total_apps=_v("total_apps"),
            total_downloads=_v("total_downloads"),
            num_founders=_v("num_founders"),
            num_contacts=_v("num_contacts"),
            schema_version=_v("schema_version"),
            # Pipeline run metadata — check flat first, then summary_meta sub-dict
            lobs_count=_v("lobs_count") or summary.get("lobs_count"),
            total_contacts_captured=_v("total_contacts_captured") or summary.get("total_contacts_captured"),
            c_suite_count=_v("c_suite_count") or tier_bd.get("c_suite"),
            vp_count=_v("vp_count") or tier_bd.get("vp_level"),
            director_count=_v("director_count") or tier_bd.get("director_level"),
            manager_count=_v("manager_count") or tier_bd.get("manager_level"),
            # OSINT & scraping URLs — _v() now finds these from ANY location (flat or nested)
            sec_edgar_url=_v("sec_edgar_url"),
            sec_filings_rss=_v("sec_filings_rss"),
            sec_submissions_url=_v("sec_submissions_url"),
            twitter_live_url=_v("twitter_live_url"),
            reddit_query=_v("reddit_query"),
            reddit_rss_url=_v("reddit_rss_url"),
            news_query=_v("news_query"),
            rss_url=_v("rss_url"),
            google_patents_url=_v("google_patents_url"),
            google_trends_url=_v("google_trends_url"),
            youtube_search_url=_v("youtube_search_url"),
            openalex_institution_url=_v("openalex_institution_url"),
            wikidata_entity_url=_v("wikidata_entity_url"),
            github_url=_v("github_url"),
            glassdoor_url=_v("glassdoor_url"),
            blog_url=_v("blog_url"),
            youtube_channel_id=_v("youtube_channel_id"),
            # Array / JSONB
            industries=_vl("industries"),
            industry_groups=_vl("industry_groups"),
            aliases=_vl("aliases"),
            founders=_vl("founders"),
            headquarters_regions=_vl("headquarters_regions"),
            keywords=_vl("keywords"),
            multi_source_intelligence=_v("multi_source_intelligence"),
            organisational_hierarchy_tree=_v("organisational_hierarchy_tree"),
            raw_data=doc,
            osint_feed_manifest=_v("osint_feed_manifest") or {
                "key": resolved_key,
                "display_name": resolved_display or resolved_key,
                "entity_type": "account",
                "generated_at": datetime.now().isoformat(),
                "feeds": {
                    "website_url": _v("website_url"),
                    "twitter_handle": _v("twitter_handle"),
                    "twitter_live_url": _v("twitter_live_url"),
                    "reddit_query": _v("reddit_query"),
                    "reddit_rss_url": _v("reddit_rss_url"),
                    "news_query": _v("news_query"),
                    "rss_url": _v("rss_url"),
                    "google_patents_url": _v("google_patents_url"),
                    "google_trends_url": _v("google_trends_url"),
                    "youtube_search_url": _v("youtube_search_url"),
                    "openalex_institution_url": _v("openalex_institution_url"),
                    "wikidata_entity_url": _v("wikidata_entity_url"),
                    "linkedin_url": _v("linkedin_url"),
                    "github_url": _v("github_url"),
                    "glassdoor_url": _v("glassdoor_url"),
                    "blog_url": _v("blog_url"),
                    "sec_edgar_url": _v("sec_edgar_url"),
                    "sec_filings_rss": _v("sec_filings_rss"),
                    "sec_submissions_url": _v("sec_submissions_url"),
                    "youtube_channel_id": _v("youtube_channel_id"),
                }
            },
        )
