"""PipelineRun Repository — Handles persistence, upserts, and querying of execution runs."""

from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from db.models.pipeline_run import PipelineRun
from db.schemas.pipeline_run_schema import PipelineRunSchema


class PipelineRunRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert(self, schema: PipelineRunSchema) -> PipelineRun:
        """Inserts or updates an execution run record by run_id."""
        existing = self.session.query(PipelineRun).filter_by(run_id=schema.run_id).first()

        data_dict = schema.model_dump(exclude_unset=True)

        if existing:
            for k, v in data_dict.items():
                setattr(existing, k, v)
            existing.updated_at = datetime.now(timezone.utc)
            self.session.flush()
            return existing
        else:
            new_run = PipelineRun(**data_dict)
            self.session.add(new_run)
            self.session.flush()
            return new_run

    def get_by_run_id(self, run_id: str) -> Optional[PipelineRun]:
        """Retrieves a specific run by its run_id string."""
        return self.session.query(PipelineRun).filter_by(run_id=run_id).first()

    def list_recent_runs(self, limit: int = 50) -> List[PipelineRun]:
        """Returns the most recent runs sorted by started_at descending."""
        return (
            self.session.query(PipelineRun)
            .order_by(PipelineRun.started_at.desc())
            .limit(limit)
            .all()
        )

    def get_credits_summary(self) -> Dict[str, Any]:
        """Aggregates total credits used and runs count across all executions."""
        runs = self.session.query(PipelineRun).all()
        total_credits = sum(r.total_credits_used or 0 for r in runs)
        vendor_totals: Dict[str, int] = {}

        for r in runs:
            breakdown = r.credits_breakdown or {}
            vendors = breakdown.get("vendors", {})
            for v_name, v_info in vendors.items():
                vendor_totals[v_name] = vendor_totals.get(v_name, 0) + (v_info.get("credits_consumed", 0) if isinstance(v_info, dict) else 0)

        return {
            "total_runs_executed": len(runs),
            "total_lifetime_credits_consumed": total_credits,
            "vendor_breakdown": vendor_totals
        }
