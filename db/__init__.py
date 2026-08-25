"""
Database Package — Enterprise-grade data persistence layer for the sales_ai pipeline.

Structure:
    db/
    ├── connection.py              # Engine & Session factory
    ├── models/                    # SQLAlchemy ORM models (1 per table)
    │   ├── base.py                # Declarative Base
    │   ├── account.py             # Account (89 cols)
    │   ├── lob.py                 # Lob (17 cols)
    │   ├── sub_lob.py             # SubLob (4 cols)
    │   └── persona.py             # Persona (58 cols)
    ├── schemas/                   # Pydantic validation schemas
    │   ├── account_schema.py
    │   ├── lob_schema.py
    │   ├── sub_lob_schema.py
    │   └── persona_schema.py
    ├── repositories/              # Data access layer (UPSERT logic)
    │   ├── account_repo.py
    │   ├── lob_repo.py
    │   └── persona_repo.py
    ├── writer.py                  # High-level orchestrator
    ├── create_tables.py           # Migration script
    └── load_existing.py           # Existing data loader
"""

from db.writer import persist_to_db

__all__ = ["persist_to_db"]
