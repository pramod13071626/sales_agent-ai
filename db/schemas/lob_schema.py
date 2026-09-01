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
        """Factory: dynamically builds LobSchema from any LOB dictionary format."""
        import urllib.parse
        import re

        def _slugify(text: str) -> str:
            if not text:
                return "lob"
            t = re.sub(r"^(the|a|an)\s+", "", text.strip(), flags=re.IGNORECASE)
            c = re.sub(r"[^a-zA-Z0-9\s\-_]", "", t).lower().strip()
            return re.sub(r"[\s\-_]+", "_", c)

        req = lob_data.get("required_account", {}) or {}
        urls = social_urls or {}
        name = lob_data.get("lob_name") or lob_data.get("name") or "Subsidiary Division"
        key = req.get("key") or lob_data.get("key") or _slugify(name)
        domain = lob_data.get("domain") or (req.get("domain") if isinstance(req, dict) else None)
        web_url = lob_data.get("website_url") or (f"https://www.{domain}" if domain else None)

        enc_name = urllib.parse.quote_plus(f'"{name}"')
        enc_clean = urllib.parse.quote_plus(name)

        rev = lob_data.get("audited_segment_revenue")
        cnt = lob_data.get("segment_headcount")

        news_url = req.get("rss_url") or req.get("google_news_rss_url") or urls.get("google_news_rss_url") or f"https://news.google.com/rss/search?q={enc_name}&hl=en-US&gl=US&ceid=US:en"
        reddit_url = req.get("reddit_rss_url") or urls.get("reddit_rss_url") or f"https://www.reddit.com/search.rss?q={enc_name}&sort=new"
        patents_url = req.get("google_patents_url") or urls.get("google_patents_url") or f"https://patents.google.com/?assignee={enc_clean}&sort=new"
        trends_url = req.get("google_trends_url") or urls.get("google_trends_url") or f"https://trends.google.com/trends/explore?q={enc_clean}"
        youtube_url = req.get("youtube_search_url") or urls.get("youtube_search_url") or f"https://www.youtube.com/results?search_query={enc_clean}+keynote+overview"

        return cls(
            key=key,
            lob_name=name,
            domain=domain,
            website_url=web_url,
            crunchbase_url=lob_data.get("crunchbase_url"),
            relationship_type=lob_data.get("relationship_type") or "Sub-Organization / Division",
            overview=lob_data.get("overview") or lob_data.get("short_description") or f"{name} is an operating business unit and commercial division.",
            audited_segment_revenue=str(rev) if rev is not None else None,
            operating_head=lob_data.get("operating_head"),
            segment_headcount=str(cnt) if cnt is not None else None,
            lei_code=lob_data.get("lei_code"),
            jurisdiction=lob_data.get("jurisdiction") or lob_data.get("country") or "US",
            technologies=[t for t in (lob_data.get("technologies") or []) if t] if isinstance(lob_data.get("technologies"), list) else None,
            competitors=[c for c in (lob_data.get("competitors") or []) if c] if isinstance(lob_data.get("competitors"), list) else None,
            logo_url=lob_data.get("logo_url"),
            financial_snippets=[s for s in (lob_data.get("financial_snippets") or []) if s] if isinstance(lob_data.get("financial_snippets"), list) else None,
            wikipedia_url=lob_data.get("wikipedia_url"),
            patents=[p for p in (lob_data.get("patents") or []) if p] if isinstance(lob_data.get("patents"), list) else None,
            raw_data=lob_data,
            google_news_rss_url=news_url,
            reddit_rss_url=reddit_url,
            google_patents_url=patents_url,
            google_trends_url=trends_url,
            youtube_search_url=youtube_url,
        )
