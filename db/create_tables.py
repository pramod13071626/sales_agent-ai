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

if __name__ == "__main__":
    print("[DB] Dropping all existing tables...")
    Base.metadata.drop_all(bind=engine)

    print("[DB] Creating 4-table schema in sales_ai database...")
    Base.metadata.create_all(bind=engine)

    from sqlalchemy import inspect
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print(f"[DB] Tables in database: {len(tables)}")
    for t in sorted(tables):
        cols = inspector.get_columns(t)
        print(f"     - {t} ({len(cols)} columns)")

    print("[DB] Schema migration complete!")
