import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.connection import engine
from sqlalchemy import text

fix_sql = """
DO $$
DECLARE
    rec RECORD;
    seq_name text;
    max_val bigint;
BEGIN
    FOR rec IN 
        SELECT c.table_name, c.column_name 
        FROM information_schema.columns c
        JOIN information_schema.tables t ON c.table_name = t.table_name
        WHERE t.table_schema = 'public' 
          AND c.column_default LIKE 'nextval%'
    LOOP
        seq_name := pg_get_serial_sequence('"' || rec.table_name || '"', rec.column_name);
        IF seq_name IS NOT NULL THEN
            EXECUTE format('SELECT COALESCE(MAX(%I), 0) + 1 FROM %I', rec.column_name, rec.table_name) INTO max_val;
            EXECUTE format('SELECT setval(%L, %s, false)', seq_name, max_val);
            RAISE NOTICE 'Reset sequence % for %.% to %', seq_name, rec.table_name, rec.column_name, max_val;
        END IF;
    END LOOP;
END $$;
"""

with engine.begin() as conn:
    conn.execute(text(fix_sql))

print("All database sequences checked and synchronized successfully!")
