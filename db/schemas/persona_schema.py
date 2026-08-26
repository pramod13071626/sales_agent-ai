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

    model_config = {"from_attributes": True}

    @classmethod
    def from_enriched_json(cls, person: dict, tree_info: dict = None) -> "PersonaSchema":
        """Factory: builds PersonaSchema from a single person entry + optional tree metadata."""
        rpd = person.get("required_person_data", {}) or {}
        dossier = person.get("persona_dossier") or {}
        l1 = dossier.get("level_1_demographics", {}) or {}
        l2 = dossier.get("level_2_behavior_and_kpis", {}) or {}
        l3 = dossier.get("level_3_personal_touch", {}) or {}
        social = l3.get("social_media", {}) or {}
        tree = tree_info or {}

        return cls(
            external_id=person.get("id"),
            key=rpd.get("key") or (person.get("name", "").lower().replace(" ", "_")),
            display_name=rpd.get("display_name"),
            full_name=person.get("name"),
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
            hierarchy_level=tree.get("hierarchy_level"),
            decision_authority=tree.get("decision_authority"),
            budget_authority=tree.get("budget_authority"),
            raw_data=person.get("raw_data") or person,
            twitter_handle=rpd.get("twitter_handle"),
            twitter_live_url=rpd.get("twitter_live_url"),
            reddit_query=rpd.get("reddit_query"),
            reddit_rss_url=rpd.get("reddit_rss_url"),
            sec_cik=rpd.get("sec_cik"),
            sec_insider_trades_url=rpd.get("sec_insider_trades_url"),
            news_query=rpd.get("news_query"),
            rss_url=rpd.get("rss_url"),
            patents_query=rpd.get("patents_query"),
            google_patents_url=rpd.get("google_patents_url"),
            google_scholar_url=rpd.get("google_scholar_url"),
            openalex_author_url=rpd.get("openalex_author_url"),
            orcid_search_url=rpd.get("orcid_search_url"),
            wikidata_person_url=rpd.get("wikidata_person_url"),
            youtube_interviews_url=rpd.get("youtube_interviews_url"),
            podcast_search_url=rpd.get("podcast_search_url"),
            google_trends_url=rpd.get("google_trends_url"),
            youtube_channel_id=rpd.get("youtube_channel_id"),
            degree=l1.get("degree"),
            institution=l1.get("institution"),
            prior_company=l1.get("prior_company"),
            communication_style=l3.get("communication_style"),
            engagement_rate=l3.get("engagement_rate"),
            value_proposition=l3.get("value_proposition"),
            personalized_icebreaker=l3.get("personalized_icebreaker") or (dossier.get("conversation_icebreakers") or [None])[0],
            social_platform=social.get("platform"),
            social_profile_url=social.get("profile_url"),
            social_presence_level=social.get("presence_level"),
            skills=[s for s in (l1.get("skills") or dossier.get("technology_priorities") or []) if s],
            target_kpis=[k for k in (l2.get("target_kpis") or dossier.get("strategic_kpis") or []) if k],
            operational_pain_points=[p for p in (l2.get("operational_pain_points") or dossier.get("pain_points") or []) if p],
            key_objections=[o for o in (l3.get("key_objections") or []) if o],
        )
