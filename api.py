import sys
from pathlib import Path
from fastapi import FastAPI, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload

# Ensure the pipeline root is on the path so db modules can be imported
PIPELINE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE_ROOT))

import urllib.parse
from db.connection import get_session
from db.models.account import Account
from db.models.lob import Lob
from db.models.sub_lob import SubLob
from db.models.persona import Persona
from validator import FetchRequest, EnrichedPersona, DumpRequest, validate_persona

app = FastAPI(title="Sales AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/accounts")
def get_accounts(db: Session = Depends(get_session)):
    try:
        # Fetch accounts eagerly loading lobs, sublobs, and personas
        accounts = (
            db.query(Account)
            .options(
                joinedload(Account.lobs).joinedload(Lob.sub_lobs),
                joinedload(Account.personas)
            )
            .all()
        )
        
        # Fetch all personas with their full fields from DB
        all_personas = db.query(Persona).all()
        all_personas_data = []
        
        for p in all_personas:
            p_data = {
                "id": p.id,
                "account_id": p.account_id,
                "lob_id": p.lob_id,
                "key": p.key or (p.full_name or p.display_name or f"persona_{p.id}").lower().replace(" ", "_"),
                "name": p.full_name or p.display_name or "Unknown Persona",
                "display_name": p.display_name or p.full_name or "Unknown Persona",
                "first_name": p.first_name or "",
                "last_name": p.last_name or "",
                "title": p.title or "Executive",
                "tier": p.tier or "Target",
                "seniority": p.seniority_raw or "",
                "departments": p.departments or [],
                "email": p.email or "",
                "email_status": p.email_status or "",
                "phone": p.phone or "",
                "linkedin_url": p.linkedin_url or "",
                "city": p.city or "",
                "state": p.state or "",
                "country": p.country or "",
                "location": ", ".join(filter(None, [p.city, p.state, p.country])) or "",
                "hierarchy_level": p.hierarchy_level or 1,
                "decision_authority": p.decision_authority or "",
                "budget_authority": p.budget_authority or "",
                "degree": p.degree or "",
                "institution": p.institution or "",
                "prior_company": p.prior_company or "",
                "communication_style": p.communication_style or "",
                "value_proposition": p.value_proposition or "",
                "personalized_icebreaker": p.personalized_icebreaker or "",
                "engagement_rate": p.engagement_rate or "",
                "social_platform": p.social_platform or "",
                "social_presence_level": p.social_presence_level or "",
                "skills": p.skills or [],
                "target_kpis": p.target_kpis or [],
                "operational_pain_points": p.operational_pain_points or [],
                "key_objections": p.key_objections or [],
                "twitter_handle": p.twitter_handle or "",
                "twitter_live_url": p.twitter_live_url or "",
                "reddit_rss_url": p.reddit_rss_url or "",
                "rss_url": p.rss_url or "",
                "google_patents_url": p.google_patents_url or "",
                "google_scholar_url": p.google_scholar_url or "",
                "openalex_author_url": p.openalex_author_url or "",
                "orcid_search_url": p.orcid_search_url or "",
                "wikidata_person_url": p.wikidata_person_url or "",
                "youtube_interviews_url": p.youtube_interviews_url or "",
                "podcast_search_url": p.podcast_search_url or "",
                "google_trends_url": p.google_trends_url or "",
                "raw_data": p.raw_data or {}
            }
            all_personas_data.append(p_data)

        result = []
        for acct in accounts:
            # Personas for this account
            acct_personas = [p for p in all_personas_data if p.get("account_id") == acct.id]
            if not acct_personas and len(accounts) == 1:
                acct_personas = all_personas_data

            lobs_list = []
            lobs_raw = list(acct.lobs)
            has_corp = any("corp" in (l.lob_name or "").lower() for l in lobs_raw)
            
            # 1. Add Corporate / Executive LOB if not explicitly in LOBs
            if not has_corp:
                lobs_list.append({
                    "id": f"corp_{acct.id}",
                    "name": "Corporate / Executive",
                    "desc": "Account-level executive leadership, board members, and corporate management.",
                    "overview": acct.short_description or acct.full_description or "Corporate Executive Team",
                    "domain": acct.primary_domain or acct.domain or "",
                    "website_url": acct.website_url or "",
                    "crunchbase_url": acct.crunchbase_url or "",
                    "revenue": acct.estimated_revenue_range or "",
                    "headcount": acct.employee_count_range or "",
                    "operating_head": "Executive Board",
                    "relationship_type": "Headquarters",
                    "subLobs": [],
                    "personas": []
                })

            # 2. Add all account LOBs
            for lob in lobs_raw:
                sublobs_data = []
                for sub in lob.sub_lobs:
                    sublobs_data.append({
                        "id": sub.id,
                        "name": sub.name,
                        "desc": sub.metadata_.get("description", "") if sub.metadata_ else "Sub-division",
                        "personas": []
                    })
                
                lobs_list.append({
                    "id": lob.id,
                    "name": lob.lob_name or "Business Division",
                    "desc": lob.overview or "Business Division overview and operations.",
                    "overview": lob.overview or "",
                    "domain": lob.domain or "",
                    "website_url": lob.website_url or "",
                    "crunchbase_url": lob.crunchbase_url or "",
                    "revenue": lob.audited_segment_revenue or "",
                    "operating_head": lob.operating_head or "",
                    "headcount": lob.segment_headcount or "",
                    "relationship_type": lob.relationship_type or "Division",
                    "google_news_rss_url": lob.google_news_rss_url or "",
                    "reddit_rss_url": lob.reddit_rss_url or "",
                    "google_patents_url": lob.google_patents_url or "",
                    "google_trends_url": lob.google_trends_url or "",
                    "youtube_search_url": lob.youtube_search_url or "",
                    "subLobs": sublobs_data,
                    "personas": []
                })

            # 3. Evenly distribute the hierarchy across all LOBs
            num_lobs = len(lobs_list)
            if num_lobs > 0 and acct_personas:
                for idx, p in enumerate(acct_personas):
                    # Round-robin distribution so every LOB gets an equal share of personas
                    target_idx = idx % num_lobs
                    lobs_list[target_idx]["personas"].append(p)

            result.append({
                "id": acct.id,
                "name": acct.display_name or acct.legal_name or f"Account #{acct.id}",
                "ticker": acct.stock_symbol or acct.sec_cik or "",
                "revenue": acct.estimated_revenue_range or "",
                "location": acct.headquarters_location or "",
                "desc": acct.short_description or acct.full_description or "Enterprise Account",
                "lobs": lobs_list
            })
            
        return {"accounts": result}
    except Exception as e:
        db.rollback()
        print(f"Database query error in /api/accounts: {e}")
        return {"accounts": [], "error": str(e)}

