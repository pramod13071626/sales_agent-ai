"""Regression guard for the /api/accounts list-view payload trim.

_serialize_account_summary (api.py) previously shipped the exact same ~85
scalar fields as _serialize_account_full — including multi_source_intelligence
and organisational_hierarchy_tree, the two heaviest columns in the schema — to
every consumer of the account LIST endpoint, even though only the currently
opened account's detail view (GET /api/accounts/{id}) actually reads them.
Run this after touching either serializer to make sure that regression
doesn't creep back in.

Run directly with `python scripts/verify_account_summary_trim.py` — NOT via
pytest: importing api.py under pytest's output-capture fixture raises
"ValueError: I/O operation on closed file" in this environment (a pre-existing
console/stdout-encoding quirk in this codebase, unrelated to this change),
so this lives here as a standalone script instead of under tests/.
"""
import sys
from types import SimpleNamespace

sys.path.insert(0, ".")
import api  # noqa: E402


def _fake_persona(id_, title, tier):
    return SimpleNamespace(
        id=id_, key=f"persona_{id_}", full_name=f"Persona {id_}", first_name="P", last_name=str(id_),
        title=title, tier=tier, hierarchy_level=1,
    )


def _fake_lob(id_, name, technologies=None, competitors=None):
    return SimpleNamespace(
        id=id_, lob_name=name, technologies=technologies or [], competitors=competitors or [],
        sub_lobs=[],
    )


def _fake_account():
    return SimpleNamespace(
        id=1, key="acme", display_name="Acme Corp", legal_name="Acme Corporation",
        stock_symbol="ACME", headquarters_location="New York, US", city=None, country=None,
        company_type="Public", employee_count_range="1000-5000", industries=["Financial Services"],
        extracted_at=None, heat_score=82, trend_score_90d=15,
        multi_source_intelligence={"linkedin_metrics": {"follower_count": 50000}},
        organisational_hierarchy_tree={"root": "big nested tree"},
        last_funding_type=None, ipo_status=None, patents_granted=0, active_tech_count=3,
        it_spend=None, num_acquisitions=0,
        personas=[_fake_persona(1, "CEO", "C-Suite"), _fake_persona(2, "VP Eng", "VP")],
        lobs=[_fake_lob(1, "Markets", technologies=["Kafka"], competitors=["Rival Co"])],
    )


FORBIDDEN = {
    "multi_source_intelligence", "organisational_hierarchy_tree",
    "c_suite_count", "vp_count", "director_count", "manager_count",
    "revenue", "estimated_revenue_range", "desc", "short_description", "full_description",
    "domain", "primary_domain", "website_url", "linkedin_url", "twitter_url",
    "sec_edgar_url", "sec_filings_rss", "github_url", "glassdoor_url", "blog_url",
    "keywords", "total_funding_amount_usd", "global_traffic_rank", "bounce_rate",
}
REQUIRED = {
    "id", "key", "name", "display_name", "legal_name", "ticker", "stock_symbol",
    "location", "company_type", "employee_count_range", "industries",
    "lobs_count", "total_contacts_captured", "lobs", "personas",
    "extracted_at", "heat_score", "trend_score_90d", "signals_count",
}


def main() -> int:
    failures = []

    summary = api._serialize_account_summary(_fake_account())

    leaked = FORBIDDEN & summary.keys()
    if leaked:
        failures.append(f"Heavy/unused fields leaked back into the account list summary: {leaked}")

    missing = REQUIRED - summary.keys()
    if missing:
        failures.append(f"List-view consumers need these fields but they're missing: {missing}")

    if summary.get("total_contacts_captured") != 2:
        failures.append(f"total_contacts_captured expected 2, got {summary.get('total_contacts_captured')}")

    if summary.get("lobs_count") != 1:
        failures.append(f"lobs_count expected 1, got {summary.get('lobs_count')}")

    # 6 truthy computeSignals(account, null) checks for this fixture: LinkedIn
    # followers, company_type == "Public", active_tech_count, personas present
    # (total_contacts_captured), industries present, and one LOB competitor.
    if summary.get("signals_count") != 6:
        failures.append(f"signals_count expected 6, got {summary.get('signals_count')}")

    # Regression for the TypeError hit during implementation: competitor
    # entries aren't guaranteed to be plain strings (can be dicts), which broke
    # a naive Python set() the way JS's Set() never would.
    acct = _fake_account()
    acct.lobs = [_fake_lob(1, "Markets", competitors=[{"name": "Rival Co"}])]
    try:
        dict_competitor_summary = api._serialize_account_summary(acct)
        if dict_competitor_summary.get("signals_count", 0) < 1:
            failures.append("signals_count should still count a dict-shaped competitor as a signal")
    except TypeError as e:
        failures.append(f"_serialize_account_summary crashed on dict-shaped competitors: {e}")

    if failures:
        print("FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"OK — summary keys: {sorted(summary.keys())}")
    print("All account-summary trim checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
