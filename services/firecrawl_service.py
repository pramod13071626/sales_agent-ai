"""
Firecrawl Web Scraper Service.
Enterprise wrapper for the Firecrawl v1 API (https://api.firecrawl.dev/v1).
Provides high-fidelity, clean markdown scraping for corporate accounts and LOB divisions,
bypassing bot blockers and JavaScript hydration at 1 credit/scrape.
Strict Zero Hardcoding • Pure Metered Telemetry.
"""

import os
import re
import logging
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse
import requests

import config

logger = logging.getLogger("FirecrawlService")


class FirecrawlService:
    """Enterprise client for Firecrawl scraping and website intelligence."""

    BASE_URL = "https://api.firecrawl.dev/v1"

    @classmethod
    def get_api_key(cls) -> Optional[str]:
        return getattr(config, "FIRECRAWL_API_KEY", None) or os.getenv("FIRECRAWL_API_KEY")

    @classmethod
    def get_headers(cls) -> Dict[str, str]:
        api_key = cls.get_api_key()
        if not api_key:
            raise ValueError("FIRECRAWL_API_KEY is not configured in environment or config.py")
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    @classmethod
    def normalize_url(cls, domain_or_url: str) -> str:
        """Converts raw domain or URL into a clean, canonical HTTPS URL."""
        raw = str(domain_or_url or "").strip().lower()
        if not raw:
            return ""
        if not raw.startswith(("http://", "https://")):
            raw = "https://" + raw
        parsed = urlparse(raw)
        netloc = parsed.netloc or parsed.path
        netloc = re.sub(r"^www\.", "", netloc).split("/")[0].split(":")[0]
        path = parsed.path if parsed.netloc else ""
        return f"https://www.{netloc}{path}".rstrip("/")

    @classmethod
    def scrape_url(
        cls,
        target_url: str,
        formats: Optional[List[str]] = None,
        only_main_content: bool = True,
        timeout: int = 15,
    ) -> Dict[str, Any]:
        """
        Scrapes a single URL and returns clean markdown, metadata, and extracted text.
        Consumes 1 Firecrawl credit per call.
        """
        api_key = cls.get_api_key()
        if not api_key:
            logger.warning("Firecrawl skipped: FIRECRAWL_API_KEY not configured.")
            return {}

        clean_url = cls.normalize_url(target_url)
        if not clean_url:
            return {}

        payload: Dict[str, Any] = {
            "url": clean_url,
            "formats": formats or ["markdown"],
            "onlyMainContent": only_main_content,
        }

        try:
            endpoint = f"{cls.BASE_URL}/scrape"
            res = requests.post(endpoint, headers=cls.get_headers(), json=payload, timeout=timeout)
            if res.status_code == 200:
                data = res.json().get("data", {})
                return {
                    "url": clean_url,
                    "markdown": data.get("markdown", ""),
                    "title": data.get("metadata", {}).get("title", ""),
                    "description": data.get("metadata", {}).get("description", ""),
                    "keywords": data.get("metadata", {}).get("keywords", ""),
                    "og_image": data.get("metadata", {}).get("ogImage", ""),
                    "status_code": data.get("metadata", {}).get("statusCode", 200),
                    "raw_metadata": data.get("metadata", {}),
                }
            else:
                logger.warning(
                    f"Firecrawl scrape failed for {clean_url} (HTTP {res.status_code}): {res.text[:200]}"
                )
                return {}
        except Exception as e:
            logger.error(f"Error executing Firecrawl scrape on {clean_url}: {e}")
            return {}

    @classmethod
    def scrape_account_overview(
        cls,
        domain: Optional[str],
        company_name: Optional[str] = None,
        timeout: int = 15,
    ) -> Dict[str, Any]:
        """
        Scrapes account homepage and about-us pages to extract genuine corporate overview,
        digital presence, and leadership links at 1 credit.
        """
        if not domain and not company_name:
            return {}

        target_url = cls.normalize_url(domain or f"https://www.{re.sub(r'[^a-z0-9]+', '', (company_name or '').lower())}.com")
        scraped = cls.scrape_url(target_url, timeout=timeout)
        if not scraped or not scraped.get("markdown"):
            # Try /about-us or /about if root domain returned thin content
            about_url = f"{target_url}/about-us"
            about_scraped = cls.scrape_url(about_url, timeout=timeout)
            if about_scraped and about_scraped.get("markdown"):
                scraped = about_scraped

        if not scraped or not scraped.get("markdown"):
            return {}

        md = scraped.get("markdown", "")
        # Extract clean excerpt for corporate overview
        clean_excerpt = re.sub(r"\[.*?\]\(.*?\)", "", md)  # strip markdown links
        clean_excerpt = re.sub(r"[#*_`>~]", "", clean_excerpt)  # strip markdown syntax
        clean_excerpt = re.sub(r"\s+", " ", clean_excerpt).strip()

        return {
            "source": "firecrawl",
            "url": scraped.get("url"),
            "title": scraped.get("title"),
            "description": scraped.get("description") or clean_excerpt[:350],
            "raw_markdown": md[:12000],  # preserve up to 12k chars for downstream AI synthesis
            "metadata": scraped.get("raw_metadata", {}),
        }

    @classmethod
    def scrape_division_overview(
        cls,
        lob_domain_or_url: Optional[str] = None,
        lob_name: Optional[str] = None,
        parent_company: Optional[str] = None,
        domain: Optional[str] = None,
        timeout: int = 15,
    ) -> Dict[str, Any]:
        """
        Tier-1 scraper for LOB divisions. Scrapes the operating unit's domain/products page.
        Returns overview, product offerings, and corporate context at 1 credit.
        """
        effective_target = lob_domain_or_url or domain
        if not effective_target and lob_name:
            # Fallback if domain wasn't resolved: check clean lob name slug
            slug = re.sub(r'[^a-z0-9]+', '', lob_name.lower())
            effective_target = f"{slug}.com"
        if not effective_target:
            return {}

        clean_url = cls.normalize_url(effective_target)
        scraped = cls.scrape_url(clean_url, timeout=timeout)
        if not scraped or not scraped.get("markdown"):
            return {}

        md = scraped.get("markdown", "")
        # Extract description and products
        clean_text = re.sub(r"\[.*?\]\(.*?\)", "", md)
        clean_text = re.sub(r"[#*_`>~]", "", clean_text)
        clean_text = re.sub(r"\s+", " ", clean_text).strip()

        return {
            "source": "firecrawl",
            "url": clean_url,
            "title": scraped.get("title"),
            "overview": scraped.get("description") or clean_text[:400],
            "full_markdown": md[:8000],
            "metadata": scraped.get("raw_metadata", {}),
        }
