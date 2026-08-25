"""Lob Pydantic Schema — Validates and extracts all 17 LOB fields from raw JSON."""

from typing import Optional
from pydantic import BaseModel


class LobSchema(BaseModel):
    """Validates and maps enriched JSON LOB → Lob ORM fields."""

    # LOB Identity
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

        return cls(
            key=req.get("key"),
            lob_name=lob_data.get("lob_name"),
            domain=lob_data.get("domain"),
            website_url=lob_data.get("website_url"),
            crunchbase_url=lob_data.get("crunchbase_url"),
            relationship_type=lob_data.get("relationship_type"),
            overview=lob_data.get("overview"),
            audited_segment_revenue=lob_data.get("audited_segment_revenue"),
            operating_head=lob_data.get("operating_head"),
            segment_headcount=lob_data.get("segment_headcount"),
            google_news_rss_url=urls.get("google_news_rss_url"),
            reddit_rss_url=urls.get("reddit_rss_url"),
            google_patents_url=urls.get("google_patents_url"),
            google_trends_url=urls.get("google_trends_url"),
            youtube_search_url=urls.get("youtube_search_url"),
        )
