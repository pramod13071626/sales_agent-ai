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
    blog_url: Optional[str] = None
    youtube_channel_id: Optional[str] = None

    # Array Fields
    industries: List[str] = []
    industry_groups: List[str] = []
    aliases: List[str] = []
    founders: List[str] = []
    headquarters_regions: List[str] = []
    keywords: List[str] = []

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
        """Factory method: builds AccountSchema from the full enriched JSON document."""
        acct = doc.get("account", {})
        identity = acct.get("identity", {}) or {}
        firmographics = acct.get("firmographics", {}) or {}
        location = acct.get("location", {}) or {}
        contact = acct.get("contact_and_social", {}) or {}
        financials = acct.get("financials_and_funding", {}) or {}
        market = acct.get("market_and_ipo", {}) or {}
        acq = acct.get("acquisitions_and_suborgs", {}) or {}
        traffic = acct.get("web_traffic_and_growth", {}) or {}
        tech = acct.get("tech_and_patents", {}) or {}
        people = acct.get("key_people", {}) or {}
        req_acc = acct.get("required_account", {}) or {}
        summary = doc.get("summary_meta", {}) or {}
        tier_bd = summary.get("tier_breakdown", {}) or {}

        return cls(
            key=req_acc.get("key") or identity.get("name", "unknown").lower().replace(" ", "_"),
            display_name=req_acc.get("display_name"),
            legal_name=identity.get("legal_name"),
            domain=identity.get("domain"),
            primary_domain=identity.get("primary_domain"),
            website_url=identity.get("website_url"),
            crunchbase_url=identity.get("crunchbase_url"),
            operating_status=identity.get("operating_status"),
            company_type=identity.get("company_type"),
            founded_date=firmographics.get("founded_date"),
            founded_year=firmographics.get("founded_year"),
            employee_count_range=firmographics.get("employee_count_range"),
            short_description=firmographics.get("short_description"),
            full_description=firmographics.get("full_description"),
            headquarters_location=location.get("headquarters_location"),
            city=location.get("city"),
            state=location.get("state"),
            country=location.get("country"),
            postal_code=location.get("postal_code"),
            phone_number=contact.get("phone_number"),
            sanitized_phone=contact.get("sanitized_phone"),
            contact_email=contact.get("contact_email"),
            linkedin_url=contact.get("linkedin_url"),
            twitter_url=contact.get("twitter_url"),
            twitter_handle=contact.get("twitter_handle"),
            facebook_url=contact.get("facebook_url"),
            estimated_revenue_range=financials.get("estimated_revenue_range"),
            total_funding_amount=financials.get("total_funding_amount"),
            total_funding_amount_usd=financials.get("total_funding_amount_usd"),
            total_funding_currency=financials.get("total_funding_amount_currency"),
            last_funding_type=financials.get("last_funding_type"),
            last_funding_date=financials.get("last_funding_date"),
            num_funding_rounds=financials.get("num_funding_rounds"),
            funding_status=financials.get("funding_status"),
            stock_symbol=market.get("stock_symbol"),
            stock_exchange=market.get("stock_exchange"),
            sec_cik=market.get("sec_cik"),
            sec_name=market.get("sec_name"),
            ipo_status=market.get("ipo_status"),
            ipo_date=market.get("ipo_date"),
            num_suborganizations=acq.get("num_suborganizations"),
            num_acquisitions=acq.get("num_acquisitions"),
            global_traffic_rank=traffic.get("global_traffic_rank"),
            monthly_visits=traffic.get("monthly_visits"),
            bounce_rate=traffic.get("bounce_rate"),
            visit_duration=traffic.get("visit_duration"),
            page_views_per_visit=traffic.get("page_views_per_visit"),
            heat_score=traffic.get("heat_score"),
            trend_score_90d=traffic.get("trend_score_90d"),
            active_tech_count=tech.get("active_tech_count"),
            it_spend=tech.get("it_spend"),
            patents_granted=tech.get("patents_granted"),
            trademarks_registered=tech.get("trademarks_registered"),
            total_apps=tech.get("total_apps"),
            total_downloads=tech.get("total_downloads"),
            num_founders=people.get("num_founders"),
            num_contacts=people.get("num_contacts"),
            schema_version=doc.get("schema_version"),
            lobs_count=summary.get("lobs_count"),
            total_contacts_captured=summary.get("total_contacts_captured"),
            c_suite_count=tier_bd.get("c_suite"),
            vp_count=tier_bd.get("vp_level"),
            director_count=tier_bd.get("director_level"),
            manager_count=tier_bd.get("manager_level"),
            sec_edgar_url=req_acc.get("sec_edgar_url"),
            sec_filings_rss=req_acc.get("sec_filings_rss"),
            sec_submissions_url=req_acc.get("sec_submissions_url"),
            twitter_live_url=req_acc.get("twitter_live_url"),
            reddit_query=req_acc.get("reddit_query"),
            reddit_rss_url=req_acc.get("reddit_rss_url"),
            news_query=req_acc.get("news_query"),
            rss_url=req_acc.get("rss_url"),
            google_patents_url=req_acc.get("google_patents_url"),
            google_trends_url=req_acc.get("google_trends_url"),
            youtube_search_url=req_acc.get("youtube_search_url"),
            openalex_institution_url=req_acc.get("openalex_institution_url"),
            wikidata_entity_url=req_acc.get("wikidata_entity_url"),
            blog_url=req_acc.get("blog_url"),
            youtube_channel_id=req_acc.get("youtube_channel_id"),
            industries=[i for i in (firmographics.get("industries") or []) if i],
            industry_groups=[i for i in (firmographics.get("industry_groups") or []) if i],
            aliases=[a for a in (identity.get("aliases") or []) if a],
            founders=[f for f in (people.get("founders") or []) if f],
            headquarters_regions=[r for r in (location.get("headquarters_regions") or []) if r],
            keywords=[k for k in (firmographics.get("keywords") or []) if k],
        )
