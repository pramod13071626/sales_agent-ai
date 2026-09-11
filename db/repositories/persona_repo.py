"""Persona Repository — UPSERT operations for the personas table."""

from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from db.models.persona import Persona
from db.models.account import Account
from db.schemas.persona_schema import PersonaSchema


class PersonaRepository:
    """Handles all database operations for the Persona table."""

    def __init__(self, session: Session):
        self.session = session

    def upsert_all(self, account: Account, hierarchy: Dict[str, List[dict]],
                   tree_root: Optional[dict] = None):
        """Replaces all personas for an account from the 4-tier hierarchy."""
        # Clear existing personas
        self.session.query(Persona).filter_by(account_id=account.id).delete()
        self.session.flush()

        # Build tree lookup for hierarchy metadata
        tree_lookup = {}
        if tree_root:
            self._build_tree_lookup(tree_root, tree_lookup)

        count = 0
        for tier_name in ["c_suite", "vp_level", "director_level", "manager_level"]:
            for person_data in (hierarchy.get(tier_name) or []):
                tree_info = tree_lookup.get(person_data.get("name"), {})

                # Validate through schema
                schema = PersonaSchema.from_enriched_json(person_data, tree_info)

                # Create ORM object
                persona = Persona(account_id=account.id, lob_id=None)
                data = schema.model_dump()
                for field, value in data.items():
                    if field in ("id", "account_id", "lob_id", "account", "lob") and value is None:
                        continue
                    if hasattr(persona, field):
                        setattr(persona, field, value)
                persona.account_id = account.id

                self.session.add(persona)
                count += 1

        self.session.flush()
        return count

    def upsert_lob_personas(
        self, account: Account, lob_id: int, hierarchy: Dict[str, List[dict]]
    ) -> int:
        """Appends personas belonging to a specific LOB with foreign key lob_id."""
        count = 0
        seen_keys = {
            p.key
            for p in self.session.query(Persona.key).filter_by(account_id=account.id).all()
        }

        for tier_name in ["c_suite", "vp_level", "director_level", "manager_level"]:
            for person_data in (hierarchy.get(tier_name) or []):
                schema = PersonaSchema.from_enriched_json(person_data)
                persona = Persona(account_id=account.id, lob_id=lob_id)
                data = schema.model_dump()
                for field, value in data.items():
                    if field in ("id", "account_id", "lob_id", "account", "lob") and value is None:
                        continue
                    if hasattr(persona, field):
                        setattr(persona, field, value)
                persona.account_id = account.id
                persona.lob_id = lob_id

                if persona.key and persona.key in seen_keys:
                    existing = (
                        self.session.query(Persona)
                        .filter_by(account_id=account.id, key=persona.key)
                        .first()
                    )
                    if existing and not existing.lob_id:
                        existing.lob_id = lob_id
                    continue

                self.session.add(persona)
                if persona.key:
                    seen_keys.add(persona.key)
                count += 1

        self.session.flush()
        return count

    def upsert(self, schema: PersonaSchema) -> Persona:
        """Upsert a single Persona from PersonaSchema with multi-strategy disambiguation."""
        existing = None
        if schema.id:
            existing = self.session.query(Persona).filter_by(id=schema.id).first()
        if not existing and schema.account_id and schema.external_id:
            existing = self.session.query(Persona).filter_by(account_id=schema.account_id, external_id=schema.external_id).first()
        if not existing and schema.account_id and schema.key:
            existing = self.session.query(Persona).filter_by(account_id=schema.account_id, key=schema.key).first()
        if not existing and schema.account_id and schema.full_name:
            existing = self.session.query(Persona).filter_by(account_id=schema.account_id, full_name=schema.full_name).first()
        if not existing and schema.account_id and schema.first_name:
            candidates = self.session.query(Persona).filter_by(account_id=schema.account_id, first_name=schema.first_name).all()
            for cand in candidates:
                cand_last = (cand.last_name or "").strip().replace(".", "").lower()
                schema_last = (schema.last_name or "").strip().replace(".", "").lower()
                if (
                    (len(cand_last) <= 2 and schema_last.startswith(cand_last))
                    or (len(schema_last) <= 2 and cand_last.startswith(schema_last))
                    or (cand.title and schema.title and cand.title[:15].lower() == schema.title[:15].lower())
                ):
                    existing = cand
                    break

        persona = existing or Persona(account_id=schema.account_id)
        if not existing:
            self.session.add(persona)

        data = schema.model_dump()
        for field, value in data.items():
            if field == "id" and value is None:
                continue
            if field in ("account", "lob", "account_id", "lob_id"):
                continue
            if hasattr(persona, field):
                setattr(persona, field, value)

        if schema.account_id:
            persona.account_id = schema.account_id
        if schema.lob_id:
            persona.lob_id = schema.lob_id

        self.session.flush()
        return persona

    def get_by_account(self, account_id: int) -> list[Persona]:
        """Get all personas for an account."""
        return self.session.query(Persona).filter_by(account_id=account_id).all()

    def get_by_tier(self, account_id: int, tier: str) -> list[Persona]:
        """Get personas by tier for an account."""
        return self.session.query(Persona).filter_by(
            account_id=account_id, tier=tier
        ).all()

    def count(self) -> int:
        """Count total personas."""
        return self.session.query(Persona).count()

    @staticmethod
    def _build_tree_lookup(node: dict, lookup: dict):
        """Recursively indexes the hierarchy tree by full_name."""
        name = node.get("full_name")
        if name:
            lookup[name] = {
                "hierarchy_level": node.get("hierarchy_level"),
                "decision_authority": node.get("decision_authority"),
                "budget_authority": node.get("budget_authority"),
            }
        for child in (node.get("direct_reports") or []):
            PersonaRepository._build_tree_lookup(child, lookup)
        for child in (node.get("sub_lob_business_unit_leads") or []):
            PersonaRepository._build_tree_lookup(child, lookup)
