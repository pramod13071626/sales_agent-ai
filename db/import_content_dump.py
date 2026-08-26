"""
One-off importer for an external content-intelligence dump (posts + digests tables)
produced by a separate scraping/LLM tool, into this project's sales_ai database.

Usage: python db/import_content_dump.py "C:\\path\\to\\dump.sql"
"""

import io
import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE_ROOT))

from db.connection import engine

COPY_TABLES = {
    "public.digests": "digests",
    "public.posts": "posts",
}


def extract_copy_blocks(sql_text: str):
    """Finds each `COPY <table> (<cols>) FROM stdin;` block and returns
    (table, columns, tsv_payload) for tables we care about."""
    lines = sql_text.splitlines(keepends=True)
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("COPY "):
            header = line.strip()
            # e.g. COPY public.digests (target_key, kind, ...) FROM stdin;
            table_part = header[len("COPY "):header.index("(")].strip()
            cols_part = header[header.index("(") + 1: header.index(")")]
            columns = [c.strip() for c in cols_part.split(",")]
            j = i + 1
            payload_lines = []
            while j < len(lines) and lines[j].rstrip("\n") != "\\.":
                payload_lines.append(lines[j])
                j += 1
            if table_part in COPY_TABLES:
                blocks.append((COPY_TABLES[table_part], columns, "".join(payload_lines)))
            i = j + 1
        else:
            i += 1
    return blocks


def main(dump_path: str):
    text = Path(dump_path).read_text(encoding="utf-8")
    blocks = extract_copy_blocks(text)
    if not blocks:
        print("[!] No matching COPY blocks (public.digests / public.posts) found in dump.")
        return

    raw_conn = engine.raw_connection()
    try:
        cur = raw_conn.cursor()
        for table, columns, payload in blocks:
            col_list = ", ".join(columns)
            copy_sql = f"COPY {table} ({col_list}) FROM STDIN"
            buf = io.StringIO(payload)
            cur.copy_expert(copy_sql, buf)
            cur.execute(f"SELECT count(*) FROM {table};")
            total = cur.fetchone()[0]
            print(f"[DB] Loaded into '{table}': {len(payload.splitlines())} row(s) from dump (table now has {total} total).")
        raw_conn.commit()

        # keep posts_id_seq ahead of the max imported id so future inserts don't collide
        cur.execute("SELECT setval('posts_id_seq', COALESCE((SELECT MAX(id) FROM posts), 1));")
        raw_conn.commit()
        print("[DB] posts_id_seq synced to current MAX(id).")
    except Exception as e:
        raw_conn.rollback()
        print(f"[!] Import failed, rolled back: {e}")
        raise
    finally:
        raw_conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python db/import_content_dump.py <path-to-dump.sql>")
        sys.exit(1)
    main(sys.argv[1])
