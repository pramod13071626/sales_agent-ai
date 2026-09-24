"""Golden-set evaluation (README §13). Uses NO LLM requests, so it can run on every
change (renderer, chunker, attribution rules, embedding model, router):

  * intent accuracy        — router label vs expected
  * entity accuracy        — resolved persona vs expected
  * retrieval recall@10    — a gold document is in the top-10 search results
  * ACL leakage            — restricted users never get other accounts' documents (must be 0)
  * personal-contact leak  — no personal_email / direct_mobile_phone value appears in any
                             indexed chunk (must be 0; README §11.3)

    python -m apps.sales_copilot.cli eval
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List

from sqlalchemy import text

from apps.sales_copilot import chat, retrieve
from db.connection import get_session

GATES = {"intent_accuracy": 0.9, "recall_at_10": 0.85, "acl_leaks": 0, "pii_leaks": 0}


def _gold_hit(hits: List[Dict[str, Any]], gold: Dict[str, Any]) -> bool:
    for h in hits[:10]:
        if gold.get("account") and gold["account"] not in (h["accounts"] or []):
            continue
        if gold.get("keys") and h["canonical_key"] in gold["keys"]:
            return True
        if gold.get("doc_type") and h["doc_type"] == gold["doc_type"]:
            return True
        if gold.get("title_contains") and gold["title_contains"].lower() in (h["title"] or "").lower():
            return True
    return False


def run() -> Dict[str, Any]:
    cases = [json.loads(l) for l in (Path(__file__).parent / "golden.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    from apps.sales_copilot import privacy
    privacy.shared_lines()          # warm BEFORE opening our session (it uses its own connection)
    s = get_session()
    results, intent_ok, intent_n, ent_ok, ent_n, rec_ok, rec_n, acl_leaks = [], 0, 0, 0, 0, 0, 0, 0
    try:
        all_acl = retrieve.all_account_ids(s)
        for c in cases:
            acl = c.get("acl") or all_acl
            ents = chat.resolve_entities(s, c["q"], acl, c.get("context") or {}, [])
            intent = chat.route(c["q"], ents)
            row = {"id": c["id"], "intent": intent}
            if "intent" in c:
                intent_n += 1
                row["intent_ok"] = intent == c["intent"]
                intent_ok += row["intent_ok"]
            if "persona" in c:
                ent_n += 1
                row["persona_ok"] = bool(ents["persona"]) and ents["persona"]["id"] == c["persona"]
                ent_ok += row["persona_ok"]
            if "gold" in c or "expect_no_accounts" in c:
                p = ents["persona"]
                q = c["q"] if not p else f"{p['name']} {p.get('title', '')} {c['q']}"
                for pattern, extra in chat.QUERY_EXPANSIONS:      # same query building as chat.gather
                    if re.search(pattern, c["q"], re.I):
                        q += " " + extra
                hits = retrieve.search(s, q, acl, persona_id=(p or {}).get("id"), limit=10,
                                       account_ids=[a["id"] for a in ents["accounts"]] or None)
                if "gold" in c:
                    rec_n += 1
                    row["recall_ok"] = _gold_hit(hits, c["gold"])
                    rec_ok += row["recall_ok"]
                    if not row["recall_ok"]:
                        row["top"] = [f"{h['doc_type']}:{h['title'][:50]}" for h in hits[:5]]
                if "expect_no_accounts" in c:
                    leaked = [h["canonical_key"] for h in hits if set(h["accounts"] or []) & set(c["expect_no_accounts"])]
                    row["acl_leaks"] = len(leaked)
                    acl_leaks += len(leaked)
            results.append(row)

        # Personal contact data must never be in the index
        pii = s.execute(text("""
            SELECT count(*) FROM personas p JOIN rag_chunks c
              ON (p.personal_email IS NOT NULL AND length(p.personal_email) > 5 AND c.text ILIKE '%' || p.personal_email || '%')
              OR (p.direct_mobile_phone IS NOT NULL AND length(regexp_replace(p.direct_mobile_phone, '\\D', '', 'g')) >= 8
                  AND regexp_replace(c.text, '\\D', '', 'g') LIKE '%' || regexp_replace(p.direct_mobile_phone, '\\D', '', 'g') || '%')""")).scalar()
        # ...and never in contact cards (enrichment copies mobiles into `phone`; privacy.py filters by value)
        digits = lambda x: re.sub(r"\D", "", x or "")
        from apps.sales_copilot import privacy
        mobiles = {digits(m) for (m,) in s.execute(text("SELECT direct_mobile_phone FROM personas WHERE direct_mobile_phone IS NOT NULL"))
                   if privacy.is_personal_mobile(m)}          # shared switchboards are company lines
        freemail = {e.lower() for (e,) in s.execute(text("SELECT personal_email FROM personas WHERE personal_email IS NOT NULL"))
                    if e.split("@")[-1].lower() in privacy.FREEMAIL}
        all_ids = [r[0] for r in s.execute(text("SELECT id FROM personas"))]
        for card in chat.contact_cards(s, all_ids):
            pii += int(digits(card.get("phone")) in mobiles) + int((card.get("email") or "").lower() in freemail)
    finally:
        s.close()
    summary = {
        "cases": len(cases),
        "intent_accuracy": round(intent_ok / intent_n, 3) if intent_n else None,
        "entity_accuracy": round(ent_ok / ent_n, 3) if ent_n else None,
        "recall_at_10": round(rec_ok / rec_n, 3) if rec_n else None,
        "acl_leaks": acl_leaks,
        "pii_leaks": pii,
    }
    summary["passed"] = (summary["intent_accuracy"] or 0) >= GATES["intent_accuracy"] and \
        (summary["recall_at_10"] or 0) >= GATES["recall_at_10"] and acl_leaks == 0 and pii == 0
    return {"summary": summary, "results": results}


def main() -> None:
    out = run()
    for r in out["results"]:
        flags = [k for k in ("intent_ok", "persona_ok", "recall_ok") if r.get(k) is False]
        mark = "FAIL" if flags or r.get("acl_leaks") else "ok  "
        extra = f" top={r['top']}" if r.get("top") else ""
        print(f"  {mark} {r['id']:<24} intent={r['intent']:<14} {' '.join(flags)}{extra}")
    print(json.dumps(out["summary"], indent=2))
    if not out["summary"]["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
