"""Sales Copilot CLI.

    python -m apps.sales_copilot.cli init            # create/upgrade tables (idempotent)
    python -m apps.sales_copilot.cli sync            # render + dedup + version + embed + index (idempotent)
    python -m apps.sales_copilot.cli maintain        # sync + drain outbox + retention/GC (what the API runs nightly)
    python -m apps.sales_copilot.cli models          # check configured OpenRouter models are still listed and free
    python -m apps.sales_copilot.cli eval            # golden-set evaluation (no LLM requests)
    python -m apps.sales_copilot.cli stats           # docs / chunks / vectors / duplicates check
    python -m apps.sales_copilot.cli search "text" [--account ID] [--persona ID]
    python -m apps.sales_copilot.cli ask "question" [--user ID] [--persona ID] [--account ID]

With the embedded Chroma store (no COPILOT_CHROMA_URL), run `sync` here only while the
API server is stopped — otherwise use the admin "Sync now" endpoint, which runs inside
the API process that owns the store.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["init", "sync", "maintain", "stats", "search", "ask", "models", "eval"])
    ap.add_argument("text", nargs="?")
    ap.add_argument("--account", type=int)
    ap.add_argument("--persona", type=int)
    ap.add_argument("--user", type=int)
    args = ap.parse_args()

    from apps.sales_copilot import ingest
    if args.command == "init":
        ingest.ensure_schema()
        print("schema ok")
    elif args.command == "sync":
        print(json.dumps(ingest.sync(), indent=2, default=str))
    elif args.command == "maintain":
        from apps.sales_copilot import sync
        print(json.dumps(sync.process(force_full=True), indent=2, default=str))
    elif args.command == "models":
        from apps.sales_copilot import llm
        print(json.dumps(llm.check_models(), indent=2))
    elif args.command == "eval":
        from apps.sales_copilot.eval import run_eval
        run_eval.main()
    elif args.command == "stats":
        from apps.sales_copilot import retrieve
        print(json.dumps(retrieve.index_stats(), indent=2, default=str))
    elif args.command == "search":
        from apps.sales_copilot import retrieve
        from db.connection import get_session
        s = get_session()
        try:
            acl = retrieve.all_account_ids(s)
            for h in retrieve.search(s, args.text, acl, persona_id=args.persona,
                                     account_ids=[args.account] if args.account else None):
                print(f"{h['score']:.4f} [{h['doc_type']}] {h['title'][:70]} | {h['snippet'][:110]}")
        finally:
            s.close()
    elif args.command == "ask":
        from apps.sales_copilot import chat
        from db.connection import get_session
        from db.models.user import User
        s = get_session()
        try:
            user = s.query(User).get(args.user) if args.user else s.query(User).filter_by(role="super_admin").first()
            out = chat.handle_message(s, user, args.text, None,
                                      {"persona_id": args.persona, "account_id": args.account})
            print(json.dumps(out, indent=2, default=str)[:6000])
        finally:
            s.close()


if __name__ == "__main__":
    main()
