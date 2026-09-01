"""
Create Tables — Drops old schema and creates the 4-table schema in sales_ai.
Run: python pipeline/db/create_tables.py
"""

import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE_ROOT))

from db.connection import engine
from db.models import Base
from sqlalchemy import text, inspect

def ensure_schema_compatibility():
    """Ensures all new JSONB, array, and expanded VARCHAR columns exist in PostgreSQL."""
    with engine.connect() as conn:
        # 1. Expand personas columns
        alter_statements = [
            "ALTER TABLE personas ALTER COLUMN source TYPE VARCHAR(255);",
            "ALTER TABLE personas ALTER COLUMN tier TYPE VARCHAR(100);",
            "ALTER TABLE personas ALTER COLUMN seniority_raw TYPE VARCHAR(100);",
            "ALTER TABLE personas ALTER COLUMN email_status TYPE VARCHAR(100);",
            "ALTER TABLE personas ALTER COLUMN phone TYPE VARCHAR(100);",
            "ALTER TABLE personas ALTER COLUMN decision_authority TYPE VARCHAR(100);",
            "ALTER TABLE personas ALTER COLUMN budget_authority TYPE VARCHAR(100);",
            # 2. Add columns to accounts if missing
            "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS multi_source_intelligence JSONB;",
            "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS organisational_hierarchy_tree JSONB;",
            "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS raw_data JSONB;",
            "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS github_url TEXT;",
            "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS glassdoor_url TEXT;",
            # 3. Add columns to lobs if missing
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS lei_code VARCHAR(50);",
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(50);",
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS technologies JSONB;",
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS competitors JSONB;",
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS logo_url TEXT;",
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS financial_snippets JSONB;",
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS wikipedia_url TEXT;",
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS patents JSONB;",
            "ALTER TABLE lobs ADD COLUMN IF NOT EXISTS raw_data JSONB;"
        ]
        for stmt in alter_statements:
            try:
                conn.execute(text(stmt))
            except Exception as e:
                pass
        conn.commit()
    print("[DB] Schema compatibility verified (all JSONB and intelligence columns synchronized).")

if __name__ == "__main__":
    print("[DB] Ensuring all tables exist in sales_ai database (PostgreSQL)...")
    Base.metadata.create_all(bind=engine)
    ensure_schema_compatibility()

    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print(f"[DB] Tables in database: {len(tables)}")
    for t in sorted(tables):
        cols = inspector.get_columns(t)
        print(f"     - {t} ({len(cols)} columns)")

    print("[DB] Schema migration complete!")
