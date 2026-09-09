import datetime
import urllib.parse
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class PersonaSchema(BaseModel):
    id: Optional[int] = None
    account_id: Optional[int] = None
    lob_id: Optional[int] = None
    key: str
    display_name: str
    full_name: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    title: Optional[str] = None
    tier: Optional[str] = None
    seniority_raw: Optional[str] = None
    departments: Optional[List[str]] = None
    email: Optional[str] = None
    email_status: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    crunchbase_permalink: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    source: Optional[str] = None
    hierarchy_level: Optional[int] = None
    decision_authority: Optional[str] = None
    budget_authority: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None
    twitter_handle: Optional[str] = None
    twitter_live_url: Optional[str] = None
    reddit_query: Optional[str] = None
    reddit_rss_url: Optional[str] = None
    sec_cik: Optional[str] = None
    sec_insider_trades_url: Optional[str] = None
    news_query: Optional[str] = None
    rss_url: Optional[str] = None
    patents_query: Optional[str] = None
    google_patents_url: Optional[str] = None
    google_scholar_url: Optional[str] = None
    openalex_author_url: Optional[str] = None
    orcid_search_url: Optional[str] = None
    wikidata_person_url: Optional[str] = None
    youtube_interviews_url: Optional[str] = None
    podcast_search_url: Optional[str] = None
    google_trends_url: Optional[str] = None
    youtube_channel_id: Optional[str] = None
    degree: Optional[str] = None
    institution: Optional[str] = None
    prior_company: Optional[str] = None
    communication_style: Optional[str] = None
    engagement_rate: Optional[str] = None
    value_proposition: Optional[str] = None
    personalized_icebreaker: Optional[str] = None
    social_platform: Optional[str] = None
    social_profile_url: Optional[str] = None
    social_presence_level: Optional[str] = None
    skills: Optional[List[str]] = None
    target_kpis: Optional[List[str]] = None
    operational_pain_points: Optional[List[str]] = None
    key_objections: Optional[List[str]] = None
    employment_history: Optional[List[Dict[str, Any]]] = None
    past_companies: Optional[List[str]] = None
    previous_titles: Optional[List[str]] = None
    current_role_tenure_months: Optional[int] = None
    is_new_in_role: Optional[bool] = None
    career_trajectory_score: Optional[float] = None
    headline: Optional[str] = None
    education_history: Optional[List[Dict[str, Any]]] = None
    personal_email: Optional[str] = None
    direct_mobile_phone: Optional[str] = None
    osint_feed_manifest: Optional[Dict[str, Any]] = None

    @classmethod
    def from_enriched_json(cls, person: Dict[str, Any]) -> "PersonaSchema":
        raw = person.get("raw_data") or {}
        rpd = person.get("required_person_data") or {}
        dossier = (
            person.get("ai_dossier")
            or raw.get("ai_dossier")
            or raw.get("sales_dossier")
            or {}
        )
        l1 = (
            person.get("level_1_intelligence")
            or raw.get("level_1_intelligence")
            or {}
        )
        l2 = (
            person.get("level_2_strategic_priorities")
            or raw.get("level_2_strategic_priorities")
            or {}
        )
        l3 = (
            person.get("level_3_actionable_signals")
            or raw.get("level_3_actionable_signals")
            or {}
        )

        emp_hist = (
            person.get("employment_history")
            or raw.get("employment_history")
            or []
        )
        if isinstance(emp_hist, dict):
            emp_hist = [emp_hist]
        elif not isinstance(emp_hist, list):
            emp_hist = []

        past_comps = person.get("past_companies") or [
            e.get("company") or e.get("company_name") or e.get("organization_name")
            for e in emp_hist
            if isinstance(e, dict) and (
                e.get("company") or e.get("company_name") or e.get("organization_name")
            )
        ]

        prev_titles = person.get("previous_titles") or [
            e.get("title") or e.get("role")
            for e in emp_hist
            if isinstance(e, dict) and (e.get("title") or e.get("role"))
        ]

        edu_hist = (
            person.get("education_history")
            or raw.get("education_history")
            or []
        )
        if isinstance(edu_hist, dict):
            edu_hist = [edu_hist]
        elif not isinstance(edu_hist, list):
            edu_hist = []

        fname = person.get("first_name") or raw.get("first_name") or ""
        lname = person.get("last_name") or raw.get("last_name") or ""
        fullname = (
            person.get("full_name")
            or person.get("name")
            or f"{fname} {lname}".strip()
            or "Executive Contact"
        )
        qname = urllib.parse.quote_plus(fullname)

        osint_manifest = person.get("osint_feed_manifest")
        if not osint_manifest or not isinstance(osint_manifest, dict):
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            osint_manifest = {
                "key": person.get("key"),
                "display_name": fullname,
                "generated_at": now_iso,
                "status": "active",
                "feeds": {
                    "linkedin_url": (
                        person.get("linkedin_url")
                        or rpd.get("linkedin_url")
                    ),
                    "twitter_live_url": (
                        person.get("twitter_live_url")
                        or rpd.get("twitter_live_url")
                        or f"https://x.com/search?q=%22{qname}%22&f=live"
                    ),
                    "reddit_rss_url": (
                        person.get("reddit_rss_url")
                        or rpd.get("reddit_rss_url")
                        or f"https://www.reddit.com/search.rss?q=%22{qname}%22&sort=new"
                    ),
                    "sec_insider_trades_url": (
                        person.get("sec_insider_trades_url")
                        or rpd.get("sec_insider_trades_url")
                    ),
                    "rss_url": person.get("rss_url") or rpd.get("rss_url"),
                    "google_patents_url": (
                        person.get("google_patents_url")
                        or rpd.get("google_patents_url")
                        or f"https://patents.google.com/?inventor={qname}&sort=new"
                    ),
                    "google_scholar_url": (
                        person.get("google_scholar_url")
                        or rpd.get("google_scholar_url")
                    ),
                    "openalex_author_url": (
                        person.get("openalex_author_url")
                        or rpd.get("openalex_author_url")
                    ),
                    "orcid_search_url": (
                        person.get("orcid_search_url")
                        or rpd.get("orcid_search_url")
                    ),
                    "wikidata_person_url": (
                        person.get("wikidata_person_url")
                        or rpd.get("wikidata_person_url")
                    ),
                    "youtube_interviews_url": (
                        person.get("youtube_interviews_url")
                        or rpd.get("youtube_interviews_url")
                    ),
                    "podcast_search_url": (
                        person.get("podcast_search_url")
                        or rpd.get("podcast_search_url")
                    ),
                    "google_trends_url": (
                        person.get("google_trends_url")
                        or rpd.get("google_trends_url")
                    ),
                }
            }

        return cls(
            id=person.get("id"),
            account_id=person.get("account_id"),
            lob_id=person.get("lob_id"),
            key=person.get("key") or fullname.lower().replace(" ", "_"),
            display_name=person.get("display_name") or f"{fullname} ({person.get('title') or 'Executive'})",
            full_name=fullname,
            first_name=fname or None,
            last_name=lname or None,
            title=person.get("title") or raw.get("title") or "Executive",
            tier=person.get("tier") or "tier3_functional_leads",
            seniority_raw=person.get("seniority_raw") or person.get("seniority"),
            departments=(
                person.get("departments")
                or ([person.get("department")] if person.get("department") else None)
            ),
            email=person.get("email") or raw.get("email"),
            email_status=person.get("email_status") or raw.get("email_status"),
            phone=person.get("phone") or raw.get("phone"),
            linkedin_url=person.get("linkedin_url") or rpd.get("linkedin_url"),
            crunchbase_permalink=person.get("crunchbase_permalink"),
            city=person.get("city") or raw.get("city"),
            state=person.get("state") or raw.get("state"),
            country=person.get("country") or raw.get("country"),
            source=person.get("source") or "apollo",
            hierarchy_level=person.get("hierarchy_level") or 3,
            decision_authority=person.get("decision_authority") or l1.get("decision_authority"),
            budget_authority=person.get("budget_authority") or l1.get("budget_authority"),
            raw_data=person.get("raw_data") or person,
            twitter_handle=person.get("twitter_handle") or rpd.get("twitter_handle"),
            twitter_live_url=person.get("twitter_live_url") or rpd.get("twitter_live_url"),
            reddit_query=person.get("reddit_query") or rpd.get("reddit_query"),
            reddit_rss_url=person.get("reddit_rss_url") or rpd.get("reddit_rss_url"),
            sec_cik=person.get("sec_cik") or rpd.get("sec_cik"),
            sec_insider_trades_url=person.get("sec_insider_trades_url") or rpd.get("sec_insider_trades_url"),
            news_query=person.get("news_query") or rpd.get("news_query"),
            rss_url=person.get("rss_url") or rpd.get("rss_url"),
            patents_query=person.get("patents_query") or rpd.get("patents_query"),
            google_patents_url=person.get("google_patents_url") or rpd.get("google_patents_url"),
            google_scholar_url=person.get("google_scholar_url") or rpd.get("google_scholar_url"),
            openalex_author_url=person.get("openalex_author_url") or rpd.get("openalex_author_url"),
            orcid_search_url=person.get("orcid_search_url") or rpd.get("orcid_search_url"),
            wikidata_person_url=person.get("wikidata_person_url") or rpd.get("wikidata_person_url"),
            youtube_interviews_url=person.get("youtube_interviews_url") or rpd.get("youtube_interviews_url"),
            podcast_search_url=person.get("podcast_search_url") or rpd.get("podcast_search_url"),
            google_trends_url=person.get("google_trends_url") or rpd.get("google_trends_url"),
            youtube_channel_id=person.get("youtube_channel_id") or rpd.get("youtube_channel_id"),
            degree=person.get("degree") or l1.get("degree") or raw.get("degree"),
            institution=person.get("institution") or l1.get("institution") or raw.get("institution"),
            prior_company=person.get("prior_company") or l1.get("prior_company"),
            communication_style=person.get("communication_style") or l3.get("communication_style"),
            engagement_rate=(
                str(person.get("engagement_rate"))
                if person.get("engagement_rate") is not None
                else l3.get("engagement_rate")
            ),
            value_proposition=person.get("value_proposition") or l3.get("value_proposition"),
            personalized_icebreaker=(
                person.get("personalized_icebreaker")
                or l3.get("personalized_icebreaker")
                or (dossier.get("conversation_icebreakers") or [None])[0]
            ),
            social_platform=person.get("social_platform") or l3.get("social_platform"),
            social_profile_url=person.get("social_profile_url") or l3.get("social_profile_url"),
            social_presence_level=person.get("social_presence_level") or l3.get("social_presence_level"),
            skills=[
                (s.get("name") if isinstance(s, dict) else str(s)).strip()
                for s in (
                    person.get("skills")
                    or l1.get("skills")
                    or dossier.get("technology_priorities")
                    or []
                )
                if (s.get("name") if isinstance(s, dict) else str(s)).strip()
            ],
            target_kpis=[
                (k.get("name") if isinstance(k, dict) else str(k)).strip()
                for k in (
                    person.get("target_kpis")
                    or l2.get("target_kpis")
                    or dossier.get("strategic_kpis")
                    or []
                )
                if (k.get("name") if isinstance(k, dict) else str(k)).strip()
            ],
            operational_pain_points=[
                (p.get("name") if isinstance(p, dict) else str(p)).strip()
                for p in (
                    person.get("operational_pain_points")
                    or l2.get("operational_pain_points")
                    or dossier.get("pain_points")
                    or []
                )
                if (p.get("name") if isinstance(p, dict) else str(p)).strip()
            ],
            key_objections=[
                (o.get("name") if isinstance(o, dict) else str(o)).strip()
                for o in (person.get("key_objections") or l3.get("key_objections") or [])
                if (o.get("name") if isinstance(o, dict) else str(o)).strip()
            ],
            employment_history=emp_hist if emp_hist else None,
            past_companies=[
                (c.get("company") or c.get("name") if isinstance(c, dict) else str(c)).strip()
                for c in past_comps
                if (c.get("company") or c.get("name") if isinstance(c, dict) else str(c)).strip()
            ] if isinstance(past_comps, list) else [],
            previous_titles=[
                (t.get("title") or t.get("name") if isinstance(t, dict) else str(t)).strip()
                for t in prev_titles
                if (t.get("title") or t.get("name") if isinstance(t, dict) else str(t)).strip()
            ] if isinstance(prev_titles, list) else [],
            current_role_tenure_months=(
                person.get("current_role_tenure_months")
                if person.get("current_role_tenure_months") is not None
                else l1.get("current_role_tenure_months")
            ),
            is_new_in_role=person.get("is_new_in_role"),
            career_trajectory_score=person.get("career_trajectory_score"),
            headline=person.get("headline") or person.get("title"),
            education_history=edu_hist if edu_hist else None,
            personal_email=person.get("personal_email") or raw.get("personal_email"),
            direct_mobile_phone=(
                person.get("direct_mobile_phone")
                or raw.get("direct_mobile_phone")
                or person.get("phone")
            ),
            osint_feed_manifest=osint_manifest
        )
