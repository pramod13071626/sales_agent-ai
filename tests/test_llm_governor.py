"""Copilot quota governor (apps/sales_copilot/llm.py) — pure budget arithmetic, no database, no LLM."""

import pytest

from apps.sales_copilot import llm


def status(used=None, limit=50, exhausted=False):
    """A quota_status()-shaped dict for the default 40/10/20 + 30% pool split of `limit`."""
    used = used or {}
    reserves = {"copilot": round(limit * .4), "callprep": round(limit * .1), "profiles": round(limit * .2)}
    pool = limit - sum(reserves.values())
    pool_used = sum(max(0, used.get(f, 0) - r) for f, r in reserves.items())
    return {"team": {
        "requests_used": sum(used.values()), "requests_limit": limit,
        "by_feature": {f: {"used": used.get(f, 0), "reserve": r} for f, r in reserves.items()},
        "pool": {"used": pool_used, "size": pool}, "provider_exhausted": exhausted}}


def test_reserves_and_pool_cover_the_whole_limit():
    # Why batch jobs can't be "whatever nobody reserved": that is always nothing.
    s = status()["team"]
    assert sum(f["reserve"] for f in s["by_feature"].values()) + s["pool"]["size"] == s["requests_limit"]


def test_batch_at_night_gets_everything_left_except_the_keep():
    s = status({"copilot": 3})                      # the real 2026-10-05 situation
    assert llm._room(s, "callprep_batch", night=True) == 50 - 3 - llm.NIGHT_KEEP


def test_batch_by_day_draws_only_its_own_reserve_plus_pool():
    s = status({"copilot": 3})
    assert llm._room(s, "callprep_batch", night=False) == 5 + 15
    assert llm._room(s, "callprep_batch", night=False) == llm._room(s, "callprep")


def test_batch_by_day_never_takes_the_copilot_reserve():
    s = status({"callprep": 5, "profiles": 0, "copilot": 0})
    s["team"]["pool"]["used"] = 15                  # pool already drained by call-prep
    assert llm._room(s, "callprep_batch", night=False) == 0
    assert llm._room(s, "copilot") == 20            # copilot keeps its whole reserve


def test_nothing_left_means_no_room_at_any_hour():
    s = status({"copilot": 20, "callprep": 5, "profiles": 10, "pool_users": 0})
    s["team"]["requests_used"] = 50
    assert llm._room(s, "callprep_batch", night=True) == 0
    assert llm._room(s, "callprep_batch", night=False) == 0


def test_provider_exhausted_blocks_everything():
    s = status({"copilot": 1}, exhausted=True)
    for feature in ("copilot", "callprep", "callprep_batch"):
        assert llm._room(s, feature, night=True) == 0


@pytest.mark.parametrize("hour,inside", [(15, False), (15.5, True), (20, True), (23.9, True), (0, False), (10, False)])
def test_batch_window_is_21_00_to_05_30_ist(hour, inside):
    from datetime import datetime, timezone
    now = datetime(2026, 10, 5, int(hour), int(round((hour % 1) * 60)), tzinfo=timezone.utc)
    assert llm.in_batch_window(now) is inside
