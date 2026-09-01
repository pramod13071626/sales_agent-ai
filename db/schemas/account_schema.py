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
        """Factory method: dynamically builds AccountSchema from any enriched JSON structure."""
        acct = doc.get("account", {}) if isinstance(doc.get("account"), dict) else doc
        identity = acct.get("identity", {}) if isinstance(acct.get("identity"), dict) else {}
        firmographics = acct.get("firmographics", {}) if isinstance(acct.get("firmographics"), dict) else {}
        location = acct.get("location", {}) if isinstance(acct.get("location"), dict) else {}
        contact = acct.get("contact_and_social", {}) if isinstance(acct.get("contact_and_social"), dict) else {}
        financials = acct.get("financials_and_funding", {}) if isinstance(acct.get("financials_and_funding"), dict) else {}
        market = acct.get("market_and_ipo", {}) if isinstance(acct.get("market_and_ipo"), dict) else {}
        acq = acct.get("acquisitions_and_suborgs", {}) if isinstance(acct.get("acquisitions_and_suborgs"), dict) else {}
        traffic = acct.get("web_traffic_and_growth", {}) if isinstance(acct.get("web_traffic_and_growth"), dict) else {}
        tech = acct.get("tech_and_patents", {}) if isinstance(acct.get("tech_and_patents"), dict) else {}
        people = acct.get("key_people", {}) if isinstance(acct.get("key_people"), dict) else {}
        req_acc = acct.get("required_account", {}) if isinstance(acct.get("required_account"), dict) else {}
        summary = doc.get("summary_meta", {}) if isinstance(doc.get("summary_meta"), dict) else {}
        tier_bd = summary.get("tier_breakdown", {}) if isinstance(summary.get("tier_breakdown"), dict) else {}

        def _get(sub_dict, *keys):
            for k in keys:
                if isinstance(sub_dict, dict) and sub_dict.get(k) is not None:
                    return sub_dict.get(k)
                if isinstance(acct, dict) and acct.get(k) is not None:
                    return acct.get(k)
                if isinstance(doc, dict) and doc.get(k) is not None:
                    return doc.get(k)
            return None

        def _get_list(sub_dict, *keys):
            val = _get(sub_dict, *keys)
            if isinstance(val, list):
                return [x for x in val if x]
            return []

        return cls(
            key=req_acc.get("key") or _get(identity, "key", "name") or "unknown",
            display_name=_get(req_acc, "display_name", "legal_name", "name"),
            legal_name=_get(identity, "legal_name", "name"),
            domain=_get(identity, "domain", "primary_domain"),
            primary_domain=_get(identity, "primary_domain", "domain"),
            website_url=_get(identity, "website_url"),
            crunchbase_url=_get(identity, "crunchbase_url", "company_url"),
            operating_status=_get(identity, "operating_status") or "active",
            company_type=_get(identity, "company_type") or "for_profit",
            founded_date=_get(firmographics, "founded_date"),
            founded_year=_get(firmographics, "founded_year"),
            employee_count_range=_get(firmographics, "employee_count_range"),
            short_description=_get(firmographics, "short_description"),
            full_description=_get(firmographics, "full_description", "short_description"),
            headquarters_location=_get(location, "headquarters_location"),
            city=_get(location, "city"),
            state=_get(location, "state"),
            country=_get(location, "country"),
            postal_code=_get(location, "postal_code"),
            phone_number=_get(contact, "phone_number"),
            sanitized_phone=_get(contact, "sanitized_phone"),
            contact_email=_get(contact, "contact_email"),
            linkedin_url=_get(contact, "linkedin_url"),
            twitter_url=_get(contact, "twitter_url"),
            twitter_handle=_get(contact, "twitter_handle"),
            facebook_url=_get(contact, "facebook_url"),
            estimated_revenue_range=_get(financials, "estimated_revenue_range"),
            total_funding_amount=_get(financials, "total_funding_amount"),
            total_funding_amount_usd=_get(financials, "total_funding_amount_usd", "total_funding_amount"),
            total_funding_currency=_get(financials, "total_funding_amount_currency", "total_funding_currency"),
            last_funding_type=_get(financials, "last_funding_type"),
            last_funding_date=_get(financials, "last_funding_date"),
            num_funding_rounds=_get(financials, "num_funding_rounds"),
            funding_status=_get(financials, "funding_status"),
            stock_symbol=_get(market, "stock_symbol", "ticker"),
            stock_exchange=_get(market, "stock_exchange"),
            sec_cik=_get(market, "sec_cik"),
            sec_name=_get(market, "sec_name"),
            ipo_status=_get(market, "ipo_status"),
            ipo_date=_get(market, "ipo_date"),
            num_suborganizations=_get(acq, "num_suborganizations"),
            num_acquisitions=_get(acq, "num_acquisitions"),
            global_traffic_rank=_get(traffic, "global_traffic_rank"),
            monthly_visits=_get(traffic, "monthly_visits"),
            bounce_rate=_get(traffic, "bounce_rate"),
            visit_duration=_get(traffic, "visit_duration"),
            page_views_per_visit=_get(traffic, "page_views_per_visit"),
            heat_score=_get(traffic, "heat_score"),
            trend_score_90d=_get(traffic, "trend_score_90d"),
            active_tech_count=_get(tech, "active_tech_count"),
            it_spend=_get(tech, "it_spend"),
            patents_granted=_get(tech, "patents_granted"),
            trademarks_registered=_get(tech, "trademarks_registered"),
            total_apps=_get(tech, "total_apps"),
            total_downloads=_get(tech, "total_downloads"),
            num_founders=_get(people, "num_founders"),
            num_contacts=_get(people, "num_contacts"),
            schema_version=_get(doc, "schema_version"),
            lobs_count=_get(summary, "lobs_count"),
            total_contacts_captured=_get(summary, "total_contacts_captured"),
            c_suite_count=_get(tier_bd, "c_suite"),
            vp_count=_get(tier_bd, "vp_level"),
            director_count=_get(tier_bd, "director_level"),
            manager_count=_get(tier_bd, "manager_level"),
            sec_edgar_url=_get(req_acc, "sec_edgar_url"),
            sec_filings_rss=_get(req_acc, "sec_filings_rss"),
            sec_submissions_url=_get(req_acc, "sec_submissions_url"),
            twitter_live_url=_get(req_acc, "twitter_live_url"),
            reddit_query=_get(req_acc, "reddit_query"),
            reddit_rss_url=_get(req_acc, "reddit_rss_url"),
            news_query=_get(req_acc, "news_query"),
            rss_url=_get(req_acc, "rss_url"),
            google_patents_url=_get(req_acc, "google_patents_url"),
            google_trends_url=_get(req_acc, "google_trends_url"),
            youtube_search_url=_get(req_acc, "youtube_search_url"),
            openalex_institution_url=_get(req_acc, "openalex_institution_url"),
            wikidata_entity_url=_get(req_acc, "wikidata_entity_url"),
            github_url=_get(req_acc, "github_url"),
            glassdoor_url=_get(req_acc, "glassdoor_url"),
            blog_url=_get(req_acc, "blog_url"),
            youtube_channel_id=_get(req_acc, "youtube_channel_id"),
            industries=_get_list(firmographics, "industries"),
            industry_groups=_get_list(firmographics, "industry_groups"),
            aliases=_get_list(identity, "aliases"),
            founders=_get_list(people, "founders"),
            headquarters_regions=_get_list(location, "headquarters_regions"),
            keywords=_get_list(firmographics, "keywords"),
            multi_source_intelligence=_get(acct, "multi_source_intelligence"),
            organisational_hierarchy_tree=_get(acct, "organisational_hierarchy_tree"),
            raw_data=doc
        )
