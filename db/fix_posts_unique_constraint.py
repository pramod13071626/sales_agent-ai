"""One-off migration: add the missing UNIQUE (target_key, channel, post_key)
constraint to the `posts` table.

The Post ORM model (db/models/post.py) didn't declare this constraint, so
`Base.metadata.create_all()` never created it — but the upstream content
pipeline (data_scrapper's db.py) upserts with
`ON CONFLICT (target_key, channel, post_key) DO UPDATE ...`, which requires
this exact constraint to exist on whichever Postgres it targets. Without it,
every post write from that pipeline fails outright once it's pointed here.

Safe to run more than once — skips if the constraint already exists, and
refuses if existing rows would violate it (check for duplicates first if
this ever errors).

Usage: python db/fix_posts_unique_constraint.py
"""

import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE_ROOT))

from db.connection import engine

CONSTRAINT_NAME = "posts_target_key_channel_post_key_key"


def main():
    with engine.connect() as conn:
        exists = conn.exec_driver_sql(
            "SELECT 1 FROM pg_constraint WHERE conname = %s", (CONSTRAINT_NAME,)
        ).fetchone()
        if exists:
            print(f"[DB] Constraint '{CONSTRAINT_NAME}' already present — nothing to do.")
            return

        dupes = conn.exec_driver_sql(
            """
            SELECT target_key, channel, post_key, count(*) c
            FROM posts GROUP BY target_key, channel, post_key HAVING count(*) > 1
            LIMIT 5
            """
        ).fetchall()
        if dupes:
            print(f"[!] Found duplicate (target_key, channel, post_key) rows — resolve these before adding the constraint: {dupes}")
            sys.exit(1)

        conn.exec_driver_sql(
            f"ALTER TABLE posts ADD CONSTRAINT {CONSTRAINT_NAME} UNIQUE (target_key, channel, post_key)"
        )
        conn.commit()
        print(f"[DB] Added constraint '{CONSTRAINT_NAME}' to posts.")


if __name__ == "__main__":
    main()
