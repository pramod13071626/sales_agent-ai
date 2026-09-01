"""
LOB Serializer — Subsidiary, Business Unit & Segment Intelligence Normalization.
100% Dynamic, Zero Hardcoding.
"""

import re
import urllib.parse
from typing import Dict, Any, List, Optional
from .account_serializer import slugify


class LOBSerializer:
    """Serializes subsidiary business units, LOB-specific hierarchies, technologies, metrics, and scraping URLs."""

    @classmethod
    def clean_snippet_text(cls, raw_text: str) -> str:
        """Removes navigation links, markdown headers, and menu clutter from raw web scrapes."""
        if not raw_text:
            return ""
        lines = raw_text.split("\n")
        clean_lines = []
        for line in lines:
            l = line.strip()
            if not l or l.startswith("#") or "Skip to" in l or "Quick Links" in l or "image of" in l or "Visit our websites" in l or "Download full" in l:
                continue
            if len(l.split()) < 3 and not l.endswith("."):
                continue
            clean_lines.append(l)
        return " ".join(clean_lines[:4])

    @classmethod
    def extract_dynamic_operating_head(cls, text: str) -> Optional[str]:
        """Extracts division executive leadership dynamically from text using NLP pattern matching."""
        if not text:
            return None
        patterns = [
            r"(?:Global Head of|Head of|President of|Led by|Deputy Head of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)",
            r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*,\s*(?:Global Head|Head|President|Chief Executive Officer|Chief Operating Officer|Managing Director)",
            r"(?:Global Head|Head|President)\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)"
        ]
        for p in patterns:
            match = re.search(p, text)
            if match:
                candidate = match.group(1).strip()
                parts = candidate.split()
                if 2 <= len(parts) <= 3 and all(part[0].isupper() for part in parts):
                    return candidate
        return None

    @classmethod
    def extract_dynamic_segment_revenue(cls, text: str) -> Optional[str]:
        """Extracts segment or unit revenue figures dynamically from financial text."""
        if not text:
            return None
        pattern = r"(\$[\d\.]+\s*(?:billion|million|trillion|B|M|T))\s*(?:in revenue|revenue|net income|in net income|sales|segment revenue)?"
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return None

    @classmethod
    def generate_generic_lob_overview(cls, lob_name: str, parent_name: Optional[str] = None, jurisdiction: Optional[str] = None) -> str:
        """Generates structured, professional business overview for any subsidiary dynamically."""
        name_clean = lob_name.title()
        parent_text = f" of {parent_name}" if parent_name else ""
        jur_text = f" operating in jurisdiction {jurisdiction}" if jurisdiction else ""
        return f"{name_clean} is a specialized operating subsidiary and business division{parent_text}{jur_text}, providing focused commercial, operational, and institutional solutions."

    @classmethod
    def build_required_lob_account(cls, lob_name: str, domain: Optional[str] = None, sec_cik: Optional[str] = None) -> Dict[str, Any]:
        """Builds compulsory required_account block for subsidiaries with all official scraping target URLs."""
        slug = slugify(lob_name)
        enc_name = urllib.parse.quote_plus(f'"{lob_name}"')
        enc_clean = urllib.parse.quote_plus(lob_name)
        website_url = f"https://www.{domain}" if domain else None

        sec_edgar_url = f"https://www.sec.gov/edgar/browse/?CIK={sec_cik}" if sec_cik else None
        sec_filings_rss = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={sec_cik}&output=atom" if sec_cik else None

        return {
            "key": slug,
            "display_name": lob_name,
            "ticker": None,
            "sec_cik": str(sec_cik).zfill(10) if sec_cik else None,
            "sec_edgar_url": sec_edgar_url,
            "sec_filings_rss": sec_filings_rss,
            "linkedin_url": f"https://www.linkedin.com/search/results/companies/?keywords={enc_clean}",
            "twitter_handle": f"@{slug[:15]}",
            "twitter_live_url": f"https://x.com/search?q={enc_name}&f=live",
            "reddit_query": f'"{lob_name}"',
            "reddit_rss_url": f"https://www.reddit.com/search.rss?q={enc_name}&sort=new",
            "news_query": f'"{lob_name}"',
            "rss_url": f"https://news.google.com/rss/search?q={enc_name}&hl=en-US&gl=US&ceid=US:en",
            "google_patents_url": f"https://patents.google.com/?assignee={enc_clean}&sort=new",
            "google_trends_url": f"https://trends.google.com/trends/explore?q={enc_clean}",
            "youtube_search_url": f"https://www.youtube.com/results?search_query={enc_clean}+keynote+overview",
            "blog_url": f"{website_url.rstrip('/')}/newsroom" if website_url else None,
            "youtube_channel_id": None
        }

    @classmethod
    def serialize_lob(
        cls,
        raw_lob: Dict[str, Any],
        lob_hierarchy: Optional[Dict[str, List[Dict[str, Any]]]] = None,
        sub_lobs: Optional[List[Dict[str, Any]]] = None,
        parent_domain: Optional[str] = None,
        parent_name: Optional[str] = None,
        sec_cik: Optional[str] = None
    ) -> Dict[str, Any]:
        """Serializes an individual LOB subsidiary with its dedicated hierarchy, metrics, and scraping URLs."""
        name = raw_lob.get("lob_name") or raw_lob.get("name") or "Subsidiary"
        domain = raw_lob.get("domain") or parent_domain
        website_url = raw_lob.get("website_url") or (f"https://www.{domain}" if domain else None)
        jurisdiction = raw_lob.get("jurisdiction") or raw_lob.get("country") or "US"

        # Clean snippets
        raw_snippets = raw_lob.get("financial_snippets", [])
        cleaned_snippets = [cls.clean_snippet_text(s) for s in raw_snippets if cls.clean_snippet_text(s)]
        joined_snippets = " ".join(cleaned_snippets)

        # Dynamic Overview
        overview = raw_lob.get("overview") or raw_lob.get("short_description")
        if not overview or len(overview) < 20:
            overview = cls.generate_generic_lob_overview(name, parent_name, jurisdiction)

        # Dynamic Operating Head
        op_head = raw_lob.get("operating_head") or cls.extract_dynamic_operating_head(joined_snippets)

        # Dynamic Segment Revenue
        audited_rev = raw_lob.get("audited_segment_revenue") or cls.extract_dynamic_segment_revenue(joined_snippets)

        # Dedicated LOB Hierarchy mapping
        final_hierarchy = lob_hierarchy if (lob_hierarchy and any(lob_hierarchy.values())) else (raw_lob.get("hierarchy") or {
            "c_suite": [], "vp_level": [], "director_level": [], "manager_level": []
        })

        # Required Account Scraping URLs
        req_acc = cls.build_required_lob_account(name, domain=domain, sec_cik=sec_cik)

        return {
            "lob_name": name,
            "audited_segment_revenue": audited_rev,
            "operating_head": op_head,
            "segment_headcount": raw_lob.get("segment_headcount"),
            "overview": overview,
            "technologies": raw_lob.get("technologies", []),
            "competitors": raw_lob.get("competitors", []),
            "logo_url": raw_lob.get("logo_url"),
            "lei_code": raw_lob.get("lei_code"),
            "jurisdiction": jurisdiction,
            "patents": raw_lob.get("patents", []),
            "wikipedia_url": raw_lob.get("wikipedia_url"),
            "financial_snippets": cleaned_snippets if cleaned_snippets else [overview],
            "required_account": req_acc,
            "domain": domain,
            "website_url": website_url,
            "crunchbase_url": raw_lob.get("crunchbase_url"),
            "relationship_type": raw_lob.get("relationship_type", "Sub-Organization / Division"),
            "sub_lobs": sub_lobs or raw_lob.get("sub_lobs") or [],
            "hierarchy": final_hierarchy
        }
