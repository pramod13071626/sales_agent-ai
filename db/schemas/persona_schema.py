"""Persona Pydantic Schema — Validates and extracts all 58 persona fields from raw JSON."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class PersonaSchema(BaseModel):
    """Validates and maps enriched JSON person → Persona ORM fields."""

    # Person Identity
    external_id: Optional[str] = None
    key: str
    display_name: Optional[str] = None
    full_name: Optional[str] = None
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

    # Person Scraping URLs
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

    # Persona Dossier
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

    # Array Fields
    skills: List[str] = []
    target_kpis: List[str] = []
    operational_pain_points: List[str] = []
    key_objections: List[str] = []

    # Career Employment History & Personal Intelligence (FullEnrich Waterfall)
    headline: Optional[str] = None
    employment_history: Optional[List[Dict[str, Any]]] = None
    past_companies: List[str] = []
    previous_titles: List[str] = []
    current_role_tenure_months: Optional[int] = None
    is_new_in_role: Optional[bool] = False
    career_trajectory_score: Optional[float] = None
    education_history: Optional[List[Dict[str, Any]]] = None
    personal_email: Optional[str] = None
    direct_mobile_phone: Optional[str] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_enriched_json(cls, person: dict, tree_info: dict = None) -> "PersonaSchema":
        """Factory: dynamically builds PersonaSchema from a single person entry + optional tree metadata."""
        rpd = person.get("required_person_data", {}) or {}
        dossier = person.get("persona_dossier") or {}
        l1 = dossier.get("level_1_demographics", {}) or {}
        l2 = dossier.get("level_2_behavior_and_kpis", {}) or {}
        l3 = dossier.get("level_3_personal_touch", {}) or {}
        social = l3.get("social_media", {}) or {}
        tree = tree_info or {}
        raw = person.get("raw_data") or person or {}

        # Dynamic Career & Employment Extraction
        emp_hist = person.get("employment_history") or raw.get("employment_history") or raw.get("experience") or []
        past_comps = person.get("past_companies") or [e.get("company") or e.get("company_name") or e.get("organization_name") for e in emp_hist if isinstance(e, dict) and (e.get("company") or e.get("company_name") or e.get("organization_name"))]
        if not past_comps and l1.get("prior_company"):
            past_comps = [l1.get("prior_company")]

        prev_titles = person.get("previous_titles") or [e.get("title") or e.get("role") for e in emp_hist if isinstance(e, dict) and (e.get("title") or e.get("role"))]
        
        tenure = person.get("current_role_tenure_months")
        is_new = person.get("is_new_in_role") or (tenure is not None and tenure <= 6)
        
        edu_hist = person.get("education_history") or raw.get("education_history") or raw.get("education") or []

        resolved_name = (
            person.get("full_name")
            or person.get("name")
            or person.get("display_name")
            or rpd.get("display_name")
            or ""
        )
        resolved_key = (
            person.get("key")
            or rpd.get("key")
            or (resolved_name.lower().replace(" ", "_") if resolved_name else None)
            or f"persona_{person.get('id', 'unknown')}"
        )

        return cls(
            external_id=str(person.get("id")) if person.get("id") is not None else None,
            key=resolved_key,
            display_name=rpd.get("display_name") or person.get("display_name") or resolved_name,
            full_name=resolved_name or person.get("name"),
            first_name=person.get("first_name"),
            last_name=person.get("last_name"),
            title=person.get("title"),
            tier=person.get("tier"),
            seniority_raw=person.get("seniority_raw"),
            departments=person.get("departments"),
            email=person.get("email") or person.get("verified_email"),
            email_status=person.get("email_status"),
            phone=person.get("phone") or person.get("direct_phone"),
            linkedin_url=person.get("linkedin_url"),
            crunchbase_permalink=person.get("crunchbase_permalink"),
            city=person.get("city"),
            state=person.get("state"),
            country=person.get("country"),
            source=person.get("source"),
            hierarchy_level=person.get("hierarchy_level") or tree.get("hierarchy_level"),
            decision_authority=person.get("decision_authority") or tree.get("decision_authority"),
            budget_authority=person.get("budget_authority") or tree.get("budget_authority"),
            raw_data=raw,
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
            degree=person.get("degree") or l1.get("degree"),
            institution=person.get("institution") or l1.get("institution"),
            prior_company=person.get("prior_company") or l1.get("prior_company"),
            communication_style=person.get("communication_style") or l3.get("communication_style"),
            engagement_rate=str(person.get("engagement_rate")) if person.get("engagement_rate") is not None else l3.get("engagement_rate"),
            value_proposition=person.get("value_proposition") or l3.get("value_proposition"),
            personalized_icebreaker=person.get("personalized_icebreaker") or l3.get("personalized_icebreaker") or (dossier.get("conversation_icebreakers") or [None])[0],
            social_platform=person.get("social_platform") or social.get("platform"),
            social_profile_url=person.get("social_profile_url") or social.get("profile_url"),
            social_presence_level=person.get("social_presence_level") or social.get("presence_level"),
            skills=[(s.get("name") if isinstance(s, dict) else str(s)).strip() for s in (person.get("skills") or l1.get("skills") or dossier.get("technology_priorities") or []) if (s.get("name") if isinstance(s, dict) else str(s)).strip()],
            target_kpis=[(k.get("name") if isinstance(k, dict) else str(k)).strip() for k in (person.get("target_kpis") or l2.get("target_kpis") or dossier.get("strategic_kpis") or []) if (k.get("name") if isinstance(k, dict) else str(k)).strip()],
            operational_pain_points=[(p.get("name") if isinstance(p, dict) else str(p)).strip() for p in (person.get("operational_pain_points") or l2.get("operational_pain_points") or dossier.get("pain_points") or []) if (p.get("name") if isinstance(p, dict) else str(p)).strip()],
            key_objections=[(o.get("name") if isinstance(o, dict) else str(o)).strip() for o in (person.get("key_objections") or l3.get("key_objections") or []) if (o.get("name") if isinstance(o, dict) else str(o)).strip()],
            headline=person.get("headline") or raw.get("headline") or person.get("title"),
            employment_history=emp_hist if isinstance(emp_hist, list) else None,
            past_companies=[(c.get("company") or c.get("name") if isinstance(c, dict) else str(c)).strip() for c in past_comps if (c.get("company") or c.get("name") if isinstance(c, dict) else str(c)).strip()] if isinstance(past_comps, list) else [],
            previous_titles=[(t.get("title") or t.get("name") if isinstance(t, dict) else str(t)).strip() for t in prev_titles if (t.get("title") or t.get("name") if isinstance(t, dict) else str(t)).strip()] if isinstance(prev_titles, list) else [],
            current_role_tenure_months=tenure,
            is_new_in_role=is_new,
            career_trajectory_score=person.get("career_trajectory_score"),
            education_history=edu_hist if isinstance(edu_hist, list) else None,
            personal_email=person.get("personal_email") or raw.get("personal_email"),
            direct_mobile_phone=person.get("direct_mobile_phone") or raw.get("direct_mobile_phone") or person.get("phone")
        )
