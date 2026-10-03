"""Search palette API (apps/sales_search/api.py) — pure logic, no database.
Ranking against real data is checked by apps/sales_search/eval/run_eval.py."""

import re
import types

import pytest
from pydantic import ValidationError

from apps.sales_search import api as sa

USER = types.SimpleNamespace(id=7, role="super_admin")


class FakeSession:
    """Records execute() calls; fails the test if a code path that shouldn't touch the DB does."""

    def __init__(self):
        self.calls = []
        self.committed = False

    def execute(self, stmt, params=None):
        self.calls.append((str(stmt), params or {}))

    def commit(self):
        self.committed = True


def test_like_wildcards_are_escaped():
    p = sa._params("100%_x\\y", [1], None)
    assert p["like"] == "%100\\%\\_x\\\\y%"
    assert p["starts"] == "100\\%\\_x\\\\y%"


def test_word_regex_escapes_user_input():
    p = sa._params("a.b(c", [1], None)
    assert p["wordre"] == r"\m" + re.escape("a.b(c")
    re.compile(p["wordre"][2:])   # the escaped part is a valid literal pattern


def test_multi_word_query_builds_one_token_per_word():
    assert sa._params("vp operations", [1], None)["toks"] == [r"\mvp", r"\moperations"]
    assert sa._params("robin", [1], None)["toks"] == []


def test_current_account_defaults_to_zero():
    assert sa._params("x", [1], None)["cur"] == 0
    assert sa._params("x", [1], 5)["cur"] == 5


@pytest.mark.parametrize("trgm", [True, False])
def test_score_sql_tiers_and_fuzzy_toggle(trgm, monkeypatch):
    monkeypatch.setattr(sa, "_TRGM", trgm)
    sql = sa._score("p.title", 0.6)
    assert sql.startswith("(0.6 * CASE")
    for tier in ("THEN 100", "THEN 90", "THEN 80", "THEN 60", "THEN 55"):
        assert tier in sql
    assert ("word_similarity" in sql) is trgm


def test_score_tiers_are_ordered():
    # exact > prefix > word-prefix > contains > all-words > best possible typo match (50)
    tiers = [int(m) for m in re.findall(r"THEN (\d+)\n", sa._score("x"))][1:]   # [0] is the IS NULL guard
    assert tiers == sorted(tiers, reverse=True)
    assert min(tiers) > 50


@pytest.mark.parametrize("q", ["", " ", "a", "  b  "])
def test_short_queries_return_before_touching_the_db(q):
    s = FakeSession()
    assert sa.suggest(q=q, account_id=None, user=USER, s=s)["groups"] == []
    assert sa.semantic(q=q[:2], account_id=None, user=USER, s=s)["items"] == []
    assert s.calls == []


def test_suggest_collapses_whitespace():
    assert sa.suggest(q="  r  ", account_id=None, user=USER, s=FakeSession())["q"] == "r"


def test_log_skips_short_queries():
    s = FakeSession()
    sa.log_search(sa.SearchLogIn(q=" a ", n_results=0), user=USER, s=s)
    assert s.calls == [] and not s.committed


def test_log_writes_one_row_and_whitelists_chosen_type():
    s = FakeSession()
    sa.log_search(sa.SearchLogIn(q="  robin   vince ", n_results=3, chosen_type="<script>"), user=USER, s=s)
    assert len(s.calls) == 1 and s.committed
    params = s.calls[0][1]
    assert params["q"] == "robin vince"
    assert params["c"] is None
    assert params["u"] == 7

    s = FakeSession()
    sa.log_search(sa.SearchLogIn(q="robin", n_results=3, chosen_type="persona"), user=USER, s=s)
    assert s.calls[0][1]["c"] == "persona"


@pytest.mark.parametrize("bad", [{"q": "x" * 301, "n_results": 0}, {"q": "ok", "n_results": -1}])
def test_log_payload_validation(bad):
    with pytest.raises(ValidationError):
        sa.SearchLogIn(**bad)


def test_groups_cover_every_result_type_the_palette_logs():
    types_from_groups = {"account", "persona", "lob", "signal", "deal", "task"}
    assert types_from_groups <= sa.LOG_TYPES
    assert {key for key, _, _ in sa.GROUPS} == set(sa.GROUP_LIMITS)
