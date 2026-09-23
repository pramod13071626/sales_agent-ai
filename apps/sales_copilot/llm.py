"""OpenRouter (free models only) + the shared quota governor (README §10.4).

Two limits are enforced before any request is sent:
  * team-wide requests/day, split into per-feature reserves + a shared pool
    (OpenRouter's free tier counts REQUESTS: 50/day, or 1,000 after the credit unlock);
  * per person: 90,000 tokens/day and at most 30% of the day's requests.
Batch jobs (feature names ending in "_batch") may only use what the interactive
features' reserves leave over, and only in the night window.
A request is reserved (llm_usage row with ok = NULL) inside one transaction that
re-checks the limits, then finalized with OpenRouter's actual token usage. Every
caller that spends the OpenRouter key — copilot, call-prep, profiles — goes
through reserve()/finalize() so the team sees one budget.
"""

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterator, List, Optional, Tuple

import requests
from sqlalchemy import text

from apps.sales_copilot import settings

INTERACTIVE = ("copilot", "callprep", "profiles")
BATCH_WINDOW_UTC = (15.5, 24.0)      # 21:00–05:30 IST (quota resets 00:00 UTC = 05:30 IST)


class QuotaExceeded(Exception):
    def __init__(self, scope: str, message: str):
        super().__init__(message)
        self.scope = scope          # 'team' | 'user_tokens' | 'user_requests' | 'provider_daily' | 'batch_window'


class LLMError(Exception):
    pass


def _reserves() -> Dict[str, int]:
    limit = settings.DAILY_REQUEST_LIMIT
    return {k: int(round(limit * v)) for k, v in settings.QUOTA_SPLIT.items()}


def resets_at() -> datetime:
    now = datetime.now(timezone.utc)
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def quota_status(session, user_id: Optional[int]) -> Dict[str, Any]:
    rows = session.execute(text("""
        SELECT feature, count(*),
               coalesce(sum(CASE WHEN user_id = :u THEN coalesce(tokens_in,0) + coalesce(tokens_out,0)
                                                      + CASE WHEN ok IS NULL THEN coalesce(reserved_tokens,0) ELSE 0 END END), 0),
               count(*) FILTER (WHERE user_id = :u),
               bool_or(status_code = 429)
        FROM llm_usage WHERE day_utc = (now() AT TIME ZONE 'utc')::date GROUP BY feature"""),
        {"u": user_id}).fetchall()
    used = {r[0]: r[1] for r in rows}
    reserves = _reserves()
    pool_used = sum(max(0, n - reserves.get(f, 0)) for f, n in used.items())
    total = sum(used.values())
    return {
        "team": {"requests_used": total, "requests_limit": settings.DAILY_REQUEST_LIMIT,
                 "by_feature": {f: {"used": used.get(f, 0), "reserve": reserves.get(f, 0)} for f in INTERACTIVE},
                 "pool": {"used": pool_used, "size": reserves["pool"]},
                 "provider_exhausted": any(r[4] for r in rows)},
        "me": {"tokens_used": sum(r[2] for r in rows), "tokens_limit": settings.USER_DAILY_TOKENS,
               "requests_used": sum(r[3] for r in rows),
               "requests_limit": int(settings.DAILY_REQUEST_LIMIT * settings.USER_DAILY_REQUEST_SHARE)},
        "resets_at": resets_at().isoformat(),
    }


def _room(status: Dict[str, Any], feature: str) -> int:
    """Requests this feature may still send today (team-side limits only)."""
    team = status["team"]
    left_total = team["requests_limit"] - team["requests_used"]
    if team["provider_exhausted"]:
        return 0
    if feature.endswith("_batch"):
        unused_reserves = sum(max(0, f["reserve"] - f["used"]) for f in team["by_feature"].values())
        pool_left = max(0, team["pool"]["size"] - team["pool"]["used"])
        return max(0, left_total - unused_reserves - pool_left)
    f = team["by_feature"].get(feature, {"used": 0, "reserve": 0})
    own = max(0, f["reserve"] - f["used"])
    pool_left = max(0, team["pool"]["size"] - team["pool"]["used"])
    return max(0, min(left_total, own + pool_left))


