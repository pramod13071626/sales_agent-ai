"""Generate token-optimized Sales Call-Prep & Battlecards for one account's personas.

See services/callprep_service.py for the A/B (individual), C (grouped) and
D (skipped) evidence levels. Re-runs are cheap: personas whose inputs haven't
changed since the last run are skipped unless --force is given.

Usage:
    python scripts/generate_callprep.py --account bank_of_new_york_mellon_corporation --dry-run
    python scripts/generate_callprep.py --account bank_of_new_york_mellon_corporation --limit 2
    python scripts/generate_callprep.py --account bank_of_new_york_mellon_corporation
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.connection import get_session
from services import callprep_service


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--account", required=True, help="accounts.key, e.g. bank_of_new_york_mellon_corporation")
    parser.add_argument("--dry-run", action="store_true", help="classify + estimate tokens; no LLM calls, no DB writes")
    parser.add_argument("--force", action="store_true", help="regenerate even when inputs are unchanged")
    parser.add_argument("--limit", type=int, help="max individual calls and max group calls (for a trial run)")
    parser.add_argument("--persona", action="append", dest="personas", help="persona key(s) to restrict to")
    parser.add_argument("--daytime", action="store_true",
                        help="run outside the 21:00-05:30 IST batch window (still only uses requests the team left unused)")
    args = parser.parse_args()

    print(f"[callprep] model={callprep_service.CALLPREP_MODEL} "
          f"key={'set' if callprep_service.OPENROUTER_API_KEY else 'MISSING'}")
    session = get_session()
    try:
        stats = callprep_service.generate_account(
            session, args.account, dry_run=args.dry_run, force=args.force,
            limit=args.limit, only_keys=args.personas, allow_daytime=args.daytime,
        )
    finally:
        session.close()
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
