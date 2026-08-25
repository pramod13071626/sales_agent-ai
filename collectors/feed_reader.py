"""
Feed Reader Utility — Live fetcher and parser for:
1. Google News RSS feeds
2. Reddit RSS discussions (with bypass headers)
3. SEC EDGAR Atom filing feeds
4. Google Trends & Patent links
"""

import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Optional
import requests

DEFAULT_HEADERS = {
    "User-Agent": "SalesAIAgent/1.0 (Enterprise Research Bot; mailto:admin@salesai.com)"
}

def fetch_google_news_feed(rss_url: str, limit: int = 5) -> List[Dict[str, str]]:
    """Fetches and parses live news articles from a Google News RSS feed URL."""
    articles = []
    try:
        res = requests.get(rss_url, headers=DEFAULT_HEADERS, timeout=10)
        if res.status_code == 200:
            root = ET.fromstring(res.content)
            for item in root.findall(".//item")[:limit]:
                title = item.find("title").text if item.find("title") is not None else ""
                link = item.find("link").text if item.find("link") is not None else ""
                pub_date = item.find("pubDate").text if item.find("pubDate") is not None else ""
                source = item.find("source").text if item.find("source") is not None else ""
                articles.append({
                    "title": title,
                    "link": link,
                    "pub_date": pub_date,
                    "source": source
                })
    except Exception as e:
        print(f"[!] Error fetching Google News feed: {e}")
    return articles

def fetch_reddit_discussions(reddit_rss_url: str, limit: int = 5) -> List[Dict[str, str]]:
    """Fetches and parses live discussions from a Reddit Search RSS URL using custom User-Agent."""
    discussions = []
    try:
        res = requests.get(reddit_rss_url, headers=DEFAULT_HEADERS, timeout=10)
        if res.status_code == 200:
            root = ET.fromstring(res.content)
            # Atom XML namespace
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            for entry in root.findall("atom:entry", ns)[:limit]:
                title = entry.find("atom:title", ns).text if entry.find("atom:title", ns) is not None else ""
                link_elem = entry.find("atom:link", ns)
                link = link_elem.attrib.get("href", "") if link_elem is not None else ""
                updated = entry.find("atom:updated", ns).text if entry.find("atom:updated", ns) is not None else ""
                discussions.append({
                    "title": title,
                    "link": link,
                    "updated": updated
                })
    except Exception as e:
        print(f"[!] Error fetching Reddit feed: {e}")
    return discussions

def fetch_sec_filings_feed(sec_filings_rss_url: str, limit: int = 5) -> List[Dict[str, str]]:
    """Fetches and parses official SEC EDGAR company filing entries."""
    filings = []
    try:
        res = requests.get(sec_filings_rss_url, headers=DEFAULT_HEADERS, timeout=10)
        if res.status_code == 200:
            root = ET.fromstring(res.content)
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            for entry in root.findall("atom:entry", ns)[:limit]:
                title = entry.find("atom:title", ns).text if entry.find("atom:title", ns) is not None else ""
                link_elem = entry.find("atom:link", ns)
                link = link_elem.attrib.get("href", "") if link_elem is not None else ""
                summary = entry.find("atom:summary", ns).text if entry.find("atom:summary", ns) is not None else ""
                filings.append({
                    "title": title,
                    "link": link,
                    "summary": summary
                })
    except Exception as e:
        print(f"[!] Error fetching SEC feed: {e}")
    return filings
