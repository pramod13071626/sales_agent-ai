"""Lob Repository — UPSERT operations for the lobs and sub_lobs tables."""

from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from db.models.lob import Lob
from db.models.sub_lob import SubLob
from db.models.account import Account
from db.schemas.lob_schema import LobSchema
from db.schemas.sub_lob_schema import SubLobSchema


class LobRepository:
    """Handles all database operations for the Lob and SubLob tables."""

    def __init__(self, session: Session):
        self.session = session

    def upsert_all(self, account: Account, lobs_data: List[dict],
                   social_doc: Optional[dict] = None) -> Dict[str, int]:
        """
        Replaces all LOBs for an account. Returns mapping of lob_name -> lob.id.
        Also creates sub_lobs for each LOB.
        """
        # Clear existing LOBs (cascade removes sub_lobs + persona FK nulls)
        self.session.query(Lob).filter_by(account_id=account.id).delete()
        self.session.flush()

        lobs_scraping = []
        if social_doc:
            lobs_scraping = social_doc.get("lobs_scraping_urls", []) or []

        lob_map = {}

        for i, lob_data in enumerate(lobs_data):
            # Get matching social URLs
            social_urls = {}
            if i < len(lobs_scraping):
                social_urls = lobs_scraping[i].get("scraping_target_urls", {}) or {}

            # Validate through schema
            schema = LobSchema.from_enriched_json(lob_data, social_urls)

            # Create ORM object
            lob = Lob(account_id=account.id)
            data = schema.model_dump()
            for field, value in data.items():
                if hasattr(lob, field):
                    setattr(lob, field, value)

            self.session.add(lob)
            self.session.flush()
            lob_map[lob.lob_name] = lob.id

            # Sub-LOBs
            for sub in (lob_data.get("sub_lobs") or []):
                sub_schema = SubLobSchema.from_raw(sub)
                sub_lob = SubLob(
                    lob_id=lob.id,
                    name=sub_schema.name,
                    metadata_=sub_schema.metadata_
                )
                self.session.add(sub_lob)

        self.session.flush()
        return lob_map

    def get_by_account(self, account_id: int) -> list[Lob]:
        """Get all LOBs for an account."""
        return self.session.query(Lob).filter_by(account_id=account_id).all()

    def count(self) -> int:
        """Count total LOBs."""
        return self.session.query(Lob).count()