def _check(status: Dict[str, Any], feature: str, est_tokens: int, requests_: int = 1, user_id: Optional[int] = None) -> None:
    team, me = status["team"], status["me"]
    if team["provider_exhausted"] or team["requests_used"] >= team["requests_limit"]:
        raise QuotaExceeded("team", "The team's AI requests for today are used up.")
    if feature.endswith("_batch"):
        hour = datetime.now(timezone.utc).hour + datetime.now(timezone.utc).minute / 60
        if not (BATCH_WINDOW_UTC[0] <= hour < BATCH_WINDOW_UTC[1]):
            raise QuotaExceeded("batch_window", "Batch jobs only run 21:00–05:30 IST, on requests the team didn't use.")
    room = _room(status, feature)
    if room < requests_:
        raise QuotaExceeded("team", f"Today's AI requests for {feature.replace('_batch', '')} (and the shared pool) are used up."
                            if requests_ == 1 else f"This needs about {requests_} AI requests; only {room} are left today.")
    if user_id is not None:
        if me["requests_used"] + requests_ > me["requests_limit"]:
            raise QuotaExceeded("user_requests", "You've used your AI requests for today.")
        if me["tokens_used"] + est_tokens > me["tokens_limit"]:
            raise QuotaExceeded("user_tokens", f"You have {me['tokens_limit'] - me['tokens_used']:,} AI tokens left today; "
                                               f"this needs about {est_tokens:,}.")


def remaining_user_tokens(session, user_id: Optional[int]) -> int:
    me = quota_status(session, user_id)["me"]
    return me["tokens_limit"] - me["tokens_used"]


def reserve(session, feature: str, user_id: Optional[int], est_tokens: int, requests_: int = 1,
            model: Optional[str] = None) -> List[int]:
    """Check the governor and reserve `requests_` llm_usage rows atomically."""
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('copilot_llm_usage'))"))
    _check(quota_status(session, user_id), feature, est_tokens, requests_, user_id)
    per = est_tokens // max(requests_, 1)
    ids = [session.execute(text("""
        INSERT INTO llm_usage (feature, model, user_id, ok, reserved_tokens)
        VALUES (:f, :m, :u, NULL, :est) RETURNING id"""),
        {"f": feature, "m": model or settings.LLM_MODELS[0], "u": user_id, "est": per}).scalar()
        for _ in range(requests_)]
    session.commit()
    return ids


def finalize(session, usage_id: int, *, ok: bool, status_code: Optional[int], model: Optional[str],
             tokens_in: int = 0, tokens_out: int = 0) -> None:
    session.execute(text("""UPDATE llm_usage SET ok = :ok, status_code = :sc, model = coalesce(:m, model),
                            tokens_in = :ti, tokens_out = :to WHERE id = :id"""),
                    {"ok": ok, "sc": status_code, "m": model, "ti": int(tokens_in or 0), "to": int(tokens_out or 0),
                     "id": usage_id})
    session.commit()


def release(session, usage_ids: List[int]) -> None:
    """Drop reservations that were never sent (e.g. a multi-request job that stopped early)."""
    if usage_ids:
        session.execute(text("DELETE FROM llm_usage WHERE id = ANY(:ids) AND ok IS NULL"), {"ids": usage_ids})
        session.commit()


def _body(system: str, user: str, max_tokens: int, stream: bool) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "model": settings.LLM_MODELS[0],
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "reasoning": {"enabled": False},   # reasoning cost 3-6x tokens on nemotron (README §10.2)
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if len(settings.LLM_MODELS) > 1:
        body["models"] = settings.LLM_MODELS        # OpenRouter-side fallback within the same request
    if stream:
        body["stream"] = True
        body["usage"] = {"include": True}          # final chunk carries token usage
    return body


def _headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "HTTP-Referer": "http://localhost", "X-Title": "sales-agent-ai copilot"}


def _raise_for(status_code: int, body_text: str) -> None:
    if status_code == 429:
        daily = "per-day" in body_text
        raise QuotaExceeded("provider_daily" if daily else "team",
                            "The free AI service's daily limit has been reached." if daily
                            else "The free AI service is rate-limiting right now — try again in a minute.")
    if status_code != 200:
        raise LLMError(f"HTTP {status_code}: {body_text[:200]}")


