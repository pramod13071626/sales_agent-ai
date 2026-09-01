"""Pydantic Schema for PipelineRun validation & serialization."""

from datetime import datetime
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class PipelineRunSchema(BaseModel):
    run_id: str
    company_name: str
    target_url: Optional[str] = None
    status: str = "staged"
    quality_score: float = 0.0
    quality_grade: str = "N/A"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_seconds: float = 0.0
    total_credits_used: int = 0
    credits_breakdown: Dict[str, Any] = Field(default_factory=dict)
    entities_extracted: Dict[str, Any] = Field(default_factory=dict)
    raw_storage_dir: Optional[str] = None
    enriched_storage_dir: Optional[str] = None
    execution_logs: List[Dict[str, Any]] = Field(default_factory=list)
    error_message: Optional[str] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_telemetry_dict(cls, data: Dict[str, Any], raw_storage_dir: str = None, enriched_storage_dir: str = None):
        return cls(
            run_id=data.get("run_id"),
            company_name=data.get("company_name"),
            target_url=data.get("target_url"),
            status=data.get("status", "staged"),
            quality_score=float(data.get("quality_score", 0.0)),
            quality_grade=data.get("quality_grade", "N/A"),
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else None,
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None,
            duration_seconds=float(data.get("duration_seconds", 0.0)),
            total_credits_used=int(data.get("total_credits_used", 0)),
            credits_breakdown=data.get("credits_breakdown", {}),
            entities_extracted=data.get("entities_extracted", {}),
            raw_storage_dir=raw_storage_dir,
            enriched_storage_dir=enriched_storage_dir,
            execution_logs=data.get("execution_logs", []),
            error_message=data.get("error_message")
        )
