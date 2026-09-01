"""Lob Pydantic Schema — Validates and extracts all 17 LOB fields from raw JSON."""

from typing import Optional
from pydantic import BaseModel


class LobSchema(BaseModel):
    """Validates and maps enriched JSON LOB → Lob ORM fields."""

    # LOB Identity & Intelligence
    key: Optional[str] = None
    lob_name: Optional[str] = None
    domain: Optional[str] = None
    website_url: Optional[str] = None
    crunchbase_url: Optional[str] = None
    relationship_type: Optional[str] = None
    overview: Optional[str] = None
    audited_segment_revenue: Optional[str] = None
    operating_head: Optional[str] = None
    segment_headcount: Optional[str] = None
    lei_code: Optional[str] = None
    jurisdiction: Optional[str] = None
    technologies: Optional[list] = None
    competitors: Optional[list] = None
    logo_url: Optional[str] = None
    financial_snippets: Optional[list] = None
    wikipedia_url: Optional[str] = None
    patents: Optional[list] = None
    raw_data: Optional[dict] = None

    # LOB Scraping URLs
    google_news_rss_url: Optional[str] = None
    reddit_rss_url: Optional[str] = None
    google_patents_url: Optional[str] = None
    google_trends_url: Optional[str] = None
    youtube_search_url: Optional[str] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_enriched_json(cls, lob_data: dict, social_urls: dict = None) -> "LobSchema":
        """Factory: builds LobSchema from a single LOB entry + optional scraping URLs."""
        req = lob_data.get("required_account", {}) or {}
        urls = social_urls or {}
        rev = lob_data.get("audited_segment_revenue")
        cnt = lob_data.get("segment_headcount")

        return cls(
            key=req.get("key"),
            lob_name=lob_data.get("lob_name") or lob_data.get("name"),
            domain=lob_data.get("domain"),
            website_url=lob_data.get("website_url"),
            crunchbase_url=lob_data.get("crunchbase_url"),
            relationship_type=lob_data.get("relationship_type"),
            overview=lob_data.get("overview") or lob_data.get("short_description"),
            audited_segment_revenue=str(rev) if rev is not None else None,
            operating_head=lob_data.get("operating_head"),
            segment_headcount=str(cnt) if cnt is not None else None,
            lei_code=lob_data.get("lei_code"),
            jurisdiction=lob_data.get("jurisdiction"),
            technologies=lob_data.get("technologies"),
            competitors=lob_data.get("competitors"),
            logo_url=lob_data.get("logo_url"),
            financial_snippets=lob_data.get("financial_snippets"),
            wikipedia_url=lob_data.get("wikipedia_url"),
            patents=lob_data.get("patents"),
            raw_data=lob_data,
            google_news_rss_url=req.get("rss_url") or urls.get("google_news_rss_url"),
            reddit_rss_url=req.get("reddit_rss_url") or urls.get("reddit_rss_url"),
            google_patents_url=req.get("google_patents_url") or urls.get("google_patents_url"),
            google_trends_url=req.get("google_trends_url") or urls.get("google_trends_url"),
            youtube_search_url=req.get("youtube_search_url") or urls.get("youtube_search_url"),
        )
