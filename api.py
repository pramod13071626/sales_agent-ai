"""
Sales AI Intelligence Pipeline — Granular REST API Server.
Provides dedicated Fetch / Validate / Dump lifecycle endpoints for:
1. Account Level (Tab 1)
2. Lines of Business (LOB) & Sub-LOB Level (Tab 2 & 3)
3. Person & Persona Level — Individual & Batch (Tab 4)
4. Full Composite Pipeline

Workflow for each level:
    [Fetch / Pull Button] ──► Staged into memory/JSON (NO DB Write)
          │
    [Validate Button Appears] ──► Quality Audit & Health Scores (0-100%)
          │
    [Dump DB Button Appears] ──► User-approved UPSERT into PostgreSQL (sales_ai)

100% Dynamic, Zero Hardcoding.
"""

import sys
import re
import json
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

# Ensure project root is on sys.path
PIPELINE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE_ROOT))

import config
from collectors.account_collector import (
    scrape_account,
    fetch_latest_10k_chunks,
    extract_full_patents,
    fetch_sec_exhibit_21_subsidiaries,
    fetch_gleif_ownership_tree,
    fetch_wikipedia_dbpedia_intel,
    fetch_fec_political_intel,
    fetch_diffbot_organization_intel
)
from collectors.sublob_collector import scrape_sublobs
from collectors.lob_enricher import enrich_lob_segments
from collectors.hierarchy_collector import scrape_hierarchy, scrape_lob_hierarchy, build_required_person_data, classify_title
from collectors.persona_enricher import build_persona_dossier
from collectors.validator import DataQualityValidator
from serializer import MasterSerializer
from serializers.account_serializer import AccountSerializer, slugify
from serializers.lob_serializer import LOBSerializer
from serializers.persona_serializer import PersonaSerializer

from db.connection import get_session
from db.models import Account, Lob, SubLob, Persona, Post, Digest, OpportunitySignal
from db.schemas import AccountSchema, LobSchema, PersonaSchema
from db.repositories import AccountRepository, LobRepository, PersonaRepository
from db.importer import import_run_to_db
from main import run_pipeline

try:
    from fastapi import FastAPI, APIRouter, HTTPException, Query, Body
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False


