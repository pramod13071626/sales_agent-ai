from typing import Optional, List, Dict, Any
from pydantic import BaseModel, HttpUrl, Field

class FetchRequest(BaseModel):
    key: str
    display_name: str
    linkedin_url: Optional[str] = None
    twitter_handle: Optional[str] = None
    reddit_query: Optional[str] = None
    sec_cik: Optional[str] = None
    news_query: Optional[str] = None
    patents_query: Optional[str] = None
    youtube_channel_id: Optional[str] = None
    rss_url: Optional[str] = None
    account_id: int
    enrich_ai_dossier: bool = True

class RequiredPersonData(BaseModel):
    key: str
    display_name: str
    linkedin_url: Optional[str] = None
    twitter_live_url: Optional[str] = None
    reddit_rss_url: Optional[str] = None
    rss_url: Optional[str] = None
    google_patents_url: Optional[str] = None
    google_scholar_url: Optional[str] = None
    openalex_author_url: Optional[str] = None
    orcid_search_url: Optional[str] = None
    wikidata_person_url: Optional[str] = None
    youtube_interviews_url: Optional[str] = None
    podcast_search_url: Optional[str] = None
    google_trends_url: Optional[str] = None

class PersonaDossier(BaseModel):
    level_1_demographics: Dict[str, Any] = Field(default_factory=dict)
    level_2_behavior_and_kpis: Dict[str, Any] = Field(default_factory=dict)
    level_3_personal_touch: Dict[str, Any] = Field(default_factory=dict)

class EnrichedPersona(BaseModel):
    key: str
    display_name: str
    name: str
    first_name: str
    last_name: str
    title: str
    tier: str
    linkedin_url: Optional[str] = None
    required_person_data: RequiredPersonData
    persona_dossier: PersonaDossier

class DumpRequest(BaseModel):
    account_id: int
    person_data: EnrichedPersona

def validate_persona(person: EnrichedPersona) -> Dict[str, Any]:
    score = 0.0
    warnings = []
    
    # 1. Base identity (20 points)
    if person.name and person.title:
        score += 20.0
    else:
        warnings.append("Missing core identity (name/title).")

    # 2. LinkedIn verification (30 points)
    has_verified_linkedin = bool(person.linkedin_url)
    if has_verified_linkedin:
        score += 30.0
    else:
        warnings.append("No verified LinkedIn URL provided.")

    # 3. Scraping URLs (up to 20 points)
    url_fields = [
        "twitter_live_url", "reddit_rss_url", "rss_url", "google_patents_url", 
        "google_scholar_url", "openalex_author_url", "orcid_search_url", 
        "wikidata_person_url", "youtube_interviews_url", "podcast_search_url", 
        "google_trends_url"
    ]
    valid_urls = 0
    urls_dict = person.required_person_data.model_dump()
    for field in url_fields:
        if urls_dict.get(field):
            valid_urls += 1
            
    total_urls = len(url_fields)
    url_score = (valid_urls / total_urls) * 20.0
    score += url_score
    if valid_urls < 5:
        warnings.append(f"Low number of scraping URLs generated ({valid_urls}/{total_urls}).")

    # 4. AI Dossier Completeness (30 points)
    has_ai_dossier = False
    dossier = person.persona_dossier
    l1 = len(dossier.level_1_demographics) > 0
    l2 = len(dossier.level_2_behavior_and_kpis) > 0
    l3 = len(dossier.level_3_personal_touch) > 0
    
    if l1 and l2 and l3:
        has_ai_dossier = True
        score += 30.0
    else:
        if not l1: warnings.append("Missing demographics in AI dossier.")
        if not l2: warnings.append("Missing KPIs in AI dossier.")
        if not l3: warnings.append("Missing personal touch data in AI dossier.")
        
    return {
        "status": "validated",
        "score": round(score, 1),
        "person_name": person.name,
        "has_verified_linkedin": has_verified_linkedin,
        "has_ai_dossier": has_ai_dossier,
        "valid_scraping_urls_count": f"{valid_urls}/{total_urls}",
        "warnings": warnings,
        "ready_for_db": score >= 60.0  # Threshold for acceptance
    }
