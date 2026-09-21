"""
TelemetryService — Enterprise Credit Consumption & API Usage Engine.
Tracks, aggregates, and serves granular resource consumption metrics for:
- Level 1: Account Ingestion (Diffbot, Serper, Finnhub, SEC EDGAR, GLEIF)
- Level 2: Lines of Business (Apify LinkedIn Company, Tavily AI, Google Patents)
- Level 3: Executive Personas (Apify Profile Scraper, Exa, Gemini LLM)
Zero Hardcoding • Pure Metered Telemetry.
"""

from datetime import datetime, timezone
from typing import Dict, Any, Optional
from db.connection import get_session
from db.models.pipeline_run import PipelineRun
from db.models.account import Account
from services.credit_accounting_engine import CreditAccountingEngine


class TelemetryService:
    @staticmethod
    def mask_key(prefix: str, key_val: Optional[str], default_tail: str = "4Kd2") -> str:
        """Returns enterprise-masked API key string for audit displays."""
        if not key_val:
            return f"API Key {prefix}_unconfigured"
        clean = str(key_val).strip()
        if len(clean) <= 8:
            return f"API Key {prefix}_...{clean[-4:]}"
        return f"API Key {prefix}_{clean[:4]}...{clean[-4:]}"

    @classmethod
    def get_run_credit_breakdown(
        cls, account_id: Optional[int] = None, company_name: Optional[str] = None, run_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Compiles the complete tiered credit usage breakdown matching the enterprise modal design.
        Queries real database records from PostgreSQL pipeline_runs table.
        If no runs exist for the target account, returns authentic Zero-State.
        """
        session = get_session()
        target_name = company_name or "Account"
        acct_obj = None

        try:
            if account_id:
                acct_obj = session.query(Account).filter_by(id=account_id).first()
                if acct_obj and not company_name:
                    target_name = acct_obj.display_name or acct_obj.legal_name or acct_obj.key or "Account"
            elif company_name:
                acct_obj = session.query(Account).filter(
                    (Account.display_name.ilike(company_name)) | (Account.legal_name.ilike(company_name)) | (Account.key.ilike(company_name))
                ).first()

            latest_run = None
            if run_id:
                latest_run = session.query(PipelineRun).filter_by(run_id=run_id).first()
            elif target_name and target_name != "Account":
                latest_run = (
                    session.query(PipelineRun)
                    .filter(
                        PipelineRun.company_name.ilike(f"%{target_name}%"),
                        ~PipelineRun.run_id.contains("purge")
                    )
                    .order_by(PipelineRun.started_at.desc())
                    .first()
                )

            # If no execution run exists for this account, return Zero-State
            if not latest_run:
                return CreditAccountingEngine.build_empty_breakdown(target_name)

            # If the database record already has the structured credits_breakdown
            cb = latest_run.credits_breakdown or {}
            if isinstance(cb, dict) and cb.get("sections") and cb.get("grand_total"):
                cb["company_name"] = target_name
                cb["run_id"] = latest_run.run_id
                cb["status"] = latest_run.status
                return cb

            total_cr = int(latest_run.total_credits_used or 0)
            entities = latest_run.entities_extracted or {}
            duration = float(latest_run.duration_seconds or 0.0)

            if total_cr == 0 and not any(entities.values()):
                return CreditAccountingEngine.build_empty_breakdown(target_name)

            acct_tally = CreditAccountingEngine.tally_account_telemetry(
                entities.get("telemetry_sources", {})
            )
            lobs_count = entities.get("total_lobs") or entities.get("known_lobs_count") or (1 if getattr(latest_run, "pipeline_level", "") == "lob" else 0)
            lob_tally = CreditAccountingEngine.tally_lob_telemetry(lobs_count)
            personas_count = entities.get("total_contacts") or entities.get("known_personas_count") or (1 if getattr(latest_run, "pipeline_level", "") == "persona" else 0)
            persona_tally = CreditAccountingEngine.tally_persona_telemetry(personas_count)

            db_run_count = session.query(PipelineRun).filter(
                PipelineRun.company_name.ilike(f"%{target_name}%"),
                ~PipelineRun.run_id.contains("purge")
            ).count()

            return CreditAccountingEngine.compile_run_breakdown(
                company_name=target_name,
                run_id=latest_run.run_id,
                run_number=max(1, db_run_count),
                started_at=latest_run.started_at,
                duration_seconds=duration,
                status=latest_run.status or "Completed",
                account_tally=acct_tally,
                lob_tally=lob_tally,
                persona_tally=persona_tally,
            )

        except Exception as e:
            print(f"[!] [TelemetryService] Error retrieving breakdown: {e}")
            return CreditAccountingEngine.build_empty_breakdown(target_name)
        finally:
            session.close()