def chat(session, *, feature: str, user_id: Optional[int], system: str, user: str,
         max_tokens: int = settings.LLM_MAX_TOKENS) -> Tuple[str, Dict[str, Any]]:
    """One OpenRouter request under the governor. Returns (content, usage-info)."""
    if not settings.OPENROUTER_API_KEY:
        raise LLMError("OPENROUTER_API_KEY is not configured")
    est = (len(system) + len(user)) // 4 + max_tokens
    (usage_id,) = reserve(session, feature, user_id, est)
    t0 = time.time()
    status_code, content, u, model_used = None, "", {}, settings.LLM_MODELS[0]
    try:
        try:
            res = requests.post(settings.OPENROUTER_URL, json=_body(system, user, max_tokens, False),
                                timeout=120, headers=_headers())
        except requests.RequestException as e:
            raise LLMError(str(e)) from e
        status_code = res.status_code
        _raise_for(res.status_code, res.text if res.status_code != 200 else "")
        payload = res.json()
        if "error" in payload:
            raise LLMError(str(payload["error"])[:200])
        content = (payload["choices"][0]["message"].get("content") or "").strip()
        model_used = payload.get("model") or model_used
        u = payload.get("usage") or {}
        if not content:
            raise LLMError("empty reply")
        return content, {"model": model_used, "tokens_in": u.get("prompt_tokens"),
                         "tokens_out": u.get("completion_tokens"), "latency_ms": int((time.time() - t0) * 1000)}
    finally:
        finalize(session, usage_id, ok=bool(content), status_code=status_code, model=model_used,
                 tokens_in=u.get("prompt_tokens") or 0, tokens_out=u.get("completion_tokens") or 0)


def chat_stream(session, *, feature: str, user_id: Optional[int], system: str, user: str,
                max_tokens: int = settings.LLM_MAX_TOKENS) -> Iterator[Dict[str, Any]]:
    """Streamed OpenRouter request under the governor. Yields {"token": str} items,
    then one {"done": usage-info}. The usage row is finalized even if the consumer
    stops early (the rep pressed Stop)."""
    if not settings.OPENROUTER_API_KEY:
        raise LLMError("OPENROUTER_API_KEY is not configured")
    est = (len(system) + len(user)) // 4 + max_tokens
    (usage_id,) = reserve(session, feature, user_id, est)
    t0 = time.time()
    status_code, got, u, model_used = None, [], {}, settings.LLM_MODELS[0]
    try:
        try:
            res = requests.post(settings.OPENROUTER_URL, json=_body(system, user, max_tokens, True),
                                timeout=120, headers=_headers(), stream=True)
        except requests.RequestException as e:
            raise LLMError(str(e)) from e
        status_code = res.status_code
        if res.status_code != 200:
            _raise_for(res.status_code, res.text)
        for raw in res.iter_lines(decode_unicode=True):
            if not raw or raw.startswith(":") or not raw.startswith("data:"):
                continue                                  # keep-alive comments / blank lines
            data = raw[5:].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            if "error" in chunk:
                raise LLMError(str(chunk["error"])[:200])
            model_used = chunk.get("model") or model_used
            if chunk.get("usage"):
                u = chunk["usage"]
            for ch in chunk.get("choices") or []:
                piece = (ch.get("delta") or {}).get("content")
                if piece:
                    got.append(piece)
                    yield {"token": piece}
        if not got:
            raise LLMError("empty reply")
        yield {"done": {"model": model_used, "tokens_in": u.get("prompt_tokens"),
                        "tokens_out": u.get("completion_tokens"), "latency_ms": int((time.time() - t0) * 1000)}}
    finally:
        # Stopped early -> no usage chunk; estimate from what was sent/produced.
        finalize(session, usage_id, ok=bool(got), status_code=status_code, model=model_used,
                 tokens_in=u.get("prompt_tokens") or ((len(system) + len(user)) // 4 if got else 0),
                 tokens_out=u.get("completion_tokens") or len("".join(got)) // 4)


def check_models() -> Dict[str, Any]:
    """README §14.2: warn when a configured free model disappeared or stopped being free."""
    res = requests.get("https://openrouter.ai/api/v1/models", timeout=30)
    res.raise_for_status()
    models = {m["id"]: m for m in res.json().get("data", [])}
    out: Dict[str, Any] = {}
    for mid in settings.LLM_MODELS:
        m = models.get(mid) or {}
        pricing = m.get("pricing") or {}
        free = bool(m) and float(pricing.get("prompt") or 1) == 0 and float(pricing.get("completion") or 1) == 0
        out[mid] = {"listed": bool(m), "free": free, "context_length": m.get("context_length")}
    out["_ok"] = all(v["listed"] and v["free"] for k, v in out.items() if not k.startswith("_"))
    return out
