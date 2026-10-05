"""Command Center generator — scoring, velocity and playbook logic on plain
dicts (no database)."""

from datetime import datetime, timedelta, timezone

from services import command_center_service as ccs

NOW = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)


def _exec(days_ago, designation="Chief Technology Officer", event="joined", account_id=1, ref=1):
    return {
        "kind": "exec", "account_id": account_id, "account_name": "Acme", "detected_at": NOW - timedelta(days=days_ago),
        "ref_id": ref, "person": "Jane Doe", "designation": designation, "event_type": event, "context": "", "url": None,
    }


def _news(days_ago, title="Acme announces cloud partnership", account_id=1, ref=100):
    return {
        "kind": "news", "account_id": account_id, "account_name": "Acme", "detected_at": NOW - timedelta(days=days_ago),
        "ref_id": ref, "title": title, "source": "Reuters", "url": "https://example.com",
    }


def test_no_raw_signals_produces_empty_result():
    result = ccs.build_from_raw([], NOW)
    assert result["signals"] == []
    assert result["playbook"] == []
    assert result["velocity"]["this_week"] == 0
    assert result["velocity"]["delta_pct"] == 0


def test_c_level_exec_outscores_unranked_exec_and_decays_with_age():
    c_level = ccs.score_signal(_exec(0), NOW)["score"]
    plain = ccs.score_signal(_exec(0, designation="Analyst"), NOW)["score"]
    old = ccs.score_signal(_exec(6), NOW)["score"]
    assert c_level > plain
    assert c_level > old
    assert 0 <= plain <= 100


def test_news_keywords_raise_score():
    boring = ccs.score_signal(_news(0, title="Acme hosts annual picnic"), NOW)["score"]
    hot = ccs.score_signal(_news(0, title="Acme acquisition expands cloud and AI unit"), NOW)["score"]
    assert hot > boring


def test_feed_keeps_only_last_week_but_velocity_counts_older_weeks():
    raw = [_exec(1, ref=1), _exec(2, ref=2), _exec(9, ref=3)]
    result = ccs.build_from_raw(raw, NOW)
    assert len(result["signals"]) == 2
    assert result["velocity"]["this_week"] == 2
    assert result["velocity"]["last_week"] == 1
    assert result["velocity"]["delta_pct"] == 100
    assert len(result["velocity"]["trend"]) == ccs.TREND_WEEKS


def test_news_is_capped_per_account_per_week():
    raw = [_news(0, ref=i) for i in range(ccs.NEWS_PER_ACCOUNT_PER_WEEK + 4)]
    result = ccs.build_from_raw(raw, NOW)
    assert len(result["signals"]) == ccs.NEWS_PER_ACCOUNT_PER_WEEK


def test_playbook_one_play_per_account_and_category_ranked_by_score():
    raw = [_exec(0, ref=1), _exec(1, ref=2), _news(0, account_id=2, ref=3)]
    result = ccs.build_from_raw(raw, NOW)
    plays = result["playbook"]
    assert [p["rank"] for p in plays] == [1, 2]
    assert {(p["account_id"]) for p in plays} == {1, 2}
    assert plays[0]["title"].startswith("Send a congratulations note to Jane Doe")


def test_departure_play_asks_for_replacement():
    sig = ccs.score_signal(_exec(0, event="resigned"), NOW)
    play = ccs.build_playbook([sig], NOW)[0]
    assert "replaces" in play["title"]


def test_parse_date_handles_scraped_formats():
    assert ccs._parse_date("2026-10-01").year == 2026
    assert ccs._parse_date("Thu, 01 Oct 2026 10:00:00 GMT").month == 10
    assert ccs._parse_date("Oct 1, 2026").day == 1
    assert ccs._parse_date("not a date") is None
