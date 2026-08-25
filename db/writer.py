"""
Database Writer — High-level orchestrator that coordinates all repositories.
Single entry point: persist_to_db(enriched_doc, social_doc)
100% Dynamic, Zero Hardcoding.
"""

from typing import Dict, Any, Optional
from db.connection import get_session
from db.schemas import AccountSchema
from db.repositories import AccountRepository, LobRepository, PersonaRepository


def persist_to_db(enriched_doc: Dict[str, Any], social_doc: Optional[Dict[str, Any]] = None):
    """
    Master entry point: persists the full pipeline output to the local PostgreSQL sales_ai database.

    Flow:
        1. Validate enriched JSON through Pydantic schemas
        2. UPSERT account via AccountRepository
        3. UPSERT LOBs + SubLOBs via LobRepository
        4. UPSERT personas via PersonaRepository
        5. Commit transaction
    """
    session = get_session()

    try:
        # 1. Validate & upsert Account
        account_schema = AccountSchema.from_enriched_json(enriched_doc)
        account_repo = AccountRepository(session)
        account = account_repo.upsert(account_schema)

        # 2. Upsert LOBs + SubLOBs
        lob_repo = LobRepository(session)
        lobs_data = enriched_doc.get("lobs", []) or []
        lob_map = lob_repo.upsert_all(account, lobs_data, social_doc)

        # 3. Upsert Personas
        persona_repo = PersonaRepository(session)
        hierarchy = enriched_doc.get("account", {}).get("hierarchy", {}) or {}
        tree_root = enriched_doc.get("account", {}).get("organisational_hierarchy_tree")
        persona_count = persona_repo.upsert_all(account, hierarchy, tree_root)

        # 4. Commit
        session.commit()

        print(f"[DB] Successfully persisted '{account.key}' to sales_ai database.")
        print(f"     Account ID: {account.id} | LOBs: {len(lob_map)} | Personas: {persona_count}")

    except Exception as e:
        session.rollback()
        print(f"[DB ERROR] Failed to persist data: {e}")
        raise
    finally:
        session.close()
