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
        Non-destructively upserts all LOBs for an account in-place.
        Preserves existing Lob IDs, persona FK links, and sub_lobs.
        Returns mapping of lob_name -> lob.id.
        """
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

            # In-place match: check if LOB already exists for this account by name or key
            name = schema.lob_name or lob_data.get("name")
            key = schema.key

            existing = self.session.query(Lob).filter_by(account_id=account.id, lob_name=name).first()
            if not existing and key:
                existing = self.session.query(Lob).filter_by(account_id=account.id, key=key).first()

            if existing:
                lob = existing
            else:
                lob = Lob(account_id=account.id)
                self.session.add(lob)

            data = schema.model_dump()
            for field, value in data.items():
                if field == "id" and value is None:
                    continue
                if field in ("sub_lobs", "personas", "account", "account_id"):
                    continue
                if hasattr(lob, field):
                    setattr(lob, field, value)

            lob.account_id = account.id
            self.session.flush()
            if lob.lob_name:
                lob_map[lob.lob_name] = lob.id

            # In-place Sub-LOBs upsert
            for sub in (lob_data.get("sub_lobs") or []):
                sub_schema = SubLobSchema.from_raw(sub)
                if not sub_schema.name:
                    continue
                sub_exists = self.session.query(SubLob).filter_by(lob_id=lob.id, name=sub_schema.name).first()
                if not sub_exists and sub_schema.lei_code:
                    sub_exists = self.session.query(SubLob).filter_by(lob_id=lob.id, lei_code=sub_schema.lei_code).first()

                if not sub_exists:
                    sub_lob = SubLob(
                        lob_id=lob.id,
                        name=sub_schema.name,
                        legal_name=sub_schema.legal_name,
                        lei_code=sub_schema.lei_code,
                        jurisdiction=sub_schema.jurisdiction,
                        country=sub_schema.country,
                        city=sub_schema.city,
                        relationship_type=sub_schema.relationship_type,
                        status=sub_schema.status,
                        entity_level=sub_schema.entity_level,
                        parent_lob_lei=sub_schema.parent_lob_lei,
                        parent_lob_name=sub_schema.parent_lob_name or lob.lob_name,
                        domain=sub_schema.domain,
                        website_url=sub_schema.website_url,
                        is_manually_verified=sub_schema.is_manually_verified or False,
                        manually_verified_at=sub_schema.manually_verified_at,
                        metadata_=sub_schema.metadata_,
                    )
                    self.session.add(sub_lob)
                else:
                    for field in [
                        "legal_name", "lei_code", "jurisdiction", "country", "city",
                        "relationship_type", "status", "entity_level", "parent_lob_lei",
                        "parent_lob_name", "domain", "website_url"
                    ]:
                        val = getattr(sub_schema, field, None)
                        if val is not None:
                            setattr(sub_exists, field, val)
                    if sub_schema.metadata_:
                        sub_exists.metadata_ = sub_schema.metadata_

        self.session.flush()
        return lob_map

    def upsert_single_lob(self, account_id: int, lob_data: dict) -> Lob:
        """Upsert a single LOB entity and its sub-lobs."""
        name = lob_data.get("lob_name") or lob_data.get("name")
        key = lob_data.get("key") or (name.lower().replace(" ", "_") if name else "unknown_lob")

        existing = self.session.query(Lob).filter_by(account_id=account_id, lob_name=name).first()
        if not existing and key:
            existing = self.session.query(Lob).filter_by(account_id=account_id, key=key).first()

        lob = existing or Lob(account_id=account_id)
        if not existing:
            self.session.add(lob)

        schema = LobSchema.from_enriched_json(lob_data)
        data = schema.model_dump()
        for field, value in data.items():
            if field == "id" and value is None:
                continue
            if field in ("sub_lobs", "personas", "account", "account_id"):
                continue
            if hasattr(lob, field):
                setattr(lob, field, value)

        lob.account_id = account_id
        self.session.flush()

        # Sub-LOBs
        for sub in (lob_data.get("sub_lobs") or []):
            sub_schema = SubLobSchema.from_raw(sub)
            if not sub_schema.name:
                continue
            sub_exists = self.session.query(SubLob).filter_by(lob_id=lob.id, name=sub_schema.name).first()
            if not sub_exists and sub_schema.lei_code:
                sub_exists = self.session.query(SubLob).filter_by(lob_id=lob.id, lei_code=sub_schema.lei_code).first()

            if not sub_exists:
                sub_lob = SubLob(
                    lob_id=lob.id,
                    name=sub_schema.name,
                    legal_name=sub_schema.legal_name,
                    lei_code=sub_schema.lei_code,
                    jurisdiction=sub_schema.jurisdiction,
                    country=sub_schema.country,
                    city=sub_schema.city,
                    relationship_type=sub_schema.relationship_type,
                    status=sub_schema.status,
                    entity_level=sub_schema.entity_level,
                    parent_lob_lei=sub_schema.parent_lob_lei,
                    parent_lob_name=sub_schema.parent_lob_name or lob.lob_name,
                    domain=sub_schema.domain,
                    website_url=sub_schema.website_url,
                    is_manually_verified=sub_schema.is_manually_verified or False,
                    manually_verified_at=sub_schema.manually_verified_at,
                    metadata_=sub_schema.metadata_,
                )
                self.session.add(sub_lob)
            else:
                for field in [
                    "legal_name", "lei_code", "jurisdiction", "country", "city",
                    "relationship_type", "status", "entity_level", "parent_lob_lei",
                    "parent_lob_name", "domain", "website_url"
                ]:
                    val = getattr(sub_schema, field, None)
                    if val is not None:
                        setattr(sub_exists, field, val)
                if sub_schema.metadata_:
                    sub_exists.metadata_ = sub_schema.metadata_

        self.session.flush()
        return lob

    def get_by_account(self, account_id: int) -> list[Lob]:
        """Get all LOBs for an account."""
        return self.session.query(Lob).filter_by(account_id=account_id).all()

    def count(self) -> int:
        """Count total LOBs."""
        return self.session.query(Lob).count()