if FASTAPI_AVAILABLE:
    app = FastAPI(
        title="Sales AI Enterprise Intelligence API",
        description="Granular REST API for Frontend UI Tabs: Account, LOBs, Sub-LOBs, and Personas (Fetch -> Validate -> Dump)",
        version="2.2.0"
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ══════════════════════════════════════════════════════
    # REQUEST / RESPONSE MODELS
    # ══════════════════════════════════════════════════════
    class AccountFetchRequest(BaseModel):
        company_name: str
        target_url: Optional[str] = None

    class AccountDumpRequest(BaseModel):
        account_data: Dict[str, Any]

    class Sec10kRequest(BaseModel):
        sec_cik: str
        chunk_size: int = 1500
        overlap: int = 200

    class PatentsRequest(BaseModel):
        company_name: str
        max_results: int = 10

    class LobsFetchRequest(BaseModel):
        company_name: str

    class LobsDumpRequest(BaseModel):
        account_id: int
        lobs_data: List[Dict[str, Any]]

    class PersonaCardFetchRequest(BaseModel):
        """
        Exact payload structure sent by frontend when user clicks 'Fetch' on a Person card:
        {
          "key": "jane_doe",
          "display_name": "Jane Doe (CEO, Example Co)",
          "linkedin_url": "https://www.linkedin.com/in/janedoe/",
          "twitter_handle": null,
          "reddit_query": "\"Jane Doe\"",
          "sec_cik": null,
          "news_query": "\"Jane Doe\"",
          "patents_query": "Jane Doe",
          "youtube_channel_id": null,
          "rss_url": null,
          "account_id": null,
          "company_name": null,
          "title": null,
          "enrich_ai_dossier": true
        }
        """
        key: Optional[str] = None
        display_name: Optional[str] = None
        name: Optional[str] = None
        title: Optional[str] = None
        company_name: Optional[str] = None
        account_id: Optional[int] = None
        linkedin_url: Optional[str] = None
        twitter_handle: Optional[str] = None
        reddit_query: Optional[str] = None
        sec_cik: Optional[str] = None
        news_query: Optional[str] = None
        patents_query: Optional[str] = None
        youtube_channel_id: Optional[str] = None
        rss_url: Optional[str] = None
        enrich_ai_dossier: bool = True

    class PersonDumpRequest(BaseModel):
        account_id: int
        person_data: Dict[str, Any]

    class HierarchyFetchRequest(BaseModel):
        company_domain: str
        company_name: Optional[str] = None
        sec_cik: Optional[str] = None
        enrich_csuite_dossiers: bool = True

    class HierarchyDumpRequest(BaseModel):
        account_id: int
        hierarchy: Dict[str, List[Dict[str, Any]]]

    class PipelineRunRequest(BaseModel):
        company_name: str
        target_url: Optional[str] = None

    class PipelineDumpDbRequest(BaseModel):
        run_dir: Optional[str] = None
        file: Optional[str] = None
        require_validation: bool = True

    class OpportunitySignalItem(BaseModel):
        """One currently-detected growth-theme or domain-expansion suggestion, as computed client-side."""
        signal_key: str
        title: str
        details: Dict[str, Any] = {}

    class OpportunitySignalSyncRequest(BaseModel):
        category: str  # 'growth_theme' | 'domain_expansion'
        items: List[OpportunitySignalItem] = []

    # ══════════════════════════════════════════════════════
    # TAB 1: ACCOUNT LEVEL ENDPOINTS
    # ══════════════════════════════════════════════════════
    account_router = APIRouter(prefix="/api/account", tags=["1. Account Level"])

    @account_router.post("/fetch")
    def fetch_account_data(req: AccountFetchRequest):
        """[Tab 1 - Fetch Button]: Scrapes live firmographics and 15 scraping launchpad URLs."""
        try:
            account_data = scrape_account(req.company_name, req.target_url)
            return {
                "status": "staged",
                "company_name": req.company_name,
                "account": account_data
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Account fetch failed: {str(e)}")

    @account_router.post("/validate")
    def validate_account_data(account_data: Dict[str, Any] = Body(...)):
        """[Tab 1 - Validate Button]: Validates staged account data."""
        try:
            report = DataQualityValidator.validate_account(account_data)
            return {
                "status": "validated",
                "score": report["score"],
                "checks": report["checks"],
                "warnings": report["warnings"]
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Account validation failed: {str(e)}")

    @account_router.post("/dump-db")
    def dump_account_to_db(req: AccountDumpRequest):
        """[Tab 1 - Dump DB Button]: Commits validated account data into PostgreSQL `accounts` table."""
        session = get_session()
        try:
            wrapper_doc = {"account": req.account_data}
            schema = AccountSchema.from_enriched_json(wrapper_doc)
            repo = AccountRepository(session)
            acct = repo.upsert(schema)
            session.commit()
            return {
                "status": "success",
                "account_id": acct.id,
                "key": acct.key,
                "legal_name": acct.legal_name,
                "message": f"Account '{acct.key}' successfully saved to database."
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Account DB dump failed: {str(e)}")
        finally:
            session.close()

    @account_router.get("")
    def list_all_accounts_with_hierarchy():
        """
        [Page Initialization (loadData())]:
        Queries PostgreSQL (accounts, lobs, sub_lobs, personas), formats full metadata,
        and provides complete structured enterprise account dossiers with nested LOBs and personas.
        """
        session = get_session()
        try:
            accounts = session.query(Account).order_by(Account.id.desc()).all()
            result = []
            for acct in accounts:
                # 1. Format Personas
                personas_list = []
                for p in (acct.personas or []):
                    personas_list.append({
                        "id": p.id,
                        "key": p.key,
                        "name": p.full_name,
                        "full_name": p.full_name,
                        "first_name": p.first_name,
                        "last_name": p.last_name,
                        "title": p.title,
                        "tier": p.tier,
                        "seniority_raw": p.seniority_raw,
                        "departments": p.departments or ["Executive"],
                        "email": p.email,
                        "email_status": p.email_status,
                        "phone": p.phone,
                        "linkedin_url": p.linkedin_url,
                        "city": p.city,
                        "state": p.state,
                        "country": p.country,
                        "hierarchy_level": p.hierarchy_level,
                        "decision_authority": p.decision_authority,
                        "budget_authority": p.budget_authority,
                        "twitter_handle": p.twitter_handle,
                        "twitter_live_url": p.twitter_live_url,
                        "reddit_query": p.reddit_query,
                        "reddit_rss_url": p.reddit_rss_url,
                        "sec_cik": p.sec_cik,
                        "sec_insider_trades_url": p.sec_insider_trades_url,
                        "news_query": p.news_query,
                        "rss_url": p.rss_url,
                        "patents_query": p.patents_query,
                        "google_patents_url": p.google_patents_url,
                        "google_scholar_url": p.google_scholar_url,
                        "openalex_author_url": p.openalex_author_url,
                        "orcid_search_url": p.orcid_search_url,
                        "wikidata_person_url": p.wikidata_person_url,
                        "youtube_interviews_url": p.youtube_interviews_url,
                        "podcast_search_url": p.podcast_search_url,
                        "google_trends_url": p.google_trends_url,
                        "youtube_channel_id": p.youtube_channel_id,
                        "skills": p.skills or [],
                        "target_kpis": p.target_kpis or [],
                        "operational_pain_points": p.operational_pain_points or [],
                        "key_objections": p.key_objections or [],
                        "degree": p.degree,
                        "institution": p.institution,
                        "prior_company": p.prior_company,
                        "communication_style": p.communication_style,
                        "engagement_rate": p.engagement_rate,
                        "value_proposition": p.value_proposition,
                        "personalized_icebreaker": p.personalized_icebreaker,
                        "social_platform": p.social_platform,
                        "social_profile_url": p.social_profile_url,
                        "social_presence_level": p.social_presence_level,
                        "raw_data": p.raw_data
                    })

                # 2. Format LOBs with nested Personas
                lobs_list = []
                c_suite_personas = [p for p in personas_list if p.get("tier") == "C-Suite" or p.get("hierarchy_level") in [1, 2]]
                vp_personas = [p for p in personas_list if p not in c_suite_personas]

                raw_lobs = acct.lobs or []
                total_lobs = len(raw_lobs) or 1

                for idx, l in enumerate(raw_lobs):
                    # Distribute personas across LOBs with relevant C-Suite + assigned VP cohort
                    chunk_size = max(1, len(vp_personas) // total_lobs) if vp_personas else 0
                    start_i = idx * chunk_size
                    end_i = start_i + chunk_size if idx < total_lobs - 1 else len(vp_personas)
                    lob_assigned_personas = c_suite_personas[:2] + vp_personas[start_i:end_i]

                    sub_lobs_formatted = [
                        {"id": s.id, "name": s.name, "desc": f"Specialized unit under {l.lob_name}"}
                        for s in (l.sub_lobs or [])
                    ]

                    lobs_list.append({
                        "id": l.id,
                        "name": l.lob_name,
                        "lob_name": l.lob_name,
                        "domain": l.domain,
                        "website_url": l.website_url,
                        "desc": l.overview,
                        "overview": l.overview,
                        "revenue": l.audited_segment_revenue,
                        "audited_segment_revenue": l.audited_segment_revenue,
                        "head": l.operating_head,
                        "operating_head": l.operating_head,
                        "headcount": l.segment_headcount,
                        "segment_headcount": l.segment_headcount,
                        "lei_code": l.lei_code,
                        "jurisdiction": l.jurisdiction,
                        "technologies": l.technologies or [],
                        "competitors": l.competitors or [],
                        "financial_snippets": l.financial_snippets or [],
                        "patents": l.patents or [],
                        "logo_url": l.logo_url,
                        "google_news_rss_url": l.google_news_rss_url,
                        "reddit_rss_url": l.reddit_rss_url,
                        "google_patents_url": l.google_patents_url,
                        "google_trends_url": l.google_trends_url,
                        "youtube_search_url": l.youtube_search_url,
                        "subLobs": sub_lobs_formatted,
                        "sub_lobs": sub_lobs_formatted,
                        "personas": lob_assigned_personas
                    })

                acct_name = acct.legal_name or acct.display_name or acct.key
                acct_loc = acct.headquarters_location or (f"{acct.city}, {acct.country}" if acct.city else None)
                acct_desc = acct.short_description or acct.full_description

                result.append({
                    "id": acct.id,
                    "key": acct.key,
                    "name": acct_name,
                    "display_name": acct.display_name or acct_name,
                    "legal_name": acct.legal_name or acct_name,
                    "ticker": acct.stock_symbol,
                    "stock_symbol": acct.stock_symbol,
                    "revenue": acct.estimated_revenue_range or "Revenue N/A",
                    "location": acct_loc,
                    "desc": acct_desc,
                    "domain": acct.domain,
                    "primary_domain": acct.primary_domain or acct.domain,
                    "website_url": acct.website_url,
                    "crunchbase_url": acct.crunchbase_url,
                    "operating_status": acct.operating_status,
                    "company_type": acct.company_type,
                    "founded_year": acct.founded_year,
                    "employee_count_range": acct.employee_count_range,
                    "short_description": acct_desc,
                    "full_description": acct.full_description or acct_desc,
                    "headquarters_location": acct_loc,
                    "city": acct.city,
                    "state": acct.state,
                    "country": acct.country,
                    "postal_code": acct.postal_code,
                    "phone_number": acct.phone_number,
                    "sanitized_phone": acct.sanitized_phone,
                    "contact_email": acct.contact_email,
                    "linkedin_url": acct.linkedin_url,
                    "twitter_url": acct.twitter_url,
                    "twitter_handle": acct.twitter_handle,
                    "stock_exchange": acct.stock_exchange,
                    "sec_cik": acct.sec_cik,
                    "sec_edgar_url": acct.sec_edgar_url,
                    "sec_filings_rss": acct.sec_filings_rss,
                    "sec_submissions_url": acct.sec_submissions_url,
                    "twitter_live_url": acct.twitter_live_url,
                    "reddit_query": acct.reddit_query,
                    "reddit_rss_url": acct.reddit_rss_url,
                    "news_query": acct.news_query,
                    "rss_url": acct.rss_url,
                    "google_patents_url": acct.google_patents_url,
                    "google_trends_url": acct.google_trends_url,
                    "youtube_search_url": acct.youtube_search_url,
                    "openalex_institution_url": acct.openalex_institution_url,
                    "wikidata_entity_url": acct.wikidata_entity_url,
                    "github_url": acct.github_url,
                    "glassdoor_url": acct.glassdoor_url,
                    "blog_url": acct.blog_url,
                    "industries": acct.industries or [],
                    "keywords": acct.keywords or [],
                    "lobs_count": len(lobs_list),
                    "total_contacts_captured": len(personas_list),
                    "lobs": lobs_list,
                    "personas": personas_list,
                    "multi_source_intelligence": acct.multi_source_intelligence,
                    "organisational_hierarchy_tree": acct.organisational_hierarchy_tree,
                    "extracted_at": acct.extracted_at.isoformat() if acct.extracted_at else None,

                    # ── Engagement / opportunity signals (previously captured but never exposed) ──
                    "heat_score": acct.heat_score,
                    "trend_score_90d": acct.trend_score_90d,
                    "active_tech_count": acct.active_tech_count,
                    "it_spend": acct.it_spend,
                    "patents_granted": acct.patents_granted,
                    "trademarks_registered": acct.trademarks_registered,
                    "total_funding_amount_usd": acct.total_funding_amount_usd,
                    "total_funding_currency": acct.total_funding_currency,
                    "last_funding_type": acct.last_funding_type,
                    "last_funding_date": acct.last_funding_date.isoformat() if acct.last_funding_date else None,
                    "num_funding_rounds": acct.num_funding_rounds,
                    "funding_status": acct.funding_status,
                    "ipo_status": acct.ipo_status,
                    "ipo_date": acct.ipo_date.isoformat() if acct.ipo_date else None,
                    "num_suborganizations": acct.num_suborganizations,
                    "num_acquisitions": acct.num_acquisitions,
                    "global_traffic_rank": acct.global_traffic_rank,
                    "monthly_visits": acct.monthly_visits,
                    "bounce_rate": acct.bounce_rate,
                    "visit_duration": acct.visit_duration,
                    "page_views_per_visit": acct.page_views_per_visit,
                    "c_suite_count": acct.c_suite_count,
                    "vp_count": acct.vp_count,
                    "director_count": acct.director_count,
                    "manager_count": acct.manager_count
                })

            return {"accounts": result}
        finally:
            session.close()

    @account_router.get("/{account_id}")
    def get_account_from_db(account_id: int):
        """Retrieves a stored account from DB with its LOBs and personas."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail="Account not found.")
            return {
                "id": acct.id,
                "key": acct.key,
                "legal_name": acct.legal_name,
                "display_name": acct.display_name,
                "domain": acct.domain,
                "website_url": acct.website_url,
                "stock_symbol": acct.stock_symbol,
                "sec_cik": acct.sec_cik,
                "employee_count_range": acct.employee_count_range,
                "city": acct.city,
                "state": acct.state,
                "country": acct.country,
                "industries": acct.industries,
                "founders": acct.founders,
                "sec_edgar_url": acct.sec_edgar_url,
                "rss_url": acct.rss_url,
                "google_patents_url": acct.google_patents_url,
                "google_trends_url": acct.google_trends_url,
                "youtube_search_url": acct.youtube_search_url,
                "extracted_at": acct.extracted_at
            }
        finally:
            session.close()

    @account_router.post("/sec-10k-chunks")
    def extract_sec_10k_chunks(req: Sec10kRequest):
        """
        [Real-time SEC 10-K Chunker]:
        Fetches the latest official 10-K filing from SEC EDGAR, extracts Item 1 (Business),
        Item 1A (Risk Factors), and Item 7 (MD&A), and chunks text for AI RAG/Vector embeddings.
        """
        try:
            return fetch_latest_10k_chunks(
                sec_cik=req.sec_cik,
                chunk_size=req.chunk_size,
                overlap=req.overlap
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"10-K Chunking failed: {str(e)}")

    @account_router.post("/patents")
    def get_full_patents(req: PatentsRequest):
        """
        [Full Patent Text Extractor]:
        Queries USPTO and open patent registries for granted patents and abstracts.
        """
        try:
            return extract_full_patents(
                company_name=req.company_name,
                max_results=req.max_results
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Patent extraction failed: {str(e)}")

    @account_router.post("/sec-exhibit-21")
    def get_sec_exhibit_21_subsidiaries(req: Sec10kRequest):
        """
        [SEC EDGAR Exhibit 21 (Subsidiaries of Registrant) Extractor]:
        Fetches the official legal Exhibit 21 filed with Form 10-K, returning
        all legally registered subsidiaries and their jurisdictions of incorporation.
        """
        try:
            return fetch_sec_exhibit_21_subsidiaries(sec_cik=req.sec_cik)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Exhibit 21 extraction failed: {str(e)}")

    @account_router.post("/gleif")
    def get_gleif_ownership_tree(req: PatentsRequest):
        """
        [GLEIF Corporate Ownership Graph Resolver]:
        Queries the official G20 LEI database for legal registered name,
        LEI code, direct/ultimate parent entities, and global child subsidiaries.
        """
        try:
            return fetch_gleif_ownership_tree(company_name=req.company_name, max_children=req.max_results)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"GLEIF extraction failed: {str(e)}")

    @account_router.post("/wikipedia")
    def get_wikipedia_intel(req: PatentsRequest):
        """
        [Wikipedia & DBpedia Open Knowledge Graph Extractor]:
        Queries Wikipedia REST API & DBpedia for executive summary, founding date, and logo.
        """
        try:
            return fetch_wikipedia_dbpedia_intel(company_name=req.company_name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Wikipedia extraction failed: {str(e)}")

    @account_router.post("/fec")
    def get_fec_political_intel(req: PatentsRequest):
        """
        [FEC Federal Election Commission Political Giving API]:
        Queries OpenFEC via data.gov API key for corporate PAC contributions & executive donations.
        """
        try:
            return fetch_fec_political_intel(entity_name=req.company_name, max_records=req.max_results)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"FEC extraction failed: {str(e)}")

    @account_router.post("/diffbot")
    def get_diffbot_intel(req: AccountFetchRequest):
        """
        [Diffbot Knowledge Graph (DKG) Enhancer]:
        Queries Diffbot AI Knowledge Graph for verified firmographics, logo, technologies,
        competitors, subsidiaries, parent organizations, and board members.
        """
        try:
            return fetch_diffbot_organization_intel(company_name=req.company_name, website_url=req.target_url)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Diffbot extraction failed: {str(e)}")

    # ══════════════════════════════════════════════════════
    # TAB 2 & 3: LOB & SUB-LOB LEVEL ENDPOINTS
    # ══════════════════════════════════════════════════════
    lobs_router = APIRouter(prefix="/api/lobs", tags=["2. LOB & Sub-LOB Level"])

    @lobs_router.post("/fetch")
    def fetch_lobs_data(req: LobsFetchRequest):
        """[Tab 2 - Fetch Button]: Discovers sub-organizations and enriches segment revenues."""
        try:
            raw_sublobs = scrape_sublobs(req.company_name)
            enriched_lobs = enrich_lob_segments(req.company_name, raw_sublobs)
            return {
                "status": "staged",
                "company_name": req.company_name,
                "total_lobs": len(enriched_lobs),
                "lobs": enriched_lobs
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LOB fetch failed: {str(e)}")

    @lobs_router.post("/validate")
    def validate_lobs_data(lobs_data: List[Dict[str, Any]] = Body(...)):
        """[Tab 2 - Validate Button]: Validates LOB and Sub-LOB data."""
        try:
            report = DataQualityValidator.validate_lobs(lobs_data)
            return {
                "status": "validated",
                "score": report["score"],
                "lobs_count": report["lobs_count"],
                "total_with_domain": report["total_with_domain"],
                "details": report["details"],
                "warnings": report["warnings"]
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LOB validation failed: {str(e)}")

    @lobs_router.post("/dump-db")
    def dump_lobs_to_db(req: LobsDumpRequest):
        """[Tab 2 - Dump DB Button]: Commits validated LOBs and Sub-LOBs to PostgreSQL `lobs` & `sub_lobs` tables."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=req.account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail=f"Account ID {req.account_id} not found in DB.")

            lob_repo = LobRepository(session)
            lob_map = lob_repo.upsert_all(acct, req.lobs_data)
            session.commit()
            return {
                "status": "success",
                "account_id": acct.id,
                "lobs_saved": len(lob_map),
                "lob_mapping": lob_map,
                "message": f"Saved {len(lob_map)} LOBs for Account '{acct.key}'."
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"LOB DB dump failed: {str(e)}")
        finally:
            session.close()

    @lobs_router.get("")
    def get_lobs_for_account(account_id: int = Query(...)):
        """Retrieves stored LOBs and sub-lobs for an account."""
        session = get_session()
        try:
            lobs = session.query(Lob).filter_by(account_id=account_id).all()
            return [
                {
                    "id": l.id,
                    "account_id": l.account_id,
                    "lob_name": l.lob_name,
                    "domain": l.domain,
                    "website_url": l.website_url,
                    "audited_segment_revenue": l.audited_segment_revenue,
                    "operating_head": l.operating_head,
                    "segment_headcount": l.segment_headcount,
                    "google_news_rss_url": l.google_news_rss_url,
                    "reddit_rss_url": l.reddit_rss_url,
                    "google_patents_url": l.google_patents_url,
                    "youtube_search_url": l.youtube_search_url,
                    "sub_lobs": [{"id": s.id, "name": s.name} for s in (l.sub_lobs or [])]
                }
                for l in lobs
            ]
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # TAB 4: PERSONAS LEVEL (INDIVIDUAL & BATCH LIFECYCLE)
    # ══════════════════════════════════════════════════════
    personas_router = APIRouter(prefix="/api/personas", tags=["3. Personas Level"])

    @personas_router.post("/fetch")
    def fetch_persona_from_card(card: PersonaCardFetchRequest):
        """
        [Tab 4 - Person Card 'Fetch' Button]:
        Accepts the incoming person card payload from frontend, dynamically resolves identity,
        generates all 18 official scraping URLs, and synthesizes neural AI dossier.
        """
        try:
            # 1. Dynamically parse name, title, and company from incoming payload
            raw_display = card.display_name or ""
            parsed_name = card.name
            parsed_title = card.title
            parsed_company = card.company_name

            # Dynamic extraction from display_name if explicit fields are omitted (e.g. "Jane Doe (CEO, Example Co)")
            if not parsed_name and raw_display:
                parsed_name = re.sub(r"\s*\(.*?\)", "", raw_display).strip()
            if not parsed_name and card.key:
                parsed_name = card.key.replace("_", " ").title()

            if raw_display and "(" in raw_display:
                match = re.search(r"\((.*?)\)", raw_display)
                if match:
                    parts = match.group(1).split(",")
                    if not parsed_title and len(parts) >= 1:
                        parsed_title = parts[0].strip()
                    if not parsed_company and len(parts) >= 2:
                        parsed_company = parts[1].strip()

            parsed_name = parsed_name or "Executive"
            parsed_title = parsed_title or "Leadership"
            parsed_company = parsed_company or ""

            # If company not in payload but account_id provided, look up company from DB
            if not parsed_company and card.account_id:
                session = get_session()
                try:
                    acct = session.query(Account).filter_by(id=card.account_id).first()
                    if acct:
                        parsed_company = acct.legal_name or acct.display_name or acct.key
                finally:
                    session.close()

            # 2. Build compulsory 18 Scraping URLs Matrix
            req_data = build_required_person_data(
                name=parsed_name,
                title=parsed_title,
                company_name=parsed_company,
                linkedin_url=card.linkedin_url,
                twitter_handle=card.twitter_handle,
                sec_cik=card.sec_cik
            )

            # 3. Synthesize Neural AI Persona Dossier
            dossier = None
            verified_linkedin = card.linkedin_url
            if card.enrich_ai_dossier:
                dossier = build_persona_dossier(
                    name=parsed_name,
                    title=parsed_title,
                    company_name=parsed_company,
                    linkedin_url=card.linkedin_url
                )
                if dossier.get("level_3_personal_touch", {}).get("social_media", {}).get("profile_url"):
                    verified_linkedin = dossier["level_3_personal_touch"]["social_media"]["profile_url"]
                    req_data["linkedin_url"] = verified_linkedin

            tier = classify_title(parsed_title)
            name_parts = parsed_name.split()
            first_name = name_parts[0] if name_parts else None
            last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else None

            person_entry = {
                "key": req_data.get("key") or card.key or parsed_name.lower().replace(" ", "_"),
                "display_name": req_data.get("display_name") or raw_display or f"{parsed_name} ({parsed_title}, {parsed_company})".strip(),
                "name": parsed_name,
                "first_name": first_name,
                "last_name": last_name,
                "title": parsed_title,
                "tier": tier,
                "seniority_raw": tier,
                "departments": ["Executive"],
                "linkedin_url": verified_linkedin,
                "required_person_data": req_data,
                "persona_dossier": dossier
            }

            # 4. Auto-save single persona slice into self-healing folder
            from serializer import slugify
            company_slug = slugify(parsed_company) if parsed_company else "general"
            person_slug = slugify(parsed_name)
            run_dirs = config.get_run_output_dirs(parsed_company or "persona_run")
            person_file = run_dirs["enriched_personas_company_dir"] / f"{company_slug}_corporate_{person_slug}_enriched.json"
            PipelineSerializer.save_json(person_entry, person_file)

            return {
                "status": "staged",
                "message": f"Successfully fetched and enriched persona for '{parsed_name}'.",
                "saved_file": str(person_file),
                "person": person_entry
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Persona fetch failed: {str(e)}")

    @personas_router.post("/validate-single")
    def validate_single_persona(person_data: Dict[str, Any] = Body(...)):
        """
        [Tab 4 - Individual Validate Button]:
        Validates a single person's contact data, scraping URLs, and AI dossier.
        """
        try:
            rpd = person_data.get("required_person_data", {}) or {}
            dossier = person_data.get("persona_dossier") or {}

            url_fields = [
                "twitter_live_url", "reddit_rss_url", "rss_url",
                "google_patents_url", "google_scholar_url", "openalex_author_url",
                "orcid_search_url", "wikidata_person_url", "youtube_interviews_url",
                "podcast_search_url", "google_trends_url"
            ]
            valid_urls = sum(1 for f in url_fields if DataQualityValidator.is_valid_url(rpd.get(f)))
            has_linkedin = DataQualityValidator.is_valid_url(person_data.get("linkedin_url"))
            has_dossier = bool(dossier)

            # Score calculation
            score = round(((valid_urls / len(url_fields)) * 50) + (30 if has_linkedin else 10) + (20 if has_dossier else 0), 1)

            warnings = []
            if not has_linkedin:
                warnings.append("LinkedIn URL is missing or unverified.")
            if not has_dossier:
                warnings.append("AI Persona Dossier has not been synthesized.")

            return {
                "status": "validated",
                "score": score,
                "person_name": person_data.get("name") or person_data.get("display_name"),
                "has_verified_linkedin": has_linkedin,
                "has_ai_dossier": has_dossier,
                "valid_scraping_urls_count": f"{valid_urls}/{len(url_fields)}",
                "warnings": warnings,
                "ready_for_db": score >= 60.0
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Persona validation failed: {str(e)}")

    @personas_router.post("/dump-single-db")
    def dump_single_persona_to_db(req: PersonDumpRequest):
        """
        [Tab 4 - Individual Dump DB Button]: Commits a single validated persona into PostgreSQL `personas` table.
        """
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=req.account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail=f"Account ID {req.account_id} not found in DB.")

            schema = PersonaSchema.from_enriched_json(req.person_data)
            
            # Check if persona with same key exists for account
            existing = session.query(Persona).filter_by(account_id=acct.id, key=schema.key).first()
            if existing:
                persona = existing
            else:
                persona = Persona(account_id=acct.id)
                session.add(persona)

            data = schema.model_dump()
            for field, value in data.items():
                if hasattr(persona, field):
                    setattr(persona, field, value)

            session.commit()
            return {
                "status": "success",
                "persona_id": persona.id,
                "full_name": persona.full_name,
                "title": persona.title,
                "tier": persona.tier,
                "message": f"Persona '{persona.full_name}' saved to database."
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Persona DB dump failed: {str(e)}")
        finally:
            session.close()

    @personas_router.post("/fetch-hierarchy")
    def fetch_full_hierarchy(req: HierarchyFetchRequest):
        """[Tab 4 - Full Org Hierarchy Fetch Button]: Pulls live 4-tier organization hierarchy."""
        try:
            hierarchy = scrape_hierarchy(
                company_domain=req.company_domain,
                company_name=req.company_name,
                sec_cik=req.sec_cik
            )

            if req.enrich_csuite_dossiers and hierarchy.get("c_suite"):
                for p in hierarchy["c_suite"][:2]:
                    p["persona_dossier"] = build_persona_dossier(
                        p.get("name"), p.get("title"), req.company_name or req.company_domain, p.get("linkedin_url")
                    )

            total = sum(len(hierarchy.get(k, [])) for k in ["c_suite", "vp_level", "director_level", "manager_level"])
            return {
                "status": "staged",
                "total_contacts": total,
                "tier_counts": {k: len(hierarchy.get(k, [])) for k in ["c_suite", "vp_level", "director_level", "manager_level"]},
                "hierarchy": hierarchy
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Hierarchy fetch failed: {str(e)}")

    @personas_router.post("/validate")
    def validate_personas(hierarchy: Dict[str, List[Dict[str, Any]]] = Body(...)):
        """[Tab 4 - Hierarchy Validate Button]: Validates 4-tier hierarchy."""
        try:
            report = DataQualityValidator.validate_hierarchy_and_personas(hierarchy)
            return {
                "status": "validated",
                "score": report["score"],
                "total_contacts": report["total_contacts"],
                "tier_breakdown": report["tier_breakdown"],
                "contact_metrics": report["contact_metrics"],
                "warnings": report["warnings"]
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Personas validation failed: {str(e)}")

    @personas_router.post("/dump-hierarchy-db")
    def dump_hierarchy_to_db(req: HierarchyDumpRequest):
        """[Tab 4 - Batch Hierarchy Dump DB Button]: Commits full 4-tier hierarchy to PostgreSQL."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=req.account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail=f"Account ID {req.account_id} not found in DB.")

            repo = PersonaRepository(session)
            count = repo.upsert_all(acct, req.hierarchy)
            session.commit()
            return {
                "status": "success",
                "account_id": acct.id,
                "total_personas_saved": count,
                "message": f"Saved {count} personas for Account '{acct.key}'."
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Hierarchy DB dump failed: {str(e)}")
        finally:
            session.close()

    @personas_router.get("")
    def get_personas_from_db(account_id: int = Query(...), tier: Optional[str] = Query(None)):
        """Retrieves stored personas for an account, with optional tier filter."""
        session = get_session()
        try:
            query = session.query(Persona).filter_by(account_id=account_id)
            if tier:
                query = query.filter_by(tier=tier)
            personas = query.order_by(Persona.id).all()
            return [
                {
                    "id": p.id,
                    "account_id": p.account_id,
                    "full_name": p.full_name,
                    "title": p.title,
                    "tier": p.tier,
                    "email": p.email,
                    "phone": p.phone,
                    "linkedin_url": p.linkedin_url,
                    "degree": p.degree,
                    "institution": p.institution,
                    "prior_company": p.prior_company,
                    "communication_style": p.communication_style,
                    "skills": p.skills,
                    "target_kpis": p.target_kpis,
                    "operational_pain_points": p.operational_pain_points,
                    "key_objections": p.key_objections,
                    "twitter_live_url": p.twitter_live_url,
                    "sec_insider_trades_url": p.sec_insider_trades_url,
                    "rss_url": p.rss_url,
                    "google_scholar_url": p.google_scholar_url,
                    "youtube_interviews_url": p.youtube_interviews_url,
                    "podcast_search_url": p.podcast_search_url,
                }
                for p in personas
            ]
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # FULL COMPOSITE PIPELINE ENDPOINTS
    # ══════════════════════════════════════════════════════
    pipeline_router = APIRouter(prefix="/api/pipeline", tags=["0. Full Composite Pipeline"])

    @pipeline_router.post("/run")
    def trigger_full_pipeline(req: PipelineRunRequest):
        """Triggers complete live pipeline. Staged, NO DB write."""
        try:
            res = run_pipeline(company_name=req.company_name, target_url=req.target_url)
            return {
                "status": "staged",
                "company_name": req.company_name,
                "run_dirs": {k: str(v) for k, v in res["run_dirs"].items()},
                "validation_score": res["validation_report"]["audit_metadata"]["overall_quality_score"],
                "ready_for_db_dump": res["validation_report"]["audit_metadata"]["ready_for_db_dump"]
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {str(e)}")

    @pipeline_router.post("/validate")
    def validate_composite_run(req: PipelineDumpDbRequest):
        """Audits an entire staged run directory or file."""
        target_path = Path(req.run_dir or req.file or "")
        if not target_path.exists():
            raise HTTPException(status_code=404, detail=f"Path not found: {target_path}")

        if target_path.is_dir():
            files = list(target_path.glob("enriched/*_enriched*.json")) or list(target_path.glob("*_enriched*.json")) or list(target_path.rglob("*_enriched*.json"))
            if not files:
                raise HTTPException(status_code=400, detail=f"No enriched JSON in: {target_path}")
            target_path = files[0]

        try:
            with open(target_path, "r", encoding="utf-8") as f:
                doc = json.load(f)
            return DataQualityValidator.audit_run(doc)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")

    @pipeline_router.get("/runs")
    def list_pipeline_runs(limit: int = 50):
        """Lists recent execution runs from PostgreSQL pipeline_runs table."""
        session = get_session()
        try:
            from db.repositories.pipeline_run_repository import PipelineRunRepository
            repo = PipelineRunRepository(session)
            runs = repo.list_recent_runs(limit=limit)
            return [
                {
                    "id": r.id,
                    "run_id": r.run_id,
                    "company_name": r.company_name,
                    "status": r.status,
                    "quality_score": float(r.quality_score or 0.0),
                    "quality_grade": r.quality_grade,
                    "started_at": r.started_at.isoformat() if r.started_at else None,
                    "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                    "duration_seconds": float(r.duration_seconds or 0.0),
                    "total_credits_used": r.total_credits_used,
                    "entities_extracted": r.entities_extracted
                }
                for r in runs
            ]
        finally:
            session.close()

    @pipeline_router.get("/runs/{run_id}")
    def get_pipeline_run_detail(run_id: str):
        """Retrieves full execution details, credit breakdown, and logs for a specific run."""
        session = get_session()
        try:
            from db.repositories.pipeline_run_repository import PipelineRunRepository
            repo = PipelineRunRepository(session)
            r = repo.get_by_run_id(run_id)
            if not r:
                raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
            return {
                "id": r.id,
                "run_id": r.run_id,
                "company_name": r.company_name,
                "target_url": r.target_url,
                "status": r.status,
                "quality_score": float(r.quality_score or 0.0),
                "quality_grade": r.quality_grade,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "duration_seconds": float(r.duration_seconds or 0.0),
                "total_credits_used": r.total_credits_used,
                "credits_breakdown": r.credits_breakdown,
                "entities_extracted": r.entities_extracted,
                "execution_logs": r.execution_logs,
                "raw_storage_dir": r.raw_storage_dir,
                "enriched_storage_dir": r.enriched_storage_dir,
                "error_message": r.error_message
            }
        finally:
            session.close()

    @pipeline_router.get("/credits/summary")
    def get_credits_summary():
        """Returns aggregate credit consumption metrics across all vendors."""
        session = get_session()
        try:
            from db.repositories.pipeline_run_repository import PipelineRunRepository
            repo = PipelineRunRepository(session)
            return repo.get_credits_summary()
        finally:
            session.close()

    # Include all sub-routers
    app.include_router(pipeline_router)
    app.include_router(account_router)
    app.include_router(lobs_router)
    app.include_router(personas_router)

    # ══════════════════════════════════════════════════════
    # SOLID REST API ENDPOINTS
    # ══════════════════════════════════════════════════════

    @app.get("/api/accounts", tags=["1. Accounts"])
    def get_all_accounts():
        """Retrieve all enterprise accounts with full hierarchical structure."""
        return list_all_accounts_with_hierarchy()

    @app.get("/api/accounts/{account_id}", tags=["1. Accounts"])
    def get_account_by_id(account_id: int):
        """Retrieve a specific enterprise account with its complete profile."""
        return get_account_from_db(account_id)

    @app.get("/api/accounts/{account_id}/lobs", tags=["2. Lines of Business"])
    def get_account_lines_of_business(account_id: int):
        """Retrieve all Lines of Business (LOBs) and nested sub-divisions for an account."""
        session = get_session()
        try:
            lobs = session.query(Lob).filter_by(account_id=account_id).all()
            result = []
            for l in lobs:
                sublobs = session.query(SubLob).filter_by(lob_id=l.id).all()
                result.append({
                    "id": l.id,
                    "account_id": l.account_id,
                    "name": l.lob_name,
                    "lob_name": l.lob_name,
                    "key": l.key,
                    "domain": l.domain,
                    "website_url": l.website_url,
                    "desc": l.overview,
                    "overview": l.overview,
                    "revenue": l.audited_segment_revenue,
                    "audited_segment_revenue": l.audited_segment_revenue,
                    "head": l.operating_head,
                    "operating_head": l.operating_head,
                    "headcount": l.segment_headcount,
                    "segment_headcount": l.segment_headcount,
                    "lei_code": l.lei_code,
                    "jurisdiction": l.jurisdiction,
                    "technologies": l.technologies or [],
                    "competitors": l.competitors or [],
                    "financial_snippets": l.financial_snippets or [],
                    "patents": l.patents or [],
                    "logo_url": l.logo_url,
                    "google_news_rss_url": l.google_news_rss_url,
                    "reddit_rss_url": l.reddit_rss_url,
                    "google_patents_url": l.google_patents_url,
                    "google_trends_url": l.google_trends_url,
                    "youtube_search_url": l.youtube_search_url,
                    "sub_lobs": [{"id": s.id, "name": s.name} for s in sublobs]
                })
            return {"account_id": account_id, "total_lobs": len(result), "lobs": result}
        finally:
            session.close()

    @app.get("/api/lobs/{lob_id}", tags=["2. Lines of Business"])
    def get_single_line_of_business(lob_id: int):
        """Retrieve details for a single Line of Business by its ID."""
        session = get_session()
        try:
            l = session.query(Lob).filter_by(id=lob_id).first()
            if not l:
                raise HTTPException(status_code=404, detail="Line of Business not found.")
            sublobs = session.query(SubLob).filter_by(lob_id=l.id).all()
            return {
                "id": l.id,
                "account_id": l.account_id,
                "name": l.lob_name,
                "lob_name": l.lob_name,
                "key": l.key,
                "domain": l.domain,
                "website_url": l.website_url,
                "overview": l.overview,
                "audited_segment_revenue": l.audited_segment_revenue,
                "operating_head": l.operating_head,
                "segment_headcount": l.segment_headcount,
                "lei_code": l.lei_code,
                "jurisdiction": l.jurisdiction,
                "technologies": l.technologies or [],
                "competitors": l.competitors or [],
                "financial_snippets": l.financial_snippets or [],
                "patents": l.patents or [],
                "google_news_rss_url": l.google_news_rss_url,
                "reddit_rss_url": l.reddit_rss_url,
                "google_patents_url": l.google_patents_url,
                "google_trends_url": l.google_trends_url,
                "youtube_search_url": l.youtube_search_url,
                "sub_lobs": [{"id": s.id, "name": s.name} for s in sublobs]
            }
        finally:
            session.close()

    @app.get("/api/accounts/{account_id}/personas", tags=["3. Personas & Buying Committee"])
    def get_account_buying_committee(account_id: int):
        """Retrieve all executive personas and decision makers mapped to an account."""
        session = get_session()
        try:
            personas = session.query(Persona).filter_by(account_id=account_id).all()
            result = []
            for p in personas:
                result.append({
                    "id": p.id,
                    "account_id": p.account_id,
                    "lob_id": p.lob_id,
                    "key": p.key,
                    "name": p.full_name or p.display_name or "Executive",
                    "full_name": p.full_name or p.display_name or "Executive",
                    "first_name": p.first_name,
                    "last_name": p.last_name,
                    "title": p.title,
                    "job_title": p.title,
                    "tier": p.tier,
                    "seniority_tier": p.tier,
                    "seniority_raw": p.seniority_raw,
                    "email": p.email,
                    "phone": p.phone,
                    "city": p.city,
                    "state": p.state,
                    "country": p.country,
                    "decision_authority": p.decision_authority,
                    "budget_authority": p.budget_authority,
                    "departments": p.departments or ["Executive"],
                    "linkedin_url": p.linkedin_url,
                    "twitter_url": p.twitter_live_url or (f"https://twitter.com/{p.twitter_handle}" if p.twitter_handle else None),
                    "skills": p.skills or [],
                    "target_kpis": p.target_kpis or [],
                    "operational_pain_points": p.operational_pain_points or [],
                    "key_objections": p.key_objections or [],
                    "degree": p.degree,
                    "institution": p.institution,
                    "prior_company": p.prior_company,
                    "communication_style": p.communication_style,
                    "engagement_rate": p.engagement_rate,
                    "value_proposition": p.value_proposition,
                    "personalized_icebreaker": p.personalized_icebreaker,
                    "social_platform": p.social_platform,
                    "social_profile_url": p.social_profile_url,
                    "social_presence_level": p.social_presence_level,
                    "raw_data": p.raw_data
                })
            return {"account_id": account_id, "total_personas": len(result), "personas": result}
        finally:
            session.close()

    @app.get("/api/personas/{persona_id}", tags=["3. Personas & Buying Committee"])
    def get_single_persona_profile(persona_id: int):
        """Retrieve full details and 58-column AI dossier for a specific executive persona."""
        session = get_session()
        try:
            p = session.query(Persona).filter_by(id=persona_id).first()
            if not p:
                raise HTTPException(status_code=404, detail="Persona not found.")
            return {
                "id": p.id,
                "account_id": p.account_id,
                "lob_id": p.lob_id,
                "name": p.full_name or p.display_name or "Executive",
                "title": p.title,
                "tier": p.tier,
                "email": p.email,
                "phone": p.phone,
                "location": f"{p.city or ''}, {p.country or ''}".strip(", "),
                "decision_authority": p.decision_authority,
                "budget_authority": p.budget_authority,
                "linkedin_url": p.linkedin_url,
                "degree": p.degree,
                "institution": p.institution,
                "prior_company": p.prior_company,
                "communication_style": p.communication_style,
                "personalized_icebreaker": p.personalized_icebreaker,
                "value_proposition": p.value_proposition,
                "operational_pain_points": p.operational_pain_points or [],
                "target_kpis": p.target_kpis or [],
                "raw_data": p.raw_data
            }
        finally:
            session.close()

    @app.get("/api/accounts/{account_id}/signals", tags=["1. Accounts"])
    def get_account_intelligence_signals(account_id: int):
        """Retrieve multi-source intelligence, firmographics, heat scores, and traffic telemetry."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail="Account not found.")
            return {
                "account_id": acct.id,
                "account_name": acct.legal_name or acct.display_name,
                "heat_score": acct.heat_score,
                "trend_score_90d": acct.trend_score_90d,
                "active_tech_count": acct.active_tech_count,
                "it_spend": acct.it_spend,
                "patents_granted": acct.patents_granted,
                "trademarks_registered": acct.trademarks_registered,
                "funding": {
                    "total_usd": acct.total_funding_amount_usd,
                    "currency": acct.total_funding_currency,
                    "last_type": acct.last_funding_type,
                    "last_date": acct.last_funding_date.isoformat() if acct.last_funding_date else None,
                    "num_rounds": acct.num_funding_rounds,
                    "status": acct.funding_status
                },
                "ipo": {
                    "status": acct.ipo_status,
                    "date": acct.ipo_date.isoformat() if acct.ipo_date else None
                },
                "traffic": {
                    "global_rank": acct.global_traffic_rank,
                    "monthly_visits": acct.monthly_visits,
                    "bounce_rate": acct.bounce_rate,
                    "visit_duration": acct.visit_duration,
                    "page_views_per_visit": acct.page_views_per_visit
                },
                "leadership_counts": {
                    "c_suite": acct.c_suite_count,
                    "vp": acct.vp_count,
                    "director": acct.director_count,
                    "manager": acct.manager_count
                },
                "multi_source_intelligence": acct.multi_source_intelligence
            }
        finally:
            session.close()

    def _serialize_opportunity_signal(sig: OpportunitySignal, now: datetime) -> Dict[str, Any]:
        return {
            "id": sig.id,
            "category": sig.category,
            "signal_key": sig.signal_key,
            "title": sig.title,
            "details": sig.details or {},
            "status": sig.status,
            "first_seen": sig.first_seen.isoformat() if sig.first_seen else None,
            "last_seen": sig.last_seen.isoformat() if sig.last_seen else None,
            "is_new": bool(sig.first_seen and (now - sig.first_seen).days < 3)
        }

    @app.get("/api/accounts/{account_id}/opportunities", tags=["1. Accounts"])
    def get_account_opportunity_signals(account_id: int):
        """Retrieve the persisted history of growth-whitespace themes and domain-expansion
        product ideas detected for an account, including ones no longer actively recurring."""
        session = get_session()
        try:
            now = datetime.now(timezone.utc)
            signals = (session.query(OpportunitySignal)
                       .filter_by(account_id=account_id)
                       .order_by(OpportunitySignal.first_seen.desc())
                       .all())
            by_category: Dict[str, List[Dict[str, Any]]] = {"growth_theme": [], "domain_expansion": []}
            for s in signals:
                by_category.setdefault(s.category, []).append(_serialize_opportunity_signal(s, now))
            return {"account_id": account_id, **by_category}
        finally:
            session.close()

    @app.post("/api/accounts/{account_id}/opportunities/sync", tags=["1. Accounts"])
    def sync_account_opportunity_signals(account_id: int, req: OpportunitySignalSyncRequest):
        """Upsert the currently-detected opportunity signals for one category (growth_theme or
        domain_expansion). Signals no longer present in `items` are marked inactive rather than
        deleted, so the account keeps a full history of what has been suggested over time."""
        if req.category not in ("growth_theme", "domain_expansion"):
            raise HTTPException(status_code=400, detail="category must be 'growth_theme' or 'domain_expansion'.")
        session = get_session()
        try:
            now = datetime.now(timezone.utc)
            existing = (session.query(OpportunitySignal)
                        .filter_by(account_id=account_id, category=req.category)
                        .all())
            existing_by_key = {s.signal_key: s for s in existing}
            seen_keys = set()
            for item in req.items:
                seen_keys.add(item.signal_key)
                sig = existing_by_key.get(item.signal_key)
                if sig:
                    sig.title = item.title
                    sig.details = item.details
                    sig.status = "active"
                    sig.last_seen = now
                else:
                    sig = OpportunitySignal(
                        account_id=account_id, category=req.category, signal_key=item.signal_key,
                        title=item.title, details=item.details, status="active",
                        first_seen=now, last_seen=now
                    )
                    session.add(sig)
                    existing_by_key[item.signal_key] = sig
            for key, sig in existing_by_key.items():
                if key not in seen_keys and sig.status != "inactive":
                    sig.status = "inactive"
            session.commit()
            signals = (session.query(OpportunitySignal)
                       .filter_by(account_id=account_id, category=req.category)
                       .order_by(OpportunitySignal.first_seen.desc())
                       .all())
            return {
                "account_id": account_id,
                "category": req.category,
                "signals": [_serialize_opportunity_signal(s, now) for s in signals]
            }
        except HTTPException:
            raise
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Opportunity signal sync failed: {str(e)}")
        finally:
            session.close()

    @app.get("/api/content", tags=["4. Content Intelligence"])
    def get_content_intelligence():
        """Retrieve aggregated social listening posts and LLM channel digests."""
        session = get_session()
        try:
            digests_by_key = {}
            try:
                for d in session.query(Digest).all():
                    digests_by_key[d.target_key] = {
                        "target_key": d.target_key,
                        "kind": d.kind,
                        "priority": d.priority,
                        "llm": d.llm,
                        "posts_considered": d.posts_considered,
                        "generated_at": d.generated_at.isoformat() if d.generated_at else None,
                        "digest": d.digest
                    }
            except Exception:
                digests_by_key = {}

            posts_by_key = {}
            try:
                for p in session.query(Post).order_by(Post.target_key, Post.channel, Post.rank).all():
                    posts_by_key.setdefault(p.target_key, []).append({
                        "id": p.id,
                        "channel": p.channel,
                        "post_key": p.post_key,
                        "rank": p.rank,
                        "post_url": p.post_url,
                        "body": p.body,
                        "author": p.author,
                        "published_at": p.published_at,
                        "engagement": p.engagement,
                        "media": p.media,
                        "new_in_last_run": p.new_in_last_run,
                        "first_seen": p.first_seen.isoformat() if p.first_seen else None,
                        "last_seen": p.last_seen.isoformat() if p.last_seen else None
                    })
            except Exception:
                posts_by_key = {}

            return {"digests": digests_by_key, "posts": posts_by_key}
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # FRONTEND STATIC UI MOUNT
    # ══════════════════════════════════════════════════════
    from fastapi.staticfiles import StaticFiles
    frontend_dir = Path(__file__).resolve().parent / "frontend"
    if frontend_dir.exists():
        app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")


if __name__ == "__main__":
    if FASTAPI_AVAILABLE:
        import uvicorn
        print("=" * 70)
        print("[*] Starting Sales AI Granular REST API Server on http://0.0.0.0:8000")
        print("[*] Interactive Swagger API Documentation: http://localhost:8000/docs")
        print("=" * 70)
        uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
    else:
        print("[!] FastAPI/uvicorn not installed. Run: pip install -r requirements.txt")