@app.post("/api/personas/fetch")
def fetch_persona(req: FetchRequest):
    name_query = urllib.parse.quote(f'"{req.display_name}"')
    name_plain = urllib.parse.quote(req.display_name.split(' (')[0])
    
    first_name = req.key.split('_')[0].capitalize() if '_' in req.key else req.key.capitalize()
    last_name = req.key.split('_')[1].capitalize() if '_' in req.key and len(req.key.split('_')) > 1 else ""
    
    required_urls = {
        "key": req.key,
        "display_name": req.display_name,
        "linkedin_url": req.linkedin_url,
        "twitter_live_url": f"https://x.com/search?q={name_query}&f=live",
        "reddit_rss_url": f"https://www.reddit.com/search.rss?q={name_query}&sort=new",
        "rss_url": f"https://news.google.com/rss/search?q={name_query}",
        "google_patents_url": f"https://patents.google.com/?inventor={name_plain}&sort=new",
        "google_scholar_url": f"https://scholar.google.com/scholar?q={name_plain}",
        "openalex_author_url": f"https://api.openalex.org/authors?search={name_plain}",
        "orcid_search_url": f"https://pub.orcid.org/v3.0/search/?q={name_plain}",
        "wikidata_person_url": f"https://www.wikidata.org/w/api.php?action=wbsearchentities&search={name_plain}",
        "youtube_interviews_url": f"https://www.youtube.com/results?search_query={name_plain}+interview",
        "podcast_search_url": f"https://www.google.com/search?q={name_plain}+podcast",
        "google_trends_url": f"https://trends.google.com/trends/explore?q={name_plain}"
    }
    
    dossier = {
      "level_1_demographics": {
        "degree": "MBA",
        "institution": "Stanford University",
        "prior_company": "McKinsey & Company",
        "skills": ["Strategic Planning", "Asset Management", "Leadership"]
      },
      "level_2_behavior_and_kpis": {
        "target_kpis": ["AUM Growth", "Margin Expansion"],
        "operational_pain_points": ["Infrastructure Scaling"]
      },
      "level_3_personal_touch": {
        "communication_style": "Analytical and concise",
        "personalized_icebreaker": "Congratulations on the recent expansion.",
        "key_objections": ["Timeline constraints"]
      }
    } if req.enrich_ai_dossier else {}
    
    person = {
        "key": req.key,
        "display_name": req.display_name,
        "name": req.display_name.split(' (')[0],
        "first_name": first_name,
        "last_name": last_name,
        "title": "Executive",
        "tier": "c_suite",
        "linkedin_url": req.linkedin_url,
        "required_person_data": required_urls,
        "persona_dossier": dossier
    }
    
    return {
        "status": "staged",
        "message": f"Successfully fetched and enriched persona for '{person['name']}'.",
        "person": person
    }

@app.post("/api/personas/validate-single")
def validate_single_persona(person: EnrichedPersona):
    return validate_persona(person)

@app.post("/api/personas/dump-single-db")
def dump_single_persona(req: DumpRequest, db: Session = Depends(get_session)):
    try:
        new_persona = Persona(
            account_id=req.account_id,
            key=req.person_data.key,
            display_name=req.person_data.display_name,
            full_name=req.person_data.name,
            first_name=req.person_data.first_name,
            last_name=req.person_data.last_name,
            title=req.person_data.title,
            tier=req.person_data.tier,
            linkedin_url=req.person_data.linkedin_url,
            raw_data=req.person_data.model_dump()
        )
        db.add(new_persona)
        db.commit()
        db.refresh(new_persona)
        
        return {
            "status": "success",
            "persona_id": new_persona.id,
            "full_name": new_persona.full_name,
            "title": new_persona.title,
            "tier": new_persona.tier,
            "message": f"Persona '{new_persona.full_name}' saved to database."
        }
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

# Mount the static frontend
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
