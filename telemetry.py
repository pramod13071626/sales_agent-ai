"""
Run Telemetry & Credit Tracker — Tracks API credit consumption, request latency, and execution logs.
100% Dynamic, Zero Hardcoding.

Captures:
1. Vendor Credit Accounting (Apify, Diffbot, Tavily, Exa, Apollo, Serper, Firecrawl, data.gov, SEC EDGAR, GLEIF)
2. Minute-by-Minute Timestamped Execution Logs
3. Extracted Entity Counters (accounts, lobs, personas, patents, political contributions)
4. Quality Scores & Latency Performance
"""

import time
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional


class RunTelemetry:
    def __init__(self, run_id: str, company_name: str, target_url: Optional[str] = None):
        self.run_id = run_id
        self.company_name = company_name
        self.target_url = target_url
        self.started_at = datetime.now(timezone.utc)
        self.completed_at = None
        self.duration_seconds = 0.0
        self.status = "running"
        self.quality_score = 0.0
        self.quality_grade = "N/A"
        self.error_message = None

        self.total_credits_used = 0
        self.credits_breakdown: Dict[str, Dict[str, Any]] = {}
        self.entities_extracted: Dict[str, Any] = {
            "accounts_count": 0,
            "lobs_count": 0,
            "sublobs_count": 0,
            "personas_count": 0,
            "tier_breakdown": {
                "c_suite": 0,
                "vp_level": 0,
                "director_level": 0,
                "manager_level": 0
            },
            "patents_count": 0,
            "political_contributions_count": 0,
            "board_members_count": 0,
            "technologies_count": 0
        }
        self.execution_logs: List[Dict[str, Any]] = []
        self._start_perf_time = time.perf_counter()

        self.log("INFO", "INITIALIZATION", f"Initialized RunTelemetry tracker for '{company_name}' (Run ID: {run_id}).")

    def log(self, level: str, stage: str, message: str, details: Optional[Dict[str, Any]] = None):
        """Appends a structured, timestamped log entry."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level.upper(),
            "stage": stage.upper(),
            "message": message
        }
        if details:
            entry["details"] = details
        self.execution_logs.append(entry)

    def record_api_call(
        self,
        vendor: str,
        endpoint: str,
        credits_used: int = 1,
        latency_ms: int = 0,
        status: str = "200_OK",
        is_billable: bool = True
    ):
        """Records an API request and tracks credit/token consumption."""
        v = vendor.lower()
        if v not in self.credits_breakdown:
            self.credits_breakdown[v] = {
                "calls_count": 0,
                "credits_consumed": 0,
                "free_tier_requests": 0,
                "endpoints_called": [],
                "average_latency_ms": 0,
                "total_latency_ms": 0
            }

        v_data = self.credits_breakdown[v]
        v_data["calls_count"] += 1
        v_data["total_latency_ms"] += latency_ms
        v_data["average_latency_ms"] = round(v_data["total_latency_ms"] / v_data["calls_count"], 2)

        if endpoint not in v_data["endpoints_called"]:
            v_data["endpoints_called"].append(endpoint)

        if is_billable and credits_used > 0:
            v_data["credits_consumed"] += credits_used
            self.total_credits_used += credits_used
        else:
            v_data["free_tier_requests"] += 1

        api_msg = (
            f"[{v.upper()}] {endpoint} ➔ status: {status}, "
            f"credits: {credits_used if is_billable else 0}, latency: {latency_ms}ms"
        )
        self.log("INFO", "API_CALL", api_msg)

    def set_quality_audit(self, score: float, grade: str):
        """Updates quality audit results."""
        self.quality_score = round(float(score), 2)
        self.quality_grade = grade
        validator_msg = (
            f"Data Quality Audit Completed. Score: {self.quality_score}/100 "
            f"(Grade: {self.quality_grade})"
        )
        self.log("INFO", "VALIDATOR", validator_msg)

    def set_entities_extracted(
        self,
        accounts_count: int = 1,
        lobs_count: int = 0,
        sublobs_count: int = 0,
        personas_count: int = 0,
        tier_breakdown: Optional[Dict[str, int]] = None,
        patents_count: int = 0,
        political_contributions_count: int = 0,
        board_members_count: int = 0,
        technologies_count: int = 0
    ):
        """Updates extracted entities counters."""
        self.entities_extracted["accounts_count"] = accounts_count
        self.entities_extracted["lobs_count"] = lobs_count
        self.entities_extracted["sublobs_count"] = sublobs_count
        self.entities_extracted["personas_count"] = personas_count
        if tier_breakdown:
            self.entities_extracted["tier_breakdown"] = tier_breakdown
        self.entities_extracted["patents_count"] = patents_count
        self.entities_extracted["political_contributions_count"] = political_contributions_count
        self.entities_extracted["board_members_count"] = board_members_count
        self.entities_extracted["technologies_count"] = technologies_count

        summary_msg = (
            f"Extraction summary: {accounts_count} Account, {lobs_count} LOBs, "
            f"{personas_count} Personas across 4 tiers."
        )
        self.log("INFO", "SUMMARY", summary_msg)

    def complete(self, status: str = "staged", error_message: Optional[str] = None):
        """Marks the execution run as finished and computes final duration."""
        self.completed_at = datetime.now(timezone.utc)
        self.duration_seconds = round(time.perf_counter() - self._start_perf_time, 2)
        self.status = status
        self.error_message = error_message

        if error_message:
            error_msg = f"Run completed with error: {error_message}"
            self.log("ERROR", "EXECUTION", error_msg)
        else:
            completion_msg = (
                f"Run completed successfully in {self.duration_seconds}s. "
                f"Total Credits Used: {self.total_credits_used}"
            )
            self.log("INFO", "EXECUTION", completion_msg)

    def to_dict(self) -> Dict[str, Any]:
        """Serializes telemetry into a JSON-serializable dictionary."""
        return {
            "run_id": self.run_id,
            "company_name": self.company_name,
            "target_url": self.target_url,
            "status": self.status,
            "quality_score": self.quality_score,
            "quality_grade": self.quality_grade,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_seconds": self.duration_seconds,
            "total_credits_used": self.total_credits_used,
            "credits_breakdown": {
                "total_billable_credits": self.total_credits_used,
                "vendors": self.credits_breakdown
            },
            "entities_extracted": self.entities_extracted,
            "execution_logs": self.execution_logs,
            "error_message": self.error_message
        }

    def save_json(self, save_path: Path):
        """Saves telemetry report to disk."""
        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)
        print(f"[+] [RunTelemetry] Telemetry & Credit report saved to: {save_path}")
