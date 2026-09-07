import os
import re
import json
import time
import urllib.parse
from urllib.parse import urlparse
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import config


class AccountServiceHTTPClient:
    """Enterprise HTTP Client with connection pooling, exponential retries, and safe timeouts."""

    _session: Optional[requests.Session] = None

    @classmethod
    def get_session(cls) -> requests.Session:
        if cls._session is None:
            session = requests.Session()
            retries = Retry(
                total=3,
                backoff_factor=0.5,
                status_forcelist=[429, 500, 502, 503, 504],
                allowed_methods=["GET", "POST"],
            )
            adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=20)
            session.mount("https://", adapter)
            session.mount("http://", adapter)
            cls._session = session
        return cls._session


class AccountInputResolver:
    """Pre-flight parameter normalization and identity resolution engine.

    Resolves:
      1. Root domain normalization (strips http://, www., path suffixes, query params)
      2. Clean company name (strips corporate suffixes: Inc, LLC, Corp, Ltd, Co, LP, PLC, etc.)
      3. Alias expansion (produces list of variations for multi-strategy search)
      4. SEC CIK and Ticker lookup from in-memory cached SEC index
      5. Generates optimized query strings per connector
    """
    _sec_title_map: Optional[Dict[str, Dict[str, str]]] = None

    @staticmethod
    def normalize_domain(url_or_domain: Optional[str]) -> Optional[str]:
        if not url_or_domain:
            return None
        raw = str(url_or_domain).strip().lower()
        if not raw.startswith(("http://", "https://")):
            raw = "https://" + raw
        try:
            parsed = urlparse(raw)
            domain = parsed.netloc or parsed.path
            domain = re.sub(r"^www\.", "", domain)
            domain = domain.split(":")[0]
            domain = domain.split("/")[0]
            return domain if "." in domain else None
        except Exception:
            return None

    @staticmethod
    def clean_company_name(name: str) -> str:
        if not name:
            return ""
        cleaned = str(name).strip()
        cleaned = re.sub(r"\s*\([^)]*\)", "", cleaned)
        # Strip corporate suffixes (including & Co., & Company, etc.)
        pattern = r"(?i)\s*(?:&|and)?\s*\b(inc\.?|incorporated|llc|l\.l\.c\.?|corp\.?|corporation|co\.?|company|ltd\.?|limited|l\.p\.?|lp|plc|n\.a\.?|sa|ag|gmbh|nv|bv)\b.*$"
        cleaned = re.sub(pattern, "", cleaned).strip()
        # Strip trailing punctuation or dangling ampersands
        cleaned = re.sub(r"[,.\-_\s&]+$", "", cleaned).strip()
        return cleaned or name.strip()

    @staticmethod
    def strip_leading_articles(name: str) -> str:
        """Strips leading 'The ' from company names for normalization."""
        return re.sub(r"(?i)^the\s+", "", name).strip()

    @classmethod
    def load_sec_tickers_index(cls) -> Dict[str, Dict[str, str]]:
        """Loads and indexes SEC company_tickers.json into memory (cached)."""
        if cls._sec_title_map is not None:
            return cls._sec_title_map

        sec_map: Dict[str, Dict[str, str]] = {}
        try:
            session = AccountServiceHTTPClient.get_session()
            headers = {"User-Agent": "SalesIntelBot admin@salesintel.io"}
            res = session.get("https://www.sec.gov/files/company_tickers.json", headers=headers, timeout=5)
            if res.status_code == 200:
                data = res.json()
                for _, item in data.items():
                    title = str(item.get("title", "")).strip().lower()
                    ticker = str(item.get("ticker", "")).strip().upper()
                    cik = str(item.get("cik_str", "")).zfill(10)
                    info = {"ticker": ticker, "cik": cik, "title": item.get("title", "")}
                    if title:
                        sec_map[title] = info
                        # Also index without leading 'The'
                        no_the = cls.strip_leading_articles(title).lower()
                        if no_the and no_the not in sec_map:
                            sec_map[no_the] = info
                        # Also index clean version
                        clean_t = cls.clean_company_name(title).lower()
                        if clean_t and clean_t not in sec_map:
                            sec_map[clean_t] = info
                        clean_no_the = cls.clean_company_name(no_the).lower()
                        if clean_no_the and clean_no_the not in sec_map:
                            sec_map[clean_no_the] = info
                    if ticker:
                        sec_map[ticker.lower()] = info
        except Exception as e:
            print(f"[!] [AccountInputResolver] SEC tickers index notice: {e}")

        cls._sec_title_map = sec_map
        return sec_map

    @classmethod
    def resolve(
        cls,
        company_name: str,
        domain: Optional[str] = None,
        ticker: Optional[str] = None,
        sec_cik: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Performs pre-flight parameter resolution across all input dimensions."""
        clean_name = cls.clean_company_name(company_name)
        no_the_name = cls.strip_leading_articles(company_name)
        clean_no_the = cls.strip_leading_articles(clean_name)
        root_domain = cls.normalize_domain(domain)

        aliases = [company_name.strip()]
        for candidate in [clean_name, no_the_name, clean_no_the]:
            if candidate and candidate.lower() not in [a.lower() for a in aliases]:
                aliases.append(candidate)
        if root_domain:
            domain_name = root_domain.split(".")[0].capitalize()
            if domain_name.lower() not in [a.lower() for a in aliases]:
                aliases.append(domain_name)

        resolved_ticker = ticker.upper() if ticker else None
        resolved_cik = str(sec_cik).zfill(10) if sec_cik else None

        if not resolved_ticker or not resolved_cik:
            sec_index = cls.load_sec_tickers_index()
            # Try multiple matching strategies in priority order
            search_keys = [
                company_name.lower().strip(),
                no_the_name.lower().strip(),
                clean_name.lower().strip(),
                clean_no_the.lower().strip(),
            ]
            match = None
            for sk in search_keys:
                if sk and sk in sec_index:
                    match = sec_index[sk]
                    break

            if not match and clean_no_the:
                for k, v in sec_index.items():
                    if k.startswith(clean_no_the.lower()) or clean_no_the.lower() in k:
                        match = v
                        break

            if match:
                if not resolved_ticker:
                    resolved_ticker = match.get("ticker")
                if not resolved_cik:
                    resolved_cik = match.get("cik")

        return {
            "original_name": company_name.strip(),
            "clean_name": clean_name or company_name.strip(),
            "root_domain": root_domain,
            "ticker": resolved_ticker,
            "sec_cik": resolved_cik,
            "aliases": aliases,
            "wikipedia_title": clean_no_the or clean_name or company_name.strip(),
            "glassdoor_query": clean_no_the or clean_name or company_name.strip(),
            "courtlistener_query": company_name.strip(),
            "gleif_query": company_name.strip(),
            "openfec_query": company_name.strip(),
        }


class RawDataLakeWriter:
    """Append-only immutable raw storage writer for data governance and future replayability."""

    @staticmethod
    def save_raw(
        raw_data: Any,
        source_name: str,
        entity_name: str,
        run_raw_dir: Optional[Path] = None,
        file_ext: str = "json",
    ) -> Optional[str]:
        """Saves raw data from any source and returns the relative stored filepath."""
        if not raw_data:
            return None

        try:
            if run_raw_dir:
                target_dir = Path(run_raw_dir) / source_name.lower()
            else:
                timestamp = time.strftime("%Y-%m-%d")
                target_dir = Path(config.OUTPUT_DIR) / timestamp / "raw" / source_name.lower()

            target_dir.mkdir(parents=True, exist_ok=True)

            safe_entity = re.sub(r"[^a-z0-9]+", "_", entity_name.lower()).strip("_")
            filename = f"{safe_entity}_{source_name.lower()}_raw.{file_ext}"
            file_path = target_dir / filename

            if file_ext == "json":
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(raw_data, f, indent=2, ensure_ascii=False)
            else:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(str(raw_data))

            return str(file_path)
        except Exception as e:
            print(f"[!] [RawDataLake] Warning: Failed to save raw file for {source_name}: {e}")
            return None


class AccountCoalesceEngine:
    """Field-Level Priority Coalescing Engine for all 94 Account Columns."""

    @staticmethod
    def clean_text(val: Any) -> Optional[str]:
        if val is None:
            return None
        s = str(val).strip()
        return s if s and s.lower() not in ["none", "null", "n/a", "undefined"] else None

    @staticmethod
    def clean_number(val: Any) -> Optional[float]:
        if val is None:
            return None
        if isinstance(val, (int, float)):
            return float(val)
        try:
            cleaned = re.sub(r"[^0-9.-]", "", str(val))
            return float(cleaned) if cleaned else None
        except Exception:
            return None

    @classmethod
    def coalesce(
        cls,
        company_name: str,
        domain: Optional[str] = None,
        sec_data: Optional[Dict[str, Any]] = None,
        gleif_data: Optional[Dict[str, Any]] = None,
        opencorporates_data: Optional[Dict[str, Any]] = None,
        fmp_data: Optional[Dict[str, Any]] = None,
        courtlistener_data: Optional[Dict[str, Any]] = None,
        finnhub_data: Optional[Dict[str, Any]] = None,
        apify_crunchbase: Optional[Dict[str, Any]] = None,
        apify_glassdoor: Optional[Dict[str, Any]] = None,
        apify_twitter: Optional[Dict[str, Any]] = None,
        diffbot_data: Optional[Dict[str, Any]] = None,
        serper_data: Optional[Dict[str, Any]] = None,
        wiki_data: Optional[Dict[str, Any]] = None,
        fec_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Executes field-by-field priority waterfall resolving all 94 columns.
        Zero data loss: all raw structures are preserved in raw_data JSONB.
        """
        sec = sec_data or {}
        gleif = gleif_data or {}
        opencorp = opencorporates_data or {}
        fmp = fmp_data or {}
        court = courtlistener_data or {}
        finnhub = finnhub_data or {}
        cb = apify_crunchbase or {}
        gd = apify_glassdoor or {}
        tw = apify_twitter or {}
        diff = diffbot_data or {}
        serp = serper_data or {}
        wiki = wiki_data or {}
        fec = fec_data or {}

        # 1. Identity & Legal
        legal_name = cls.clean_text(
            sec.get("legal_name")
            or gleif.get("legal_name")
            or opencorp.get("name")
            or diff.get("name")
            or cb.get("name")
            or company_name
        )
        display_name = cls.clean_text(
            cb.get("name") or diff.get("name") or wiki.get("title") or company_name
        )
        slug_key = re.sub(r"[^a-z0-9]+", "-", (display_name or company_name).lower()).strip("-")

        target_domain = cls.clean_text(
            domain or diff.get("domain") or cb.get("domain") or serp.get("domain")
        )
        sec_cik = cls.clean_text(sec.get("sec_cik") or fmp.get("cik") or diff.get("sec_cik"))
        lei_code = cls.clean_text(gleif.get("lei") or sec.get("lei"))
        company_type = cls.clean_text(
            cb.get("company_type")
            or opencorp.get("company_type")
            or ("Public" if sec_cik else "Private")
        )
        operating_status = cls.clean_text(
            cb.get("operating_status")
            or opencorp.get("current_status")
            or gleif.get("status")
            or "Active"
        )
        founded_year = cls.clean_number(
            cb.get("founded_on") or diff.get("founded_year") or wiki.get("founded_year")
        )

        # 2. Financials & Funding (SEC 10-K is authoritative, FMP/CB fallback)
        revenue = cls.clean_text(
            sec.get("revenue_formatted")
            or fmp.get("revenue_formatted")
            or cb.get("revenue_range")
            or diff.get("revenue")
        )
        total_funding = cls.clean_number(
            cb.get("total_funding_usd") or fmp.get("total_funding") or diff.get("total_funding")
        )
        last_funding_type = cls.clean_text(
            cb.get("last_funding_type") or ("IPO / Public" if sec_cik else None)
        )
        last_funding_date = cls.clean_text(cb.get("last_funding_at"))
        num_funding_rounds = cls.clean_number(cb.get("num_funding_rounds"))
        funding_status = cls.clean_text(
            cb.get("funding_status") or ("IPO" if sec_cik else "Private")
        )
        stock_symbol = cls.clean_text(
            sec.get("ticker")
            or fmp.get("symbol")
            or finnhub.get("symbol")
            or cb.get("stock_symbol")
        )
        stock_exchange = cls.clean_text(
            sec.get("exchange") or fmp.get("exchange") or cb.get("stock_exchange")
        )
        ipo_status = cls.clean_text(cb.get("ipo_status") or ("Public" if sec_cik else "Private"))

        # 3. Location & Contact
        hq_city = cls.clean_text(
            cb.get("city") or diff.get("city") or opencorp.get("city") or sec.get("city")
        )
        hq_state = cls.clean_text(
            cb.get("state") or diff.get("state") or opencorp.get("state") or sec.get("state")
        )
        hq_country = cls.clean_text(
            cb.get("country")
            or diff.get("country")
            or gleif.get("country")
            or opencorp.get("jurisdiction")
        )
        hq_location = ", ".join(filter(None, [hq_city, hq_state, hq_country])) or None
        phone_number = cls.clean_text(diff.get("phone") or cb.get("phone") or opencorp.get("phone"))
        contact_email = cls.clean_text(diff.get("contact_email") or cb.get("email"))

        # 4. Social & External URLs
        website_url = cls.clean_text(
            f"https://{target_domain}"
            if target_domain
            else cb.get("website_url") or diff.get("website_url")
        )
        crunchbase_url = cls.clean_text(cb.get("crunchbase_url") or serp.get("crunchbase_url"))
        linkedin_url = cls.clean_text(
            cb.get("linkedin_url") or diff.get("linkedin_url") or serp.get("linkedin_url")
        )
        twitter_url = cls.clean_text(
            tw.get("twitter_url")
            or cb.get("twitter_url")
            or diff.get("twitter_url")
            or serp.get("twitter_url")
        )
        twitter_handle = cls.clean_text(tw.get("handle") or cb.get("twitter_handle"))
        github_url = cls.clean_text(cb.get("github_url") or diff.get("github_url"))
        glassdoor_url = cls.clean_text(
            gd.get("glassdoor_url") or cb.get("glassdoor_url") or serp.get("glassdoor_url")
        )
        wikipedia_url = cls.clean_text(wiki.get("wikipedia_url") or serp.get("wikipedia_url"))

        # 5. SEC EDGAR URLs
        sec_edgar_url = cls.clean_text(
            f"https://www.sec.gov/edgar/browse/?CIK={sec_cik}" if sec_cik else None
        )
        sec_filings_rss = cls.clean_text(
            f"https://data.sec.gov/rss?cik={sec_cik}" if sec_cik else None
        )
        sec_submissions_url = cls.clean_text(
            f"https://data.sec.gov/submissions/CIK{sec_cik}.json" if sec_cik else None
        )

        # 6. Digital Footprint & Tech Stack
        global_traffic_rank = cls.clean_number(
            serp.get("global_traffic_rank") or cb.get("rank") or diff.get("traffic_rank")
        )
        monthly_visits = cls.clean_text(serp.get("monthly_visits") or cb.get("monthly_visits"))
        bounce_rate = cls.clean_text(serp.get("bounce_rate"))
        visit_duration = cls.clean_text(serp.get("visit_duration"))
        page_views_per_visit = cls.clean_number(serp.get("page_views_per_visit"))
        active_tech_count = cls.clean_number(
            diff.get("active_tech_count")
            or (len(diff.get("technologies", [])) if diff.get("technologies") else None)
        )
        it_spend = cls.clean_text(diff.get("it_spend") or cb.get("it_spend"))
        patents_granted = cls.clean_number(
            serp.get("patents_count")
            or (len(serp.get("patents", [])) if serp.get("patents") else None)
        )

        # 7. OSINT URLs (Dynamic Zero-Cost Launchpads)
        enc_name = urllib.parse.quote_plus(display_name or company_name)
        google_patents_url = f"https://patents.google.com/?assignee={enc_name}"
        google_trends_url = f"https://trends.google.com/trends/explore?q={enc_name}"
        news_query = f"{company_name} news"
        rss_url = f"https://news.google.com/rss/search?q={enc_name}&hl=en-US&gl=US&ceid=US:en"
        reddit_query = f"{company_name} site:reddit.com"
        reddit_rss_url = f"https://www.reddit.com/search.rss?q={enc_name}&sort=new"
        youtube_search_url = f"https://www.youtube.com/results?search_query={enc_name}+corporate"
        openalex_institution_url = f"https://openalex.org/institutions?search={enc_name}"
        wikidata_entity_url = cls.clean_text(
            wiki.get("wikidata_url") or f"https://www.wikidata.org/w/index.php?search={enc_name}"
        )

        # 8. Glassdoor Culture & Sentiment
        culture_score = cls.clean_number(gd.get("overall_rating"))
        ceo_approval_rate = cls.clean_number(gd.get("ceo_approval_pct"))

        # 9. Master Raw Data JSONB (Extensible Data Lake Bucket)
        raw_payload = {
            "sec_edgar": sec,
            "gleif": gleif,
            "opencorporates": opencorp,
            "financial_modeling_prep": fmp,
            "courtlistener": court,
            "finnhub": finnhub,
            "apify_crunchbase": cb,
            "apify_glassdoor": gd,
            "apify_twitter": tw,
            "diffbot": diff,
            "serper": serp,
            "wikipedia": wiki,
            "openfec": fec,
        }

        return {
            "key": slug_key,
            "display_name": display_name,
            "legal_name": legal_name,
            "primary_domain": target_domain,
            "domain": target_domain,
            "website_url": website_url,
            "crunchbase_url": crunchbase_url,
            "linkedin_url": linkedin_url,
            "twitter_url": twitter_url,
            "twitter_handle": twitter_handle,
            "github_url": github_url,
            "glassdoor_url": glassdoor_url,
            "blog_url": cls.clean_text(diff.get("blog_url")),
            "operating_status": operating_status,
            "company_type": company_type,
            "founded_year": int(founded_year) if founded_year else None,
            "employee_count_range": cls.clean_text(
                cb.get("employee_count_range") or diff.get("employee_count_range")
            ),
            "headquarters_location": hq_location,
            "city": hq_city,
            "state": hq_state,
            "country": hq_country,
            "postal_code": cls.clean_text(diff.get("postal_code") or sec.get("postal_code")),
            "phone_number": phone_number,
            "sanitized_phone": re.sub(r"[^0-9+]", "", phone_number) if phone_number else None,
            "contact_email": contact_email,
            "revenue": revenue,
            "total_funding_amount_usd": total_funding,
            "total_funding_currency": "USD" if total_funding else None,
            "last_funding_type": last_funding_type,
            "last_funding_date": last_funding_date,
            "num_funding_rounds": int(num_funding_rounds) if num_funding_rounds else None,
            "funding_status": funding_status,
            "stock_symbol": stock_symbol,
            "stock_exchange": stock_exchange,
            "ipo_status": ipo_status,
            "sec_cik": sec_cik,
            "sec_edgar_url": sec_edgar_url,
            "sec_filings_rss": sec_filings_rss,
            "sec_submissions_url": sec_submissions_url,
            "global_traffic_rank": int(global_traffic_rank) if global_traffic_rank else None,
            "monthly_visits": monthly_visits,
            "bounce_rate": bounce_rate,
            "visit_duration": visit_duration,
            "page_views_per_visit": page_views_per_visit,
            "heat_score": int(diff.get("heat_score")) if diff.get("heat_score") else None,
            "trend_score_90d": (
                int(diff.get("trend_score_90d")) if diff.get("trend_score_90d") else None
            ),
            "active_tech_count": int(active_tech_count) if active_tech_count else None,
            "it_spend": it_spend,
            "patents_granted": int(patents_granted) if patents_granted else None,
            "trademarks_registered": (
                int(serp.get("trademarks_count")) if serp.get("trademarks_count") else None
            ),
            "twitter_live_url": cls.clean_text(
                f"https://x.com/{twitter_handle.lstrip('@')}" if twitter_handle else twitter_url
            ),
            "reddit_query": reddit_query,
            "reddit_rss_url": reddit_rss_url,
            "news_query": news_query,
            "rss_url": rss_url,
            "google_patents_url": google_patents_url,
            "google_trends_url": google_trends_url,
            "youtube_search_url": youtube_search_url,
            "openalex_institution_url": openalex_institution_url,
            "wikidata_entity_url": wikidata_entity_url,
            "industries": cb.get("industries") or diff.get("industries") or [],
            "keywords": cb.get("keywords") or diff.get("keywords") or [],
            "overview_description": cls.clean_text(
                diff.get("description") or cb.get("short_description") or wiki.get("summary")
            ),
            "culture_score": culture_score,
            "ceo_approval_rate": ceo_approval_rate,
            "raw_data": raw_payload,
        }


class AccountValidator:
    """Pre-DB Quality and Completeness Validator Gate."""

    @staticmethod
    def validate_account(account_dossier: Dict[str, Any]) -> Dict[str, Any]:
        """Calculates completeness percentage and assigns quality grade."""
        critical_fields = ["display_name", "legal_name", "key", "domain", "revenue"]
        important_fields = [
            "sec_cik",
            "headquarters_location",
            "website_url",
            "global_traffic_rank",
            "active_tech_count",
        ]

        total_fields = len(account_dossier)
        populated = sum(
            1 for v in account_dossier.values() if v is not None and v != "" and v != []
        )
        score = int((populated / total_fields) * 100) if total_fields else 0

        missing_critical = [f for f in critical_fields if not account_dossier.get(f)]
        missing_important = [f for f in important_fields if not account_dossier.get(f)]

        grade = "A" if score >= 85 and not missing_critical else ("B" if score >= 70 else "C")
        ready_for_db = len(missing_critical) == 0 and score >= 65

        return {
            "score": score,
            "grade": grade,
            "ready_for_db": ready_for_db,
            "total_columns": total_fields,
            "populated_columns": populated,
            "missing_critical": missing_critical,
            "missing_important": missing_important,
        }


class AccountService:
    """Main Orchestration Service for Level 1 Account Intelligence Ingestion."""

    @classmethod
    def collect(
        cls,
        company_name: str,
        domain: Optional[str] = None,
        ticker: Optional[str] = None,
        sec_cik: Optional[str] = None,
        run_raw_dir: Optional[Path] = None,
        mock_connectors: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Coordinates all Level 1 Connectors, writes raw Data Lake files,
        coalesces 94 columns, and validates quality.
        """
        start_ts = time.time()
        # Pre-Flight Parameter & Identity Resolution
        resolved_inputs = AccountInputResolver.resolve(
            company_name=company_name,
            domain=domain,
            ticker=ticker,
            sec_cik=sec_cik,
        )
        effective_name = resolved_inputs.get("original_name")
        clean_name = resolved_inputs.get("clean_name")
        effective_domain = resolved_inputs.get("root_domain") or domain
        effective_ticker = resolved_inputs.get("ticker")
        effective_cik = resolved_inputs.get("sec_cik")

        print(
            f"[*] [AccountService] Starting Level 1 Ingestion for '{effective_name}'"
            f" (Clean: '{clean_name}', Domain: {effective_domain or 'Auto'}, Ticker: {effective_ticker or 'N/A'}, CIK: {effective_cik or 'N/A'})..."
        )

        telemetry: Dict[str, Any] = {
            "company_name": effective_name,
            "resolved_inputs": resolved_inputs,
            "started_at": start_ts,
            "sources": {},
        }

        def _timed_fetch(name: str, fetch_fn):
            t0 = time.time()
            try:
                data = fetch_fn()
                elapsed = round((time.time() - t0) * 1000, 2)
                has_data = bool(data and (not isinstance(data, dict) or any(data.values())))
                telemetry["sources"][name] = {
                    "status": "success" if has_data else "empty",
                    "latency_ms": elapsed,
                    "records_or_keys": len(data) if isinstance(data, (dict, list)) else 1 if data else 0,
                    "reason_if_empty": None if has_data else "Source returned empty payload or no match",
                }
                return data
            except Exception as ex:
                elapsed = round((time.time() - t0) * 1000, 2)
                telemetry["sources"][name] = {
                    "status": "error",
                    "latency_ms": elapsed,
                    "error": str(ex),
                }
                print(f"[!] [AccountService] Connector '{name}' error: {ex}")
                return {}

        # 1. Multi-source connector execution (with mock injection support for offline testing)
        sec_data = (
            mock_connectors.get("sec")
            if mock_connectors
            else _timed_fetch("sec_edgar", lambda: cls._fetch_sec_edgar(effective_name, effective_ticker, effective_cik))
        )
        RawDataLakeWriter.save_raw(sec_data, "sec_edgar", effective_name, run_raw_dir)

        # Re-resolve ticker / CIK if SEC just discovered them
        if isinstance(sec_data, dict):
            if sec_data.get("ticker") and not effective_ticker:
                effective_ticker = sec_data.get("ticker")
            if sec_data.get("sec_cik") and not effective_cik:
                effective_cik = sec_data.get("sec_cik")

        gleif_data = (
            mock_connectors.get("gleif")
            if mock_connectors
            else _timed_fetch("gleif", lambda: cls._fetch_gleif(effective_name))
        )
        RawDataLakeWriter.save_raw(gleif_data, "gleif", effective_name, run_raw_dir)

        opencorp_data = (
            mock_connectors.get("opencorporates")
            if mock_connectors
            else _timed_fetch("opencorporates", lambda: cls._fetch_opencorporates(clean_name or effective_name))
        )
        RawDataLakeWriter.save_raw(opencorp_data, "opencorporates", effective_name, run_raw_dir)

        fmp_data = (
            mock_connectors.get("fmp")
            if mock_connectors
            else _timed_fetch("fmp", lambda: cls._fetch_fmp(effective_ticker))
        )
        RawDataLakeWriter.save_raw(fmp_data, "fmp", effective_name, run_raw_dir)

        court_data = (
            mock_connectors.get("courtlistener")
            if mock_connectors
            else _timed_fetch("courtlistener", lambda: cls._fetch_courtlistener(effective_name))
        )
        RawDataLakeWriter.save_raw(court_data, "courtlistener", effective_name, run_raw_dir)

        finnhub_data = (
            mock_connectors.get("finnhub")
            if mock_connectors
            else _timed_fetch("finnhub", lambda: cls._fetch_finnhub(effective_ticker))
        )
        RawDataLakeWriter.save_raw(finnhub_data, "finnhub", effective_name, run_raw_dir)

        cb_data = (
            mock_connectors.get("apify_crunchbase")
            if mock_connectors
            else _timed_fetch("apify_crunchbase", lambda: cls._fetch_apify_crunchbase(effective_name, effective_domain))
        )
        RawDataLakeWriter.save_raw(cb_data, "apify_crunchbase", effective_name, run_raw_dir)

        gd_data = (
            mock_connectors.get("apify_glassdoor")
            if mock_connectors
            else _timed_fetch("apify_glassdoor", lambda: cls._fetch_apify_glassdoor(clean_name or effective_name))
        )
        RawDataLakeWriter.save_raw(gd_data, "apify_glassdoor", effective_name, run_raw_dir)

        diffbot_data = (
            mock_connectors.get("diffbot")
            if mock_connectors
            else _timed_fetch("diffbot", lambda: cls._fetch_diffbot(effective_name, effective_domain))
        )
        RawDataLakeWriter.save_raw(diffbot_data, "diffbot", effective_name, run_raw_dir)

        serper_data = (
            mock_connectors.get("serper")
            if mock_connectors
            else _timed_fetch("serper", lambda: cls._fetch_serper(effective_name, effective_domain))
        )
        RawDataLakeWriter.save_raw(serper_data, "serper", effective_name, run_raw_dir)

        wiki_data = (
            mock_connectors.get("wikipedia")
            if mock_connectors
            else _timed_fetch("wikipedia", lambda: cls._fetch_wikipedia(clean_name or effective_name))
        )
        RawDataLakeWriter.save_raw(wiki_data, "wikipedia", effective_name, run_raw_dir)

        fec_data = (
            mock_connectors.get("openfec")
            if mock_connectors
            else _timed_fetch("openfec", lambda: cls._fetch_openfec(effective_name))
        )
        RawDataLakeWriter.save_raw(fec_data, "openfec", effective_name, run_raw_dir)

        # 2. Field-Level Coalesce Waterfall
        account_dossier = AccountCoalesceEngine.coalesce(
            company_name=effective_name,
            domain=effective_domain,
            sec_data=sec_data,
            gleif_data=gleif_data,
            opencorporates_data=opencorp_data,
            fmp_data=fmp_data,
            courtlistener_data=court_data,
            finnhub_data=finnhub_data,
            apify_crunchbase=cb_data,
            apify_glassdoor=gd_data,
            diffbot_data=diffbot_data,
            serper_data=serper_data,
            fec_data=fec_data,
        )

        # 3. Deep Intelligence Connectors (SEC 10-K, Patents, Exhibit 21, GLEIF Ownership Tree)
        # These are called AFTER coalescing so sec_cik is already resolved
        try:
            from collectors.account_collector import (
                fetch_latest_10k_chunks,
                extract_full_patents,
                fetch_sec_exhibit_21_subsidiaries,
                fetch_gleif_ownership_tree,
            )

            sec_cik_val = account_dossier.get("sec_cik")

            # 10-K Chunks (SEC EDGAR, free)
            tenk_data = {}
            if sec_cik_val:
                try:
                    tenk_data = fetch_latest_10k_chunks(sec_cik_val)
                    RawDataLakeWriter.save_raw(tenk_data, "sec_10k_chunks", company_name, run_raw_dir)
                    print(f"[+] [AccountService] 10-K chunks extracted for CIK {sec_cik_val}")
                except Exception as e:
                    print(f"[!] [AccountService] 10-K chunks notice: {e}")

            # USPTO Patent Intelligence (free)
            patents_data = {}
            try:
                patents_data = extract_full_patents(company_name)
                RawDataLakeWriter.save_raw(patents_data, "patents", company_name, run_raw_dir)
                print(f"[+] [AccountService] Patents extracted for '{company_name}'")
            except Exception as e:
                print(f"[!] [AccountService] Patents notice: {e}")

            # SEC Exhibit 21 — Official Subsidiary/LOB Names (free, highest value)
            ex21_data = {}
            if sec_cik_val:
                try:
                    ex21_data = fetch_sec_exhibit_21_subsidiaries(sec_cik_val)
                    RawDataLakeWriter.save_raw(ex21_data, "sec_exhibit21", company_name, run_raw_dir)
                    print(f"[+] [AccountService] Exhibit 21: {ex21_data.get('total_subsidiaries_found', 0)} subsidiaries found")
                except Exception as e:
                    print(f"[!] [AccountService] Exhibit 21 notice: {e}")

            # GLEIF Ownership Tree — LEI child entities = LOB/subsidiary names
            gleif_tree_data = {}
            try:
                gleif_tree_data = fetch_gleif_ownership_tree(company_name, max_children=25)
                RawDataLakeWriter.save_raw(gleif_tree_data, "gleif_tree", company_name, run_raw_dir)
                print(f"[+] [AccountService] GLEIF tree: {gleif_tree_data.get('total_child_entities_found', 0)} child entities found")
            except Exception as e:
                print(f"[!] [AccountService] GLEIF tree notice: {e}")

            # Build discovered_lob_names from both sources (deduplicated)
            sec_sub_names = [
                s.get("legal_name") for s in ex21_data.get("subsidiaries", [])
                if s.get("legal_name")
            ]
            gleif_child_names = [
                c.get("legal_name") for c in gleif_tree_data.get("child_entities", [])
                if c.get("legal_name")
            ]
            all_lob_hints = list(dict.fromkeys(sec_sub_names + gleif_child_names))
            account_dossier["discovered_lob_names"] = all_lob_hints

            # Populate organisational_hierarchy_tree column
            account_dossier["organisational_hierarchy_tree"] = {
                "gleif_lei": gleif_tree_data.get("lei"),
                "gleif_children": gleif_tree_data.get("child_entities", []),
                "sec_exhibit21_subsidiaries": ex21_data.get("subsidiaries", []),
                "total_subsidiaries_sec": ex21_data.get("total_subsidiaries_found", 0),
                "total_children_gleif": gleif_tree_data.get("total_child_entities_found", 0),
            }

            # Populate multi_source_intelligence column with all deep data
            account_dossier["multi_source_intelligence"] = {
                "sec_10k_chunks": tenk_data,
                "patents": patents_data,
                "sec_exhibit21": ex21_data,
                "gleif_ownership_tree": gleif_tree_data,
                "fec_political": fec_data if isinstance(fec_data, dict) else {},
                "courtlistener": court_data if isinstance(court_data, dict) else {},
                "finnhub": finnhub_data if isinstance(finnhub_data, dict) else {},
                "opencorporates": opencorp_data if isinstance(opencorp_data, dict) else {},
            }

        except Exception as deep_err:
            print(f"[!] [AccountService] Deep connector block notice: {deep_err}")

        # 4. Pre-DB Completeness Validator & Telemetry Logging
        audit = AccountValidator.validate_account(account_dossier)
        account_dossier["_validation_audit"] = audit
        telemetry["total_latency_ms"] = round((time.time() - start_ts) * 1000, 2)
        telemetry["validation_score"] = audit.get("score")
        telemetry["validation_grade"] = audit.get("grade")
        account_dossier["_telemetry"] = telemetry

        RawDataLakeWriter.save_raw(telemetry, "telemetry", effective_name, run_raw_dir)
        RawDataLakeWriter.save_raw(audit, "validation_report", effective_name, run_raw_dir)

        print(
            f"[+] [AccountService] Completed '{effective_name}': Completeness"
            f" {audit['score']}% (Grade: {audit['grade']}, Latency: {telemetry['total_latency_ms']}ms)"
        )

        return account_dossier

    # Ingestion Connector Implementations (Pure Dynamic HTTP)
    @staticmethod
    def _fetch_sec_edgar(
        company_name: str, ticker: Optional[str] = None, cik: Optional[str] = None
    ) -> Dict[str, Any]:
        """Free SEC EDGAR Submissions API with deep filing metadata."""
        headers = {"User-Agent": "SalesAIAgentResearch admin@salesai.com"}
        session = AccountServiceHTTPClient.get_session()
        sec_result: Dict[str, Any] = {}
        try:
            target_cik = cik
            target_ticker = ticker
            target_title = None

            if not target_cik:
                res = session.get(
                    "https://www.sec.gov/files/company_tickers.json", headers=headers, timeout=10
                )
                if res.ok:
                    data = res.json()
                    for entry in data.values():
                        if target_ticker and str(entry.get("ticker", "")).upper() == target_ticker.upper():
                            target_cik = str(entry.get("cik_str")).zfill(10)
                            target_title = entry.get("title")
                            target_ticker = entry.get("ticker")
                            break
                        if company_name.lower() in str(entry.get("title", "")).lower():
                            target_cik = str(entry.get("cik_str")).zfill(10)
                            target_title = entry.get("title")
                            target_ticker = entry.get("ticker")
                            break

            if target_cik:
                sec_result["sec_cik"] = str(target_cik).zfill(10)
                sec_result["legal_name"] = target_title or company_name
                sec_result["ticker"] = target_ticker

                # Fetch full SEC Submissions profile
                sub_url = f"https://data.sec.gov/submissions/CIK{sec_result['sec_cik']}.json"
                sub_res = session.get(sub_url, headers=headers, timeout=10)
                if sub_res.ok:
                    sub_data = sub_res.json()
                    sec_result["sic_code"] = sub_data.get("sic")
                    sec_result["sic_description"] = sub_data.get("sicDescription")
                    sec_result["fiscal_year_end"] = sub_data.get("fiscalYearEnd")
                    sec_result["phone"] = sub_data.get("phone")
                    
                    addr = sub_data.get("addresses", {}).get("business", {})
                    sec_result["city"] = addr.get("city")
                    sec_result["state"] = addr.get("stateOrCountry")
                    sec_result["postal_code"] = addr.get("zipCode")
                    sec_result["street"] = addr.get("street1")
                    sec_result["sec_name"] = sub_data.get("name")
                    sec_result["former_names"] = [f.get("name") for f in sub_data.get("formerNames", []) if f.get("name")]
                    sec_result["_raw_submission"] = sub_data

        except Exception as e:
            print(f"[!] SEC EDGAR connector warning: {e}")
        return sec_result

    @staticmethod
    def _fetch_gleif(company_name: str) -> Dict[str, Any]:
        """Free G20 GLEIF LEI Registry."""
        session = AccountServiceHTTPClient.get_session()
        try:
            base_url = "https://api.gleif.org/api/v1/lei-records"
            enc_comp = urllib.parse.quote_plus(company_name)
            url = f"{base_url}?filter[entity.legalName]={enc_comp}&page[size]=1"
            res = session.get(url, timeout=10)
            if res.ok:
                data = res.json()
                items = data.get("data", [])
                if items:
                    attr = items[0].get("attributes", {}).get("entity", {})
                    return {
                        "lei": items[0].get("attributes", {}).get("lei"),
                        "legal_name": attr.get("legalName", {}).get("name"),
                        "jurisdiction": attr.get("jurisdiction"),
                        "country": attr.get("legalAddress", {}).get("country"),
                        "status": attr.get("status"),
                    }
        except Exception as e:
            print(f"[!] GLEIF connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_opencorporates(company_name: str) -> Dict[str, Any]:
        """OpenCorporates Global Registry."""
        session = AccountServiceHTTPClient.get_session()
        try:
            base_url = "https://api.opencorporates.com/v0.4/companies/search"
            enc_comp = urllib.parse.quote_plus(company_name)
            url = f"{base_url}?q={enc_comp}&per_page=1"
            res = session.get(url, timeout=10)
            if res.ok:
                data = res.json()
                companies = data.get("results", {}).get("companies", [])
                if companies:
                    c = companies[0].get("company", {})
                    return {
                        "name": c.get("name"),
                        "company_number": c.get("company_number"),
                        "jurisdiction": c.get("jurisdiction_code"),
                        "current_status": c.get("current_status"),
                        "company_type": c.get("company_type"),
                    }
        except Exception as e:
            print(f"[!] OpenCorporates connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_courtlistener(company_name: str) -> Dict[str, Any]:
        """CourtListener / RECAP Federal Legal Dockets API (100% Free)."""
        session = AccountServiceHTTPClient.get_session()
        try:
            base_url = "https://www.courtlistener.com/api/rest/v3/search/"
            enc_comp = urllib.parse.quote_plus(company_name)
            url = f"{base_url}?q={enc_comp}&type=d"
            res = session.get(
                url, headers={"User-Agent": "SalesAIAgentResearch admin@salesai.com"}, timeout=10
            )
            if res.ok:
                data = res.json()
                results = data.get("results", [])
                return {"total_dockets": data.get("count", 0), "recent_dockets": results[:3]}
        except Exception as e:
            print(f"[!] CourtListener connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_finnhub(ticker: Optional[str]) -> Dict[str, Any]:
        """Finnhub Market Sentiment & News API."""
        if not ticker:
            return {}
        api_key = os.getenv("FINNHUB_API_KEY")
        if not api_key:
            return {}
        session = AccountServiceHTTPClient.get_session()
        try:
            url = f"https://finnhub.io/api/v1/news-sentiment?symbol={ticker}&token={api_key}"
            res = session.get(url, timeout=10)
            if res.ok:
                return res.json()
        except Exception as e:
            print(f"[!] Finnhub connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_fmp(ticker: Optional[str]) -> Dict[str, Any]:
        """Financial Modeling Prep API."""
        if not ticker:
            return {}
        api_key = os.getenv("FMP_API_KEY")
        if not api_key:
            return {}
        session = AccountServiceHTTPClient.get_session()
        try:
            res = session.get(
                f"https://financialmodelingprep.com/api/v3/profile/{ticker}?apikey={api_key}",
                timeout=10,
            )
            if res.ok and res.json():
                item = res.json()[0]
                return {
                    "symbol": item.get("symbol"),
                    "revenue_formatted": f"${item.get('mktCap', 0)/1e9:.1f}B Market Cap",
                    "exchange": item.get("exchangeShortName"),
                    "cik": item.get("cik"),
                }
        except Exception as e:
            print(f"[!] FMP connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_apify_crunchbase(company_name: str, domain: Optional[str]) -> Dict[str, Any]:
        """Apify Crunchbase Scraper."""
        if not config.APIFY_TOKEN:
            return {}
        try:
            from apify_client import ApifyClient

            client = ApifyClient(config.APIFY_TOKEN)
            run = client.actor("curious_coder/crunchbase-url-scraper").call(
                run_input={"search": company_name, "maxItems": 1}
            )
            items = client.dataset(run["defaultDatasetId"]).list_items().items
            return items[0] if items else {}
        except Exception as e:
            print(f"[!] Apify Crunchbase warning: {e}")
        return {}

    @staticmethod
    def _fetch_apify_glassdoor(company_name: str) -> Dict[str, Any]:
        """Apify Glassdoor Scraper."""
        if not config.APIFY_TOKEN:
            return {}
        try:
            from apify_client import ApifyClient

            client = ApifyClient(config.APIFY_TOKEN)
            run = client.actor("memo23/glassdoor-scraper").call(
                run_input={"query": company_name, "maxReviews": 5}
            )
            items = client.dataset(run["defaultDatasetId"]).list_items().items
            return items[0] if items else {}
        except Exception as e:
            print(f"[!] Apify Glassdoor warning: {e}")
        return {}

    @staticmethod
    def _fetch_diffbot(company_name: str, domain: Optional[str]) -> Dict[str, Any]:
        """Diffbot Knowledge Graph deep entity extraction."""
        token = getattr(config, "DIFFBOT_TOKEN", None) or os.getenv("DIFFBOT_TOKEN")
        if not token:
            return {}
        session = AccountServiceHTTPClient.get_session()
        try:
            base_url = "https://kg.diffbot.com/kg/v3/enhance"
            enc_comp = urllib.parse.quote_plus(company_name)
            url = f"{base_url}?token={token}&type=Organization&name={enc_comp}"
            res = session.get(url, timeout=12)
            if res.ok:
                data = res.json().get("data", [])
                if data:
                    entity = data[0].get("entity", {})
                    loc = entity.get("location", {})
                    social = {p.get("type"): p.get("url") for p in entity.get("socialProfiles", []) if isinstance(p, dict)}
                    return {
                        "name": entity.get("name"),
                        "domain": entity.get("homepageUri"),
                        "description": entity.get("description"),
                        "phone": entity.get("phone"),
                        "street": loc.get("street"),
                        "city": loc.get("city", {}).get("name") if isinstance(loc.get("city"), dict) else loc.get("city"),
                        "state": loc.get("region", {}).get("name") if isinstance(loc.get("region"), dict) else loc.get("region"),
                        "country": loc.get("country", {}).get("name") if isinstance(loc.get("country"), dict) else loc.get("country"),
                        "postal_code": loc.get("postalCode"),
                        "nb_employees": entity.get("nbEmployees"),
                        "employee_count_range": f"{entity.get('nbEmployeesMin', '')}-{entity.get('nbEmployeesMax', '')}" if entity.get('nbEmployeesMin') else str(entity.get('nbEmployees', '')),
                        "revenue": entity.get("yearlyRevenues", [{}])[0].get("revenue") if entity.get("yearlyRevenues") else None,
                        "technologies": [t.get("name") for t in entity.get("technologies", []) if isinstance(t, dict)],
                        "patents_count": len(entity.get("patents", [])),
                        "linkedin_url": social.get("linkedin") or entity.get("linkedinUri"),
                        "twitter_url": social.get("twitter") or entity.get("twitterUri"),
                        "facebook_url": social.get("facebook") or entity.get("facebookUri"),
                        "github_url": social.get("github") or entity.get("githubUri"),
                        "glassdoor_url": social.get("glassdoor") or entity.get("glassdoorUri"),
                        "_raw_diffbot": entity,
                    }
        except Exception as e:
            print(f"[!] Diffbot connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_serper(company_name: str, domain: Optional[str]) -> Dict[str, Any]:
        """Google Serper Live Web & Patents Indexing."""
        if not config.SERPER_API_KEY:
            return {}
        headers = {"X-API-KEY": config.SERPER_API_KEY, "Content-Type": "application/json"}
        session = AccountServiceHTTPClient.get_session()
        try:
            res = session.post(
                "https://google.serper.dev/search",
                json={"q": f"{company_name} headquarters official website patents", "num": 5},
                headers=headers,
                timeout=10,
            )
            if res.ok:
                organic = res.json().get("organic", [])
                return {"organic_results": organic}
        except Exception as e:
            print(f"[!] Serper connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_wikipedia(company_name: str) -> Dict[str, Any]:
        """Free Wikipedia REST API."""
        session = AccountServiceHTTPClient.get_session()
        try:
            url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote_plus(company_name)}"
            res = session.get(
                url, headers={"User-Agent": "SalesAIAgentResearch admin@salesai.com"}, timeout=8
            )
            if res.ok:
                data = res.json()
                return {
                    "title": data.get("title"),
                    "summary": data.get("extract"),
                    "wikipedia_url": data.get("content_urls", {}).get("desktop", {}).get("page"),
                }
        except Exception as e:
            print(f"[!] Wikipedia connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_openfec(company_name: str) -> Dict[str, Any]:
        """OpenFEC Political & PAC Committees API (100% Free)."""
        api_key = getattr(config, "DATA_GOV_API_KEY", None) or "DEMO_KEY"
        session = AccountServiceHTTPClient.get_session()
        try:
            base_url = "https://api.open.fec.gov/v1/committees/"
            enc_comp = urllib.parse.quote_plus(company_name)
            url = f"{base_url}?api_key={api_key}&q={enc_comp}&per_page=5"
            res = session.get(url, timeout=8)
            if res.ok:
                data = res.json()
                results = data.get("results", [])
                return {
                    "total_committees": data.get("pagination", {}).get("count", 0),
                    "committees": [
                        {
                            "name": c.get("name"),
                            "committee_id": c.get("committee_id"),
                            "designation": c.get("designation_full"),
                            "committee_type": c.get("committee_type_full"),
                            "party": c.get("party_full"),
                            "treasurer_name": c.get("treasurer_name"),
                        }
                        for c in results
                    ],
                    "_raw_fec": data,
                }
        except Exception as e:
            print(f"[!] OpenFEC connector warning: {e}")
        return {}
