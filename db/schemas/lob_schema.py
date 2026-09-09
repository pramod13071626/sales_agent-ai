import datetime
import re
import urllib.parse
from typing import Optional, Any, List, Dict
from pydantic import BaseModel


class LobSchema(BaseModel):
    id: Optional[int] = None
    account_id: Optional[int] = None
    key: str
    lob_name: str
    overview: Optional[str] = None
    audited_segment_revenue: Optional[str] = None
    operating_head: Optional[str] = None
    segment_headcount: Optional[str] = None
    technologies: Optional[List[str]] = None
    competitors: Optional[List[str]] = None
    financial_snippets: Optional[List[Dict[str, Any]]] = None
    patents: Optional[List[Dict[str, Any]]] = None
    relationship_type: Optional[str] = None
    domain: Optional[str] = None
    website_url: Optional[str] = None
    crunchbase_url: Optional[str] = None
    lei_code: Optional[str] = None
    jurisdiction: Optional[str] = None
    logo_url: Optional[str] = None
    google_news_rss_url: Optional[str] = None
    reddit_rss_url: Optional[str] = None
    google_patents_url: Optional[str] = None
    google_trends_url: Optional[str] = None
    youtube_search_url: Optional[str] = None
    osint_feed_manifest: Optional[Dict[str, Any]] = None
    sub_lobs: Optional[List[Dict[str, Any]]] = None
    personas: Optional[List[Dict[str, Any]]] = None

    @classmethod
    def from_enriched_json(cls, lob_data: Dict[str, Any]) -> "LobSchema":
        req = lob_data.get("required_lob") or {}
        urls = lob_data.get("urls") or {}

        name = lob_data.get("name") or lob_data.get("lob_name") or "Operating Segment"
        enc_name = urllib.parse.quote_plus(name)
        clean_name = re.sub(r"[^a-zA-Z0-9\s]", "", name)
        enc_clean = urllib.parse.quote_plus(clean_name)

        news_url = (
            lob_data.get("google_news_rss_url")
            or req.get("rss_url")
            or req.get("google_news_rss_url")
            or urls.get("google_news_rss_url")
            or f"https://news.google.com/rss/search?q={enc_name}&hl=en-US&gl=US&ceid=US:en"
        )
        reddit_url = (
            lob_data.get("reddit_rss_url")
            or req.get("reddit_rss_url")
            or urls.get("reddit_rss_url")
            or f"https://www.reddit.com/search.rss?q={enc_name}&sort=new"
        )
        patents_url = (
            lob_data.get("google_patents_url")
            or req.get("google_patents_url")
            or urls.get("google_patents_url")
            or f"https://patents.google.com/?assignee={enc_clean}&sort=new"
        )
        trends_url = (
            lob_data.get("google_trends_url")
            or req.get("google_trends_url")
            or urls.get("google_trends_url")
            or f"https://trends.google.com/trends/explore?q={enc_clean}"
        )
        youtube_url = (
            lob_data.get("youtube_search_url")
            or req.get("youtube_search_url")
            or urls.get("youtube_search_url")
            or f"https://www.youtube.com/results?search_query={enc_clean}+keynote+overview"
        )

        rel_type = (
            lob_data.get("relationship_type")
            or req.get("relationship_type")
            or "Operating Segment"
        )
        if rel_type == "Operating Segment":
            name_lower = name.lower()
            nominee_indicators = [
                "nominee", "fund", "trust", "spv", "holding",
                "investments limited", "capital partners", "lp", "gilt"
            ]
            if any(ind in name_lower for ind in nominee_indicators):
                rel_type = "Special Purpose Vehicle / Operating Entity"

        osint_manifest = {
            "key": lob_data.get("key") or clean_name.lower().replace(" ", "_"),
            "display_name": name,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "status": "active",
            "feeds": {
                "google_news_rss_url": news_url,
                "reddit_rss_url": reddit_url,
                "google_patents_url": patents_url,
                "google_trends_url": trends_url,
                "youtube_search_url": youtube_url,
                "linkedin_url": lob_data.get("linkedin_url"),
                "twitter_live_url": (
                    lob_data.get("twitter_live_url")
                    or f"https://x.com/search?q=%22{enc_clean}%22&f=live"
                ),
                "openalex_institution_url": (
                    lob_data.get("openalex_institution_url")
                    or f"https://api.openalex.org/institutions?search={enc_clean}"
                ),
                "wikidata_entity_url": (
                    lob_data.get("wikidata_entity_url")
                    or (
                        f"https://www.wikidata.org/w/api.php?action=wbsearchentities"
                        f"&search=%22{enc_clean}%22&language=en&format=json"
                    )
                ),
            }
        }

        return cls(
            key=lob_data.get("key") or clean_name.lower().replace(" ", "_"),
            lob_name=name,
            overview=(
                lob_data.get("overview")
                or lob_data.get("description")
                or lob_data.get("short_description")
                or f"{name} is an operating business unit and commercial division."
            ),
            audited_segment_revenue=lob_data.get("audited_segment_revenue") or lob_data.get("revenue"),
            operating_head=lob_data.get("operating_head") or lob_data.get("head"),
            segment_headcount=str(lob_data.get("segment_headcount") or lob_data.get("headcount") or ""),
            technologies=(
                [t for t in (lob_data.get("technologies") or []) if t]
                if isinstance(lob_data.get("technologies"), list) else None
            ),
            competitors=(
                [c for c in (lob_data.get("competitors") or []) if c]
                if isinstance(lob_data.get("competitors"), list) else None
            ),
            financial_snippets=lob_data.get("financial_snippets") or lob_data.get("financials"),
            patents=(
                [p for p in (lob_data.get("patents") or []) if p]
                if isinstance(lob_data.get("patents"), list) else None
            ),
            relationship_type=rel_type,
            domain=lob_data.get("domain"),
            website_url=lob_data.get("website_url"),
            crunchbase_url=lob_data.get("crunchbase_url"),
            lei_code=lob_data.get("lei_code"),
            jurisdiction=lob_data.get("jurisdiction"),
            logo_url=lob_data.get("logo_url"),
            google_news_rss_url=news_url,
            reddit_rss_url=reddit_url,
            google_patents_url=patents_url,
            google_trends_url=trends_url,
            youtube_search_url=youtube_url,
            osint_feed_manifest=osint_manifest,
            sub_lobs=lob_data.get("sub_lobs") or lob_data.get("subLobs"),
            personas=lob_data.get("personas")
        )
