"""Background index maintenance (README §7.2–7.4, §8.1.1).

* Every SYNC_INTERVAL_SECONDS: if the trigger-fed rag_outbox has pending rows,
  run the hash-diff sync (ingest.sync) and mark those rows processed. The diff
  renders the corpus (~3 s here) and only embeds text that actually changed.
* Every FULL_RECONCILE_HOURS: run the sync even with an empty outbox (catches
  anything that bypassed triggers — dumps, bulk loads) and apply retention (gc).

A Postgres advisory lock guarantees one runner at a time across processes; with
the embedded Chroma store the runner must be the API process (it owns the store).
"""

import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from apps.sales_copilot import ingest, settings, store
from db.connection import engine

LOCK_KEY = 872_451_901          # arbitrary app-wide advisory lock id
_state: Dict[str, Any] = {"running": False, "last_run": None, "last_result": None, "last_error": None,
                          "last_gc": None, "thread_started": False}


def state() -> Dict[str, Any]:
    return dict(_state)


def _last_full(cur) -> Optional[datetime]:
    cur.execute("SELECT last_reconcile_at FROM rag_sync_state WHERE source_table = '*'")
    r = cur.fetchone()
    return r[0] if r else None


def process(force_full: bool = False, log=print) -> Optional[Dict[str, Any]]:
    """Run one maintenance pass if there is work. Returns stats, or None if skipped."""
    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_KEY,))
        if not cur.fetchone()[0]:
            return None                       # another process is syncing
        try:
            ingest.ensure_schema()
            cur.execute("SELECT max(id), count(*) FROM rag_outbox WHERE processed_at IS NULL")
            max_id, pending = cur.fetchone()
            last = _last_full(cur)
            full_due = force_full or last is None or \
                (datetime.now(timezone.utc) - last).total_seconds() > settings.FULL_RECONCILE_HOURS * 3600
            if not pending and not full_due:
                return None
            _state.update(running=True, last_error=None)
            result = ingest.sync(log=log)
            result["outbox_processed"] = pending or 0
            if max_id:
                cur.execute("UPDATE rag_outbox SET processed_at = now() WHERE id <= %s AND processed_at IS NULL", (max_id,))
            cur.execute("DELETE FROM rag_outbox WHERE processed_at < now() - interval '7 days'")
            conn.commit()
            if full_due:
                result["gc"] = gc(conn, log=log)
                _state["last_gc"] = datetime.now(timezone.utc).isoformat()
            _state.update(last_run=datetime.now(timezone.utc).isoformat(), last_result=result)
            return result
        finally:
            cur.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))
            conn.commit()
            _state["running"] = False
    except Exception as e:
        _state["last_error"] = f"{type(e).__name__}: {e}"[:500]
        log(f"[copilot] sync failed: {_state['last_error']}")
        raise
    finally:
        conn.close()


def gc(conn, log=print) -> Dict[str, int]:
    """Retention per README §8.1.1. Current versions and chat-cited versions are never removed."""
    s = settings
    cur = conn.cursor()
    out: Dict[str, int] = {}
    pinned = """SELECT DISTINCT (c ->> 'document_id')::bigint FROM copilot_messages m,
                jsonb_array_elements(coalesce(m.citations, '[]'::jsonb)) c WHERE c ? 'document_id'"""

    # Events: previous renderings kept 30 days
    cur.execute(f"""DELETE FROM rag_documents WHERE NOT is_current AND doc_type <> ALL(%s)
                    AND valid_to < now() - make_interval(days => %s) AND id NOT IN ({pinned})""",
                (list(s.ENTITY_DOC_TYPES), s.RETAIN_EVENT_PREV_DAYS))
    out["event_versions"] = cur.rowcount
    # Entity facts: all versions 13 months; then the last version per quarter up to 3 years; then gone
    cur.execute(f"""DELETE FROM rag_documents d WHERE NOT is_current AND doc_type = ANY(%s)
                    AND valid_to < now() - make_interval(months => %s) AND id NOT IN ({pinned})
                    AND (valid_to < now() - make_interval(years => %s)
                         OR id NOT IN (SELECT DISTINCT ON (canonical_key, date_trunc('quarter', valid_from)) id
                                       FROM rag_documents WHERE NOT is_current
                                       ORDER BY canonical_key, date_trunc('quarter', valid_from), valid_from DESC))""",
                (list(s.ENTITY_DOC_TYPES), s.RETAIN_ENTITY_FULL_MONTHS, s.RETAIN_ENTITY_QUARTERLY_YEARS))
    out["entity_versions"] = cur.rowcount
    # Tombstones (source deleted) kept 30 days
    cur.execute(f"""DELETE FROM rag_documents WHERE deleted_at < now() - make_interval(days => %s)
                    AND id NOT IN ({pinned})""", (s.RETAIN_TOMBSTONE_DAYS,))
    out["tombstones"] = cur.rowcount
    # Orphan chunks (no document uses them) -> also out of Chroma
    cur.execute("""SELECT c.chunk_hash FROM rag_chunks c
                   WHERE c.created_at < now() - make_interval(days => %s)
                     AND NOT EXISTS (SELECT 1 FROM rag_document_chunks dc WHERE dc.chunk_hash = c.chunk_hash)""",
                (s.ORPHAN_CHUNK_DAYS,))
    orphans = [bytes(r[0]) for r in cur.fetchall()]
    if orphans:
        cur.execute("SELECT chunk_hash, account_id FROM rag_index_entries WHERE chunk_hash = ANY(%s)", (orphans,))
        ids = [store.record_id(bytes(h), a) for h, a in cur.fetchall()]
        if ids:
            store.delete(settings.collection_name(), ids)
        cur.execute("DELETE FROM rag_chunks WHERE chunk_hash = ANY(%s)", (orphans,))
    out["orphan_chunks"] = len(orphans)
    # Chats older than 12 months; soft-deleted notes after 30 days
    cur.execute("DELETE FROM copilot_sessions WHERE coalesce(last_message_at, created_at) < now() - make_interval(months => %s)",
                (s.RETAIN_CHAT_MONTHS,))
    out["chats"] = cur.rowcount
    cur.execute("DELETE FROM copilot_memories WHERE deleted_at < now() - make_interval(days => %s)",
                (s.RETAIN_DELETED_NOTES_DAYS,))
    out["notes"] = cur.rowcount
    cur.execute("DELETE FROM copilot_memories WHERE expires_at < now() - interval '30 days'")
    out["expired_reminders"] = cur.rowcount
    conn.commit()
    log(f"[copilot] gc: {out}")
    return out


def start_background() -> None:
    if not settings.AUTOSYNC or _state["thread_started"]:
        return
    _state["thread_started"] = True

    def loop():
        time.sleep(30)                         # let the API finish starting
        while True:
            try:
                process()
            except Exception:
                pass                           # recorded in _state; retry next tick
            time.sleep(settings.SYNC_INTERVAL_SECONDS)

    threading.Thread(target=loop, name="copilot-autosync", daemon=True).start()
