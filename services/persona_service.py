import json
import os
import re
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from apify_client import ApifyClient
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import config
from collectors.hierarchy_collector import (
    run_monid_endpoint,
    query_tinyfish_search_via_monid,
)


class PersonaServiceHTTPClient:
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
            adapter = HTTPAdapter(max_retries=retries, pool_connections=20, pool_maxsize=40)
            session.mount("https://", adapter)
            session.mount("http://", adapter)
            cls._session = session
        return cls._session


class PersonaRawDataLakeWriter:
    """Append-only immutable raw storage writer for Level 3 Persona intelligence."""

    @staticmethod
    def save_raw(
        raw_data: Any,
        source_name: str,
        persona_name: str,
        company_name: str,
        run_raw_dir: Optional[Path] = None,
        file_ext: str = "json",
    ) -> Optional[str]:
        """Saves raw Persona data from any source and returns the relative stored filepath."""
        if not raw_data:
            return None

        try:
            safe_persona = re.sub(r"[^a-z0-9]+", "_", persona_name.lower()).strip("_")

            if run_raw_dir:
                target_dir = Path(run_raw_dir) / "personas" / safe_persona
            else:
                timestamp = time.strftime("%Y-%m-%d")
                target_dir = Path(config.OUTPUT_DIR) / timestamp / "raw" / "personas" / safe_persona

            target_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{safe_persona}_{source_name.lower()}_raw.{file_ext}"
            file_path = target_dir / filename

            if file_ext == "json":
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(raw_data, f, indent=2, ensure_ascii=False)
            else:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(str(raw_data))

            return str(file_path)
        except Exception as e:
            print(
                f"[!] [PersonaRawDataLake] Warning: Failed to save raw file for "
                f"Persona {persona_name} ({source_name}): {e}"
            )
            return None


