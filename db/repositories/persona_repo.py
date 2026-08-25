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
                    if hasattr(persona, field):
                        setattr(persona, field, value)

                self.session.add(persona)
                count += 1

        self.session.flush()
        return count

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
