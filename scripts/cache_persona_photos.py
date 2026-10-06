"""Save every persona's profile photo to output/avatars/ now, before the scraped
links expire (most are LinkedIn CDN URLs that die within weeks).

Same logic and cache as GET /api/personas/{id}/photo (services/persona_photo_service.py),
so anything saved here is served instantly by the app. Read-only on the database;
only fetches public image URLs and writes files under output/avatars/.

    python scripts/cache_persona_photos.py                 # all personas not cached yet
    python scripts/cache_persona_photos.py --account-id 27 # one account
    python scripts/cache_persona_photos.py --dry-run       # just count what would be fetched
    python scripts/cache_persona_photos.py --refresh       # re-download already-cached photos too
    python scripts/cache_persona_photos.py --retry-missed  # retry ones that failed in the last 7 days
"""
import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.connection import get_session  # noqa: E402
from db.models.persona import Persona  # noqa: E402
from services import persona_photo_service as photos  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--account-id", type=int, help="only this account's personas")
    ap.add_argument("--limit", type=int, help="stop after this many personas (for a trial run)")
    ap.add_argument("--workers", type=int, default=4, help="parallel downloads (default 4; keep it low for LinkedIn)")
    ap.add_argument("--refresh", action="store_true", help="re-download photos that are already cached")
    ap.add_argument("--retry-missed", action="store_true", help="retry personas whose sources all failed recently")
    ap.add_argument("--dry-run", action="store_true", help="count what would be fetched, download nothing")
    args = ap.parse_args()

    session = get_session()
    try:
        q = session.query(Persona.id, Persona.raw_data, Persona.extended_profile)
        if args.account_id:
            q = q.filter(Persona.account_id == args.account_id)
        rows = q.order_by(Persona.id).all()
    finally:
        session.close()

    todo, already, no_source, skipped_miss = [], 0, 0, 0
    for pid, raw, ext in rows:
        urls = photos.candidates(type("P", (), {"raw_data": raw, "extended_profile": ext})())
        if not urls:
            no_source += 1
        elif photos.cached(pid) and not args.refresh:
            already += 1
        elif photos.recently_missed(pid) and not args.retry_missed:
            skipped_miss += 1
        else:
            todo.append((pid, urls))
    if args.limit:
        todo = todo[:args.limit]

    print(f"personas: {len(rows)}  |  no photo source: {no_source}  |  already cached: {already}  |  "
          f"failed in last 7 days (skipped): {skipped_miss}  |  to fetch: {len(todo)}")
    if args.dry_run or not todo:
        return 0

    saved = failed = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(photos.fetch_and_cache, pid, urls): pid for pid, urls in todo}
        for n, fut in enumerate(as_completed(futures), 1):
            try:
                ok = fut.result() is not None
            except Exception as e:   # one bad persona must not stop the batch
                print(f"  persona {futures[fut]}: {type(e).__name__}: {e}")
                ok = False
            saved += ok
            failed += not ok
            if n % 50 == 0 or n == len(todo):
                print(f"  {n}/{len(todo)}  saved {saved}  no usable image {failed}  ({time.time() - started:.0f}s)")

    print(f"\ndone: saved {saved}, no usable image {failed} (expired or blocked links — retried after 7 days, "
          f"or now with --retry-missed). Photos are in {photos.AVATAR_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