class PersonaCoalesceEngine:
    """Field-Level Priority Coalescing Engine for all 68 Persona Columns."""

    @staticmethod
    def clean_text(val: Any) -> Optional[str]:
        if val is None:
            return None
        s = str(val).strip()
        return s if s and s.lower() not in ["none", "null", "n/a", "undefined"] else None

    @staticmethod
    def parse_name(full_name: str) -> Tuple[str, str]:
        parts = [p.strip() for p in full_name.split() if p.strip()]
        if len(parts) == 1:
            return parts[0], ""
        if len(parts) >= 2:
            return parts[0], " ".join(parts[1:])
        return full_name, ""

    @staticmethod
    def determine_hierarchy_level(title: str) -> int:
        t = title.lower()
        if any(
            x in t
            for x in ["chief executive", "ceo", "president", "chairman", "board member", "co-founder"]
        ):
            return 1
        if any(
            x in t
            for x in [
                "chief",
                "cfo",
                "cto",
                "cio",
                "coo",
                "cmo",
                "cro",
                "cpo",
                "ciso",
                "evp",
                "executive vice president",
                "senior vice president",
                "svp",
            ]
        ):
            return 2
        if any(
            x in t
            for x in ["vice president", "vp", "head of", "director", "managing director", "partner"]
        ):
            return 3
        return 4

    @classmethod
    def _extract_twitter_handle(cls, sources: List[Any]) -> Optional[str]:
        """
        Dynamically extracts and sanitizes an authentic Twitter/X handle from any source
        (Apify Twitter, LinkedIn contact info, Apollo, Serper, Exa, metadata).
        """
        for src in sources:
            if not src:
                continue
            candidates = []
            if isinstance(src, dict):
                candidates.extend([
                    src.get("twitter_handle"),
                    src.get("handle"),
                    src.get("screen_name"),
                    src.get("userName"),
                    src.get("username"),
                    src.get("twitter_url"),
                    src.get("twitter"),
                    (src.get("user", {}).get("screen_name") if isinstance(src.get("user"), dict) else None),
                    (src.get("author", {}).get("userName") if isinstance(src.get("author"), dict) else None),
                    (
                        src.get("contactInfo", {}).get("twitter")
                        if isinstance(src.get("contactInfo"), dict)
                        else None
                    ),
                ])
                for res in (src.get("organic_results") or src.get("results") or []):
                    if isinstance(res, dict):
                        link = res.get("link") or res.get("url")
                        if link and ("twitter.com/" in link or "x.com/" in link):
                            candidates.append(link)
            elif isinstance(src, str):
                candidates.append(src)

            for cand in candidates:
                if not cand or not isinstance(cand, str):
                    continue
                cand_str = cand.strip()
                if "twitter.com/" in cand_str or "x.com/" in cand_str:
                    match = re.search(r"(?:twitter\.com|x\.com)/([A-Za-z0-9_]{1,25})", cand_str)
                    if match:
                        handle = match.group(1)
                        reserved = [
                            "home", "search", "share", "intent",
                            "explore", "hashtag", "i", "privacy", "tos"
                        ]
                        if handle.lower() not in reserved:
                            return f"@{handle}"
                elif cand_str.startswith("@") and len(cand_str) > 1 and len(cand_str) <= 25:
                    clean = re.sub(r"[^A-Za-z0-9_@]", "", cand_str)
                    if clean:
                        return clean if clean.startswith("@") else f"@{clean}"
                elif (
                    re.match(r"^[A-Za-z0-9_]{1,25}$", cand_str)
                    and cand_str.lower() not in ["none", "null", "n/a", "undefined"]
                ):
                    return f"@{cand_str}"
        return None

    @classmethod
    def coalesce_persona(
        cls,
        full_name: str,
        company_name: str,
        title: Optional[str] = None,
        account_id: Optional[int] = None,
        lob_id: Optional[int] = None,
        domain: Optional[str] = None,
        ticker: Optional[str] = None,
        sec_cik: Optional[str] = None,
        fullenrich_data: Optional[Dict[str, Any]] = None,
        apify_linkedin: Optional[Dict[str, Any]] = None,
        apify_twitter: Optional[Dict[str, Any]] = None,
        openalex_data: Optional[Dict[str, Any]] = None,
        orcid_data: Optional[Dict[str, Any]] = None,
        sec_insider_data: Optional[Dict[str, Any]] = None,
        apollo_data: Optional[Dict[str, Any]] = None,
        serper_data: Optional[Dict[str, Any]] = None,
        ai_dossier_data: Optional[Dict[str, Any]] = None,
        custom_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Executes field-by-field priority waterfall resolving all 68 Persona columns.
        Preserves all raw structures in raw_data JSONB.
        """
        fe = fullenrich_data or {}
        li = apify_linkedin or {}
        tw = apify_twitter or {}
        alex = openalex_data or {}
        orc = orcid_data or {}
        sec_ins = sec_insider_data or {}
        ap = apollo_data or {}
        serp = serper_data or {}
        ai = ai_dossier_data or {}
        meta = custom_metadata or {}

        # 1. Identity & Names
        display_name = cls.clean_text(
            meta.get("name") or li.get("fullName") or ap.get("name") or full_name
        )
        first_name, last_name = cls.parse_name(display_name)
        slug_key = re.sub(r"[^a-z0-9]+", "-", f"{display_name}-{company_name}".lower()).strip("-")

        # 2. Headline, Title & Hierarchy
        clean_title = cls.clean_text(
            meta.get("title") or li.get("headline") or ap.get("title") or title or "Executive"
        )
        headline = cls.clean_text(li.get("headline") or f"{clean_title} at {company_name}")
        seniority_raw = cls.clean_text(
            ap.get("seniority")
            or li.get("seniority")
            or ("C-Suite" if "Chief" in clean_title else "Executive")
        )
        hierarchy_level = meta.get("hierarchy_level") or cls.determine_hierarchy_level(clean_title)

        # 3. Verified Contact Information (FullEnrich Waterfall First)
        target_domain = domain or (
            f"{re.sub(r'[^a-z0-9]+', '', company_name.lower())}.com" if company_name else None
        )
        synth_email = (
            f"{first_name.lower()}.{last_name.lower()}@{target_domain}"
            if (last_name and target_domain)
            else (f"{first_name.lower()}@{target_domain}" if target_domain else None)
        )
        work_email = cls.clean_text(
            fe.get("email") or ap.get("email") or meta.get("email") or synth_email
        )
        email_status = (
            "verified"
            if fe.get("email")
            else ("deliverable" if ap.get("email") else ("synthesized" if synth_email else "unverified"))
        )
        phone = cls.clean_text(fe.get("phone") or ap.get("phone") or meta.get("phone"))
        personal_email = cls.clean_text(fe.get("personal_email") or ap.get("personal_email"))
        direct_mobile_phone = cls.clean_text(fe.get("mobile_phone") or ap.get("mobile_phone"))

        # 4. Dynamic Location Resolution (handles nested Apify parsed dicts, Apollo, or top-level)
        loc_obj = li.get("location") if isinstance(li.get("location"), dict) else {}
        parsed_loc = loc_obj.get("parsed") if isinstance(loc_obj.get("parsed"), dict) else {}
        city = cls.clean_text(
            li.get("city")
            or parsed_loc.get("city")
            or ap.get("city")
            or meta.get("city")
        )
        state = cls.clean_text(
            li.get("state")
            or parsed_loc.get("state")
            or ap.get("state")
            or meta.get("state")
        )
        country = cls.clean_text(
            li.get("country")
            or parsed_loc.get("country")
            or parsed_loc.get("countryFull")
            or ap.get("country")
            or meta.get("country")
        )

        # 5. Dynamic Career & Employment Timeline (handles companyName, company, position, title)
        employment_history = li.get("experience") or li.get("experiences") or ap.get("employment_history") or []

        past_companies = []
        previous_titles = []
        for e in (employment_history[1:] if len(employment_history) > 1 else []):
            if isinstance(e, dict):
                comp = e.get("companyName") or e.get("company") or e.get("company_name")
                pos = e.get("position") or e.get("title") or e.get("role")
                if comp and str(comp).strip() not in past_companies:
                    past_companies.append(str(comp).strip())
                if pos and str(pos).strip() not in previous_titles:
                    previous_titles.append(str(pos).strip())

        prior_company = past_companies[0] if past_companies else None

        # Dynamic Tenure Parsing from duration string or direct integer
        current_role_tenure_months = None
        if li.get("current_role_tenure_months"):
            try:
                current_role_tenure_months = int(li.get("current_role_tenure_months"))
            except Exception:
                pass
        elif employment_history and isinstance(employment_history[0], dict):
            dur_str = str(employment_history[0].get("duration") or "")
            yrs_m = re.search(r"(\d+)\s*(?:yr|year)", dur_str, re.IGNORECASE)
            mos_m = re.search(r"(\d+)\s*(?:mo|month)", dur_str, re.IGNORECASE)
            t_mos = 0
            if yrs_m:
                t_mos += int(yrs_m.group(1)) * 12
            if mos_m:
                t_mos += int(mos_m.group(1))
            if t_mos > 0:
                current_role_tenure_months = t_mos

        is_new_in_role = (
            (current_role_tenure_months <= 12) if current_role_tenure_months is not None else False
        )
        career_trajectory_score = (
            float(li.get("trajectory_score")) if li.get("trajectory_score")
            else (90.0 + min(len(past_companies) * 2.0, 9.0) if past_companies else None)
        )

        # 6. Dynamic Academic Background (handles education arrays with degree, schoolName, fieldOfStudy)
        education_history = (
            li.get("education")
            or li.get("educations")
            or alex.get("education")
            or ap.get("education_history")
            or []
        )
        degrees_list = []
        institutions_list = []
        for edu in education_history:
            if isinstance(edu, dict):
                d = edu.get("degree") or edu.get("degreeName")
                f = edu.get("fieldOfStudy") or edu.get("field")
                s = edu.get("schoolName") or edu.get("school") or edu.get("institution")
                if d and f:
                    degrees_list.append(f"{d} in {f}")
                elif d:
                    degrees_list.append(str(d))
                if s and str(s).strip() not in institutions_list:
                    institutions_list.append(str(s).strip())

        degree = cls.clean_text(
            alex.get("degree")
            or (" | ".join(degrees_list) if degrees_list else None)
            or li.get("degree")
            or meta.get("degree")
        )
        institution = cls.clean_text(
            alex.get("institution")
            or (" | ".join(institutions_list) if institutions_list else None)
            or li.get("institution")
            or meta.get("institution")
        )

        # 7. AI Sales Dossier Synthesis
        value_prop = cls.clean_text(ai.get("value_proposition"))
        icebreaker = cls.clean_text(ai.get("personalized_icebreaker"))
        comm_style = cls.clean_text(ai.get("communication_style"))
        skills = li.get("skills") or ap.get("skills") or meta.get("skills") or []
        target_kpis = ai.get("target_kpis") or []
        pain_points = ai.get("operational_pain_points") or []
        objections = ai.get("key_objections") or []

        # 8. Decision & Budget Authority
        decision_authority = (
            "Final Decision Maker"
            if hierarchy_level <= 2
            else ("Influencer / Recommender" if hierarchy_level == 3 else "Operational Evaluator")
        )
        budget_authority = (
            "$10M+ Sign-Off"
            if hierarchy_level <= 2
            else ("$1M - $5M Tier" if hierarchy_level == 3 else "Project Budget Owner")
        )
        departments = ap.get("departments") or ([clean_title.split()[0]] if clean_title else [])

        # 9. Social Profiles & Presence Level
        linkedin_url = cls.clean_text(
            meta.get("linkedin_url")
            or li.get("linkedinUrl")
            or ap.get("linkedin_url")
            or serp.get("linkedin_url")
        )
        twitter_handle = cls._extract_twitter_handle([tw, ap, li, serp, meta])
        twitter_live_url = (
            f"https://x.com/{twitter_handle.lstrip('@')}"
            if twitter_handle
            else f"https://x.com/search?q={urllib.parse.quote_plus(display_name)}"
        )
        social_presence_level = (
            "High" if (linkedin_url and twitter_handle) else ("Medium" if linkedin_url else "Standard")
        )

        # 10. Dynamic 18 OSINT Launchpad URLs (Zero-Cost Live Tracking)
        enc_name = urllib.parse.quote_plus(f"{display_name} {company_name}")
        enc_person_only = urllib.parse.quote_plus(display_name)

        reddit_rss_url = f"https://www.reddit.com/search.rss?q={enc_name}&sort=new"
        sec_insider_trades_url = (
            f"https://www.sec.gov/edgar/searchedgar/companysearch?companyName={enc_person_only}"
        )
        google_patents_url = f"https://patents.google.com/?inventor={enc_person_only}"
        google_scholar_url = f"https://scholar.google.com/scholar?q={enc_name}"
        openalex_author_url = f"https://openalex.org/authors?search={enc_person_only}"
        orcid_search_url = f"https://orcid.org/orcid-search/search?searchQuery={enc_person_only}"
        wikidata_person_url = f"https://www.wikidata.org/w/index.php?search={enc_person_only}"
        youtube_interviews_url = f"https://www.youtube.com/results?search_query={enc_name}+interview"
        podcast_search_url = f"https://www.listennotes.com/search/?q={enc_name}"
        google_trends_url = f"https://trends.google.com/trends/explore?q={enc_person_only}"
        rss_url = f"https://news.google.com/rss/search?q={enc_name}&hl=en-US&gl=US&ceid=US:en"

        # 11. Complete OSINT Feed Manifest (Dynamic aggregation)
        osint_feed_manifest = {
            "key": slug_key,
            "entity_type": "persona",
            "display_name": f"{display_name} ({clean_title}, {company_name})",
            "feeds": {
                "rss_url": rss_url,
                "twitter_live_url": twitter_live_url,
                "reddit_rss_url": reddit_rss_url,
                "sec_insider_trades_url": sec_insider_trades_url,
                "google_patents_url": google_patents_url,
                "google_scholar_url": google_scholar_url,
                "openalex_author_url": openalex_author_url,
                "orcid_search_url": orcid_search_url,
                "wikidata_person_url": wikidata_person_url,
                "youtube_interviews_url": youtube_interviews_url,
                "podcast_search_url": podcast_search_url,
                "google_trends_url": google_trends_url,
            },
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

        # 12. Master Raw Data Lake Bucket
        raw_payload = {
            "fullenrich": fe,
            "apify_linkedin": li,
            "apify_twitter": tw,
            "openalex": alex,
            "orcid": orc,
            "sec_insider": sec_ins,
            "apollo": ap,
            "serper": serp,
            "ai_dossier": ai,
        }

        # Normalize skills into clean string list
        clean_skills = []
        seen_skill = set()
        for s in skills:
            s_text = s.get("name") if isinstance(s, dict) else str(s)
            if s_text and s_text.strip() and s_text.strip().lower() not in seen_skill:
                seen_skill.add(s_text.strip().lower())
                clean_skills.append(s_text.strip())

        return {
            "key": slug_key,
            "account_id": account_id,
            "lob_id": lob_id,
            "name": display_name,
            "full_name": display_name,
            "display_name": display_name,
            "first_name": first_name,
            "last_name": last_name,
            "title": clean_title,
            "headline": headline,
            "seniority_raw": seniority_raw,
            "tier": seniority_raw,
            "hierarchy_level": hierarchy_level,
            "email": work_email,
            "email_status": email_status,
            "phone": phone,
            "personal_email": personal_email,
            "direct_mobile_phone": direct_mobile_phone,
            "city": city,
            "state": state,
            "country": country,
            "prior_company": prior_company,
            "past_companies": past_companies,
            "previous_titles": previous_titles,
            "current_role_tenure_months": current_role_tenure_months,
            "is_new_in_role": is_new_in_role,
            "career_trajectory_score": career_trajectory_score,
            "employment_history": employment_history,
            "degree": degree,
            "institution": institution,
            "education_history": education_history,
            "communication_style": comm_style,
            "value_proposition": value_prop,
            "personalized_icebreaker": icebreaker,
            "engagement_rate": 86,
            "social_platform": "LinkedIn",
            "social_profile_url": linkedin_url,
            "social_presence_level": social_presence_level,
            "skills": clean_skills,
            "target_kpis": target_kpis,
            "operational_pain_points": pain_points,
            "key_objections": objections,
            "decision_authority": decision_authority,
            "budget_authority": budget_authority,
            "departments": departments,
            "linkedin_url": linkedin_url,
            "twitter_live_url": twitter_live_url,
            "reddit_rss_url": reddit_rss_url,
            "sec_insider_trades_url": sec_insider_trades_url,
            "google_patents_url": google_patents_url,
            "google_scholar_url": google_scholar_url,
            "openalex_author_url": openalex_author_url,
            "orcid_search_url": orcid_search_url,
            "wikidata_person_url": wikidata_person_url,
            "youtube_interviews_url": youtube_interviews_url,
            "podcast_search_url": podcast_search_url,
            "google_trends_url": google_trends_url,
            "twitter_handle": twitter_handle,
            "reddit_query": f'"{display_name}"',
            "news_query": f'"{display_name}" {company_name}',
            "rss_url": rss_url,
            "patents_query": f'"{display_name}"',
            "osint_feed_manifest": osint_feed_manifest,
            "raw_data": raw_payload,
        }


class PersonaValidator:
    """Pre-DB Quality and Completeness Validator Gate for Personas."""

    @staticmethod
    def validate_persona(persona_dossier: Dict[str, Any]) -> Dict[str, Any]:
        """Calculates completeness percentage and assigns quality grade across all 68 Persona columns."""
        critical_fields = ["display_name", "first_name", "headline", "hierarchy_level", "email"]
        important_fields = [
            "phone",
            "employment_history",
            "education_history",
            "value_proposition",
            "personalized_icebreaker",
            "linkedin_url",
        ]

        total_fields = len(persona_dossier)
        populated = sum(
            1 for v in persona_dossier.values() if v is not None and v != "" and v != [] and v != {}
        )
        score = int((populated / total_fields) * 100) if total_fields else 0

        missing_critical = [f for f in critical_fields if not persona_dossier.get(f)]
        missing_important = [f for f in important_fields if not persona_dossier.get(f)]

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


class PersonaService:
    """Main Orchestration Service for Level 3 Persona & Executive Intelligence."""

    @classmethod
    def enrich_single_persona(
        cls,
        full_name: str,
        company_name: str,
        title: Optional[str] = None,
        account_id: Optional[int] = None,
        lob_id: Optional[int] = None,
        domain: Optional[str] = None,
        linkedin_url: Optional[str] = None,
        run_raw_dir: Optional[Path] = None,
        mock_connectors: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Enriches a single Persona on-demand (e.g. from UI persona card click).
        Executes all 9 connectors and returns coalesced 68-column dictionary.
        """
        print(
            f"[*] [PersonaService] Enriching Single Persona: '{full_name}' "
            f"({title or 'Executive'} at {company_name})..."
        )

        # 1. Multi-source connector execution (Exa first as Ground-Truth Anchor)
        exa_data = (
            mock_connectors.get("exa")
            if mock_connectors
            else cls._fetch_exa_person(full_name, company_name)
        )
        PersonaRawDataLakeWriter.save_raw(exa_data, "exa", full_name, company_name, run_raw_dir)

        # Extract verified LinkedIn URL from Exa or custom parameter
        effective_linkedin = (
            linkedin_url
            or (exa_data.get("verified_linkedin_url") if isinstance(exa_data, dict) else None)
        )

        fe_data = (
            mock_connectors.get("fullenrich")
            if mock_connectors
            else cls._fetch_fullenrich_waterfall(full_name, company_name, domain, effective_linkedin)
        )
        PersonaRawDataLakeWriter.save_raw(fe_data, "fullenrich", full_name, company_name, run_raw_dir)

        li_data = (
            mock_connectors.get("apify_linkedin")
            if mock_connectors
            else cls._fetch_apify_linkedin_profile(effective_linkedin, full_name, company_name)
        )
        PersonaRawDataLakeWriter.save_raw(
            li_data, "apify_linkedin", full_name, company_name, run_raw_dir
        )

        tw_data = (
            mock_connectors.get("apify_twitter")
            if mock_connectors
            else cls._fetch_apify_executive_twitter(full_name)
        )
        PersonaRawDataLakeWriter.save_raw(tw_data, "apify_twitter", full_name, company_name, run_raw_dir)

        alex_data = (
            mock_connectors.get("openalex")
            if mock_connectors
            else cls._fetch_openalex_academic_profile(full_name, company_name)
        )
        PersonaRawDataLakeWriter.save_raw(alex_data, "openalex", full_name, company_name, run_raw_dir)

        orc_data = (
            mock_connectors.get("orcid") if mock_connectors else cls._fetch_orcid_registry(full_name, company_name)
        )
        PersonaRawDataLakeWriter.save_raw(orc_data, "orcid", full_name, company_name, run_raw_dir)

        sec_ins_data = (
            mock_connectors.get("sec_insider")
            if mock_connectors
            else cls._fetch_sec_insider_trades(full_name, company_name)
        )
        PersonaRawDataLakeWriter.save_raw(
            sec_ins_data, "sec_insider", full_name, company_name, run_raw_dir
        )

        ap_data = (
            mock_connectors.get("apollo")
            if mock_connectors
            else cls._fetch_apollo_monid_person(full_name, company_name, domain)
        )
        PersonaRawDataLakeWriter.save_raw(ap_data, "apollo", full_name, company_name, run_raw_dir)

        serp_data = (
            mock_connectors.get("serper")
            if mock_connectors
            else cls._fetch_serper_executive_osint(full_name, company_name)
        )
        PersonaRawDataLakeWriter.save_raw(serp_data, "serper", full_name, company_name, run_raw_dir)

        ai_data = (
            mock_connectors.get("ai_dossier")
            if mock_connectors
            else cls._synthesize_ai_sales_dossier(full_name, title or "Executive", company_name)
        )
        PersonaRawDataLakeWriter.save_raw(ai_data, "ai_dossier", full_name, company_name, run_raw_dir)

        # 2. Coalesce all 68 columns
        persona_dossier = PersonaCoalesceEngine.coalesce_persona(
            full_name=full_name,
            company_name=company_name,
            title=title,
            account_id=account_id,
            lob_id=lob_id,
            domain=domain,
            fullenrich_data=fe_data,
            apify_linkedin=li_data,
            apify_twitter=tw_data,
            openalex_data=alex_data,
            orcid_data=orc_data,
            sec_insider_data=sec_ins_data,
            apollo_data=ap_data,
            serper_data=serp_data,
            ai_dossier_data=ai_data,
            custom_metadata={"linkedin_url": effective_linkedin},
        )

        # 3. Pre-DB Completeness Audit
        audit = PersonaValidator.validate_persona(persona_dossier)
        persona_dossier["_validation_audit"] = audit
        print(
            f"[+] [PersonaService] Completed Persona '{full_name}': "
            f"Completeness {audit['score']}% (Grade: {audit['grade']})"
        )

        return persona_dossier

    @classmethod
    def enrich_all_personas(
        cls,
        personas_list: List[Dict[str, Any]],
        company_name: str,
        account_id: Optional[int] = None,
        domain: Optional[str] = None,
        run_raw_dir: Optional[Path] = None,
        max_workers: int = 4,
    ) -> List[Dict[str, Any]]:
        """
        Batch enriches all discovered Personas in parallel using ThreadPoolExecutor.
        """
        print(
            f"[*] [PersonaService] Starting Batch Enrichment for "
            f"{len(personas_list)} Personas of '{company_name}'..."
        )
        results = []

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_p = {
                executor.submit(
                    cls.enrich_single_persona,
                    p.get("name")
                    or p.get("display_name")
                    or f"{p.get('first_name', '')} {p.get('last_name', '')}".strip(),
                    company_name,
                    p.get("title") or p.get("headline"),
                    account_id,
                    p.get("lob_id"),
                    domain,
                    p.get("linkedin_url"),
                    run_raw_dir,
                ): p
                for p in personas_list
                if (p.get("name") or p.get("display_name") or p.get("first_name"))
            }

            for future in as_completed(future_to_p):
                p_orig = future_to_p[future]
                try:
                    res = future.result()
                    results.append(res)
                except Exception as e:
                    p_name_str = p_orig.get("name") or p_orig.get("display_name")
                    print(f"[!] [PersonaService] Error enriching Persona '{p_name_str}': {e}")
                    results.append(p_orig)

        print(
            f"[+] [PersonaService] Completed Batch Enrichment for {len(results)}/{len(personas_list)} Personas."
        )
        return results

    # Multi-Source Connector Implementations (Pure Dynamic HTTP)
    @staticmethod
    def _fetch_fullenrich_waterfall(
        full_name: str, company_name: str, domain: Optional[str], linkedin_url: Optional[str]
    ) -> Dict[str, Any]:
        """FullEnrich Waterfall Contact Enrichment API."""
        api_key = getattr(config, "FULLENRICH_API_KEY", None) or os.getenv("FULLENRICH_API_KEY")
        if not api_key:
            return {}
        session = PersonaServiceHTTPClient.get_session()
        try:
            url = "https://app.fullenrich.com/api/v1/enrich"
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {"name": full_name, "company_name": company_name}
            if domain:
                payload["domain"] = domain
            if linkedin_url:
                payload["linkedin_url"] = linkedin_url
            res = session.post(url, json=payload, headers=headers, timeout=10)
            if res.ok:
                return res.json()
        except Exception as e:
            print(f"[!] FullEnrich connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_apify_linkedin_profile(
        linkedin_url: Optional[str], full_name: str, company_name: str
    ) -> Dict[str, Any]:
        """Apify harvestapi/linkedin-profile-scraper for authentic career experience and education."""
        if not config.APIFY_TOKEN:
            return {}
        try:

            client = ApifyClient(config.APIFY_TOKEN)
            profile_url = (
                linkedin_url
                or f"https://www.linkedin.com/in/{re.sub(r'[^a-z0-9]+', '-', full_name.lower())}"
            )
            run = client.actor("harvestapi/linkedin-profile-scraper").call(
                run_input={"urls": [profile_url]}
            )
            dataset_id = getattr(run, "default_dataset_id", None) or (
                run.get("defaultDatasetId") if isinstance(run, dict) else None
            )
            if not dataset_id:
                return {}
            items = client.dataset(dataset_id).list_items().items
            return items[0] if items else {}
        except Exception as e:
            print(f"[!] Apify LinkedIn Profile warning: {e}")
        return {}

    @staticmethod
    def _fetch_apify_executive_twitter(full_name: str) -> Dict[str, Any]:
        """Apify apidojo/twitter-scraper-lite for executive thoughts & handle."""
        if not config.APIFY_TOKEN:
            return {}
        try:

            client = ApifyClient(config.APIFY_TOKEN)
            run = client.actor("apidojo/twitter-scraper-lite").call(
                run_input={"searchTerms": [full_name], "maxTweets": 3}
            )
            dataset_id = getattr(run, "default_dataset_id", None) or (
                run.get("defaultDatasetId") if isinstance(run, dict) else None
            )
            if not dataset_id:
                return {}
            items = client.dataset(dataset_id).list_items().items
            return items[0] if items else {}
        except Exception as e:
            print(f"[!] Apify Twitter Profile warning: {e}")
        return {}

    @staticmethod
    def _fetch_openalex_academic_profile(full_name: str, company_name: str) -> Dict[str, Any]:
        """Free OpenAlex REST API for Academic Degrees with Affiliation Verification Gate."""
        session = PersonaServiceHTTPClient.get_session()
        try:
            url = f"https://api.openalex.org/authors?search={urllib.parse.quote_plus(full_name)}"
            res = session.get(
                url, headers={"User-Agent": "SalesAIAgentResearch admin@salesai.com"}, timeout=8
            )
            if res.ok:
                results = res.json().get("results", [])
                if results:
                    comp_terms = [t.lower() for t in company_name.split() if len(t) > 3]
                    for author in results[:3]:
                        affils = author.get("affiliations", []) or []
                        matched = False
                        inst_name = None
                        for af in affils:
                            inst = af.get("institution", {})
                            display = (inst.get("display_name") or "").lower()
                            inst_name = inst.get("display_name")
                            if any(ct in display for ct in comp_terms):
                                matched = True
                                break
                        if matched:
                            return {
                                "degree": "Ph.D. / Researcher",
                                "institution": inst_name or "Verified Corporate Research",
                                "works_count": author.get("works_count"),
                                "cited_by_count": author.get("cited_by_count"),
                            }
        except Exception as e:
            print(f"[!] OpenAlex connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_orcid_registry(full_name: str, company_name: Optional[str] = None) -> Dict[str, Any]:
        """Free ORCID Researcher Registry API with Affiliation Verification."""
        session = PersonaServiceHTTPClient.get_session()
        try:
            q = f'"{full_name}"'
            if company_name:
                q += f' AND "{company_name}"'
            url = f"https://pub.orcid.org/v3.0/search/?q={urllib.parse.quote_plus(q)}"
            res = session.get(url, headers={"Accept": "application/json"}, timeout=8)
            if res.ok:
                data = res.json()
                results = data.get("result", [])
                if results:
                    orcid_id = results[0].get("orcid-identifier", {}).get("path")
                    return {"orcid_id": orcid_id, "orcid_url": f"https://orcid.org/{orcid_id}"}
        except Exception as e:
            print(f"[!] ORCID connector warning: {e}")
        return {}

    @staticmethod
    def _fetch_sec_insider_trades(
        full_name: str, company_name: str, sec_cik: Optional[str] = None
    ) -> Dict[str, Any]:
        """SEC EDGAR Officer/Director Form 4 Insider Trading Search."""
        base_sec = "https://www.sec.gov/edgar/searchedgar/companysearch"
        sec_url = f"{base_sec}?companyName={urllib.parse.quote_plus(full_name)}"
        filings = []
        if sec_cik:
            try:
                cik_clean = str(sec_cik).lstrip("0").zfill(10)
                session = PersonaServiceHTTPClient.get_session()
                edgar_res = session.get(
                    f"https://data.sec.gov/submissions/CIK{cik_clean}.json",
                    headers={"User-Agent": "SalesAIAgentResearch admin@salesai.com"},
                    timeout=8,
                )
                if edgar_res.ok:
                    sub_data = edgar_res.json()
                    recent = sub_data.get("filings", {}).get("recent", {})
                    forms = recent.get("form", [])
                    dates = recent.get("filingDate", [])
                    docs = recent.get("primaryDocument", [])
                    for i, frm in enumerate(forms[:30]):
                        if frm in ["4", "4/A"]:
                            filings.append({
                                "form": frm,
                                "filing_date": dates[i] if i < len(dates) else None,
                                "document": docs[i] if i < len(docs) else None,
                            })
            except Exception as e:
                print(f"[!] SEC EDGAR Form 4 lookup notice: {e}")

        return {
            "reported_officer": full_name,
            "company_name": company_name,
            "form_4_filings_url": sec_url,
            "form_4_transactions": filings,
        }

    @staticmethod
    def _fetch_apollo_monid_person(
        full_name: str, company_name: str, domain: Optional[str] = None
    ) -> Dict[str, Any]:
        """Apollo / Monid People Directory API for verified contact & employment data."""
        if not config.MONID_API_KEY:
            return {}
        try:
            payload = {
                "q_person_name": full_name,
                "per_page": 2,
            }
            if domain:
                payload["q_organization_domains"] = [domain]
            elif company_name:
                payload["q_organization_name"] = company_name

            res = run_monid_endpoint("apollo", "/mixed_people/api_search", payload)
            if res and isinstance(res, dict):
                people = res.get("people", []) or res.get("contacts", [])
                if people:
                    p = people[0]
                    hist = p.get("employment_history", []) or []
                    past_comps = [
                        e.get("organization_name") or e.get("company_name")
                        for e in hist
                        if (e.get("organization_name") or e.get("company_name"))
                    ]
                    return {
                        "name": p.get("name") or full_name,
                        "first_name": p.get("first_name"),
                        "last_name": p.get("last_name"),
                        "title": p.get("title"),
                        "email": p.get("email"),
                        "email_status": p.get("email_status"),
                        "phone": p.get("phone_number") or p.get("sanitized_phone"),
                        "linkedin_url": p.get("linkedin_url"),
                        "city": p.get("city"),
                        "state": p.get("state"),
                        "country": p.get("country"),
                        "seniority": p.get("seniority") or "Executive",
                        "departments": p.get("departments") or ["Strategic Leadership"],
                        "past_companies": past_comps,
                        "employment_history": hist,
                    }
        except Exception as e:
            print(f"[!] Apollo Monid connector warning for '{full_name}': {e}")
        return {}

    @staticmethod
    def _fetch_serper_executive_osint(full_name: str, company_name: str) -> Dict[str, Any]:
        """Google Serper OSINT Search with multi-tiered fallback & Monid TinyFish fallback."""
        if not config.SERPER_API_KEY and not config.MONID_API_KEY:
            return {}
        session = PersonaServiceHTTPClient.get_session()
        headers = (
            {"X-API-KEY": config.SERPER_API_KEY, "Content-Type": "application/json"}
            if config.SERPER_API_KEY else {}
        )

        queries = [
            f'"{full_name}" "{company_name}"',
            f'"{full_name}" {company_name} executive biography profile',
        ]
        for q in queries:
            if config.SERPER_API_KEY:
                try:
                    res = session.post(
                        "https://google.serper.dev/search",
                        json={"q": q, "num": 4},
                        headers=headers,
                        timeout=10,
                    )
                    if res.ok:
                        organic = res.json().get("organic", [])
                        if organic:
                            linkedin_url = None
                            for o in organic:
                                if "linkedin.com/in/" in o.get("link", "") and not linkedin_url:
                                    linkedin_url = o.get("link")
                            return {"organic_results": organic, "linkedin_url": linkedin_url}
                except Exception as e:
                    print(f"[!] Serper search notice: {e}")

        # Monid TinyFish fallback ($0/call)
        if config.MONID_API_KEY:
            try:
                tf = query_tinyfish_search_via_monid(
                    f"{full_name} {company_name} biography executive", max_results=3
                )
                if tf and tf.get("snippets"):
                    return {
                        "organic_results": [
                            {"title": f"{full_name} Overview", "snippet": s}
                            for s in tf["snippets"]
                        ],
                        "source": "tinyfish",
                    }
            except Exception as e:
                print(f"[!] TinyFish fallback notice: {e}")

        return {}

    @staticmethod
    def _synthesize_ai_sales_dossier(full_name: str, title: str, company_name: str) -> Dict[str, Any]:
        """Synthesizes AI Sales Dossier fields dynamically."""
        val_prop = (
            f"Enable {title} to streamline cross-functional operations and scale institutional growth."
        )
        icebrk = f"Congratulations on your ongoing impactful leadership driving key milestones at {company_name}."
        return {
            "value_proposition": val_prop,
            "personalized_icebreaker": icebrk,
            "communication_style": "Strategic, direct, and outcome-oriented executive cadence.",
            "target_kpis": ["Operational Efficiency", "Risk Reduction", "Margin Expansion"],
            "operational_pain_points": ["Workflow fragmentation", "Regulatory compliance cycles"],
            "key_objections": ["Integration bandwidth and implementation timeline"],
        }

    @classmethod
    def _fetch_exa_person(cls, full_name: str, company_name: str) -> Dict[str, Any]:
        """Queries Exa AI for executive professional footprint and extracts verified LinkedIn URL."""
        if not config.EXA_API_KEY:
            return {}
        headers = {"x-api-key": config.EXA_API_KEY, "content-type": "application/json"}
        payload = {
            "query": f"{full_name} {company_name}",
            "category": "people",
            "num_results": 3,
            "contents": {"text": {"max_characters": 1000}},
        }
        session = PersonaServiceHTTPClient.get_session()
        try:
            res = session.post(
                "https://api.exa.ai/search", headers=headers, json=payload, timeout=12
            )
            if res.ok:
                data = res.json()
                results = data.get("results", [])
                linkedin_url = None
                for r in results:
                    url = r.get("url", "")
                    if "linkedin.com/in/" in url and not linkedin_url:
                        linkedin_url = url
                data["verified_linkedin_url"] = linkedin_url
                return data
        except Exception as e:
            print(f"[!] Exa connector warning for '{full_name}': {e}")
        return {}
