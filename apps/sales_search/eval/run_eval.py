"""Search palette ranking eval against the live database. Read-only, no LLM, no writes.

  * top-hit accuracy  — the expected result is the first item of its group (or within `top`)
  * empty accuracy    — junk queries return nothing
  * ACL leaks         — a user granted one account never sees another account's rows (must be 0)
  * latency           — p50 / p95 of /suggest, warm (second pass)

Cases reference real rows of the current database; update them when the data is re-seeded.

    python -m apps.sales_search.eval.run_eval
"""

import statistics
import sys
import time
import types

from apps.sales_copilot import retrieve
from apps.sales_search import api as sa
from db.connection import get_session

GATES = {"top_hit_accuracy": 0.9, "empty_accuracy": 1.0, "acl_leaks": 0, "p95_ms": 150}

# (query, group key, expected substring of the item's title or subtitle, must be within top-N of that
#  group, current account or None)
CASES = [
    # people — full name, first / last name, typo
    ("robin vince", "people", "Robin Vince", 1, None),
    ("robin", "people", "Robin Vince", 2, None),
    ("vince", "people", "Robin Vince", 3, None),
    ("robn vince", "people", "Robin Vince", 1, None),
    ("larry fink", "people", "Larry Fink", 1, None),
    ("fink", "people", "Fink", 1, None),
    ("kapito", "people", "Robert S. Kapito", 1, None),
    ("sonali", "people", "Sonali Bhatnagar", 1, None),
    ("bhatnagar", "people", "Sonali Bhatnagar", 1, None),
    # accounts — display name, alias, legal name, ticker, typo
    ("bny", "accounts", "BNY", 1, None),
    ("bny mellon", "accounts", "BNY", 1, None),
    ("bank of new york", "accounts", "BNY", 1, None),
    ("blk", "accounts", "BlackRock", 1, None),
    ("ntrs", "accounts", "Northern Trust", 1, None),
    ("blakrock", "accounts", "BlackRock", 1, None),
    ("blackrok", "accounts", "BlackRock", 1, None),
    ("northern", "accounts", "Northern Trust", 1, None),
    ("vanguard", "accounts", "The Vanguard Group", 1, None),
    ("depository trust", "accounts", "Depository Trust & Clearing", 1, None),
    # business units — incl. a name stored with non-breaking spaces
    ("newton investment", "lobs", "Newton Investment Management", 1, None),
    ("walter scott", "lobs", "Walter Scott", 1, None),
    ("standish", "lobs", "Standish Mellon Asset Management", 1, None),
    ("mellon investments switzerland", "lobs", "MELLON INVESTMENTS SWITZERLAND", 1, None),
    # signals — exact, prefix, words in any order
    ("collateral management", "signals", "Collateral management", 1, None),
    ("tokenization", "signals", "Tokenization", 2, None),
    ("post-quantum", "signals", "Post-Quantum Cryptography", 1, None),
    ("cryptography quantum", "signals", "Post-Quantum Cryptography", 1, None),
    # action items
    ("allianz", "tasks", "Allianz Global Investors", 1, None),
    ("follow up mellon", "tasks", "Follow up with THE BANK OF NEW YORK MELLON", 1, None),
    # titles reach the people group
    ("lead manager", "people", "Lead Manager", 3, None),
    # current-account boost must not hide an exact match elsewhere
    ("robin vince", "people", "Robin Vince", 1, 27),
]

EMPTY_CASES = ["zzqx", "%%", "__", "qwxzvb plorf"]

ACL_ACCOUNT = 11          # BNY — the restricted user is granted only this account
ACL_QUERIES = ["blackrock", "fink", "vanguard", "northern", "robin", "management"]


def _suggest(s, user, q, account_id=None):
    return sa.suggest(q=q, account_id=account_id, user=user, s=s)


def main() -> int:
    s = get_session()
    admin = types.SimpleNamespace(id=0, role="super_admin")
    sa._TRGM = s.execute(sa.text("SELECT count(*) FROM pg_extension WHERE extname = 'pg_trgm'")).scalar() == 1
    print(f"pg_trgm: {'on' if sa._TRGM else 'OFF (typo cases will fail)'}\n")
    failures = []

    hits = 0
    for q, group, expect, top, cur in CASES:
        groups = {g["key"]: g["items"] for g in _suggest(s, admin, q, cur)["groups"]}
        items = groups.get(group, [])
        titles = [i["title"] for i in items]
        rank = next((n for n, i in enumerate(items, 1)
                     if expect.lower() in f"{i['title']} {i.get('subtitle', '')}".lower()), None)
        ok = rank is not None and rank <= top
        hits += ok
        if not ok:
            failures.append(f"  [{q}] expected '{expect}' in top {top} of {group}, got rank {rank}: {titles[:4]}")

    empty_ok = 0
    for q in EMPTY_CASES:
        groups = _suggest(s, admin, q)["groups"]
        empty_ok += not groups
        if groups:
            failures.append(f"  [{q}] expected no results, got {[(g['key'], len(g['items'])) for g in groups]}")

    # Restricted user: same ACL path as production, with the grant lookup pinned to one account.
    restricted = types.SimpleNamespace(id=-1, role="user")
    real_lookup = retrieve.auth.get_accessible_account_ids
    retrieve.auth.get_accessible_account_ids = lambda _s, _uid: [ACL_ACCOUNT]
    leaks = 0
    try:
        for q in ACL_QUERIES:
            for g in _suggest(s, restricted, q)["groups"]:
                bad = [i for i in g["items"] if i["account_id"] != ACL_ACCOUNT]
                leaks += len(bad)
                if bad:
                    failures.append(f"  ACL leak [{q}] {g['key']}: {[(i['title'], i['account_id']) for i in bad]}")
    finally:
        retrieve.auth.get_accessible_account_ids = real_lookup

    timings = []
    for _ in range(2):                       # first pass warms caches; keep the second
        timings = []
        for q, *_ in CASES:
            t = time.perf_counter()
            _suggest(s, admin, q)
            timings.append((time.perf_counter() - t) * 1000)
    timings.sort()
    s.close()

    metrics = {
        "top_hit_accuracy": round(hits / len(CASES), 3),
        "empty_accuracy": round(empty_ok / len(EMPTY_CASES), 3),
        "acl_leaks": leaks,
        "p50_ms": round(statistics.median(timings), 1),
        "p95_ms": round(timings[int(len(timings) * 0.95) - 1], 1),
    }
    passed = (metrics["top_hit_accuracy"] >= GATES["top_hit_accuracy"]
              and metrics["empty_accuracy"] >= GATES["empty_accuracy"]
              and metrics["acl_leaks"] <= GATES["acl_leaks"]
              and metrics["p95_ms"] <= GATES["p95_ms"])

    print(f"cases: {len(CASES)} ranking, {len(EMPTY_CASES)} empty, {len(ACL_QUERIES)} ACL")
    for k, v in metrics.items():
        gate = GATES.get(k)
        print(f"  {k:<18} {v}" + (f"   (gate {'<=' if k in ('acl_leaks', 'p95_ms') else '>='} {gate})" if gate is not None else ""))
    if failures:
        print("\nfailures:")
        print("\n".join(failures))
    print(f"\n{'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
