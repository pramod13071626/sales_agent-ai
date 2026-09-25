"""
Token-optimized Sales Call-Prep & Battlecard generator.

Builds each persona's call-prep (icebreaker, value proposition, communication
style, KPIs, pain points, objections + counters) from data ALREADY in the DB,
instead of the fixed-string template in PersonaService._synthesize_ai_sales_dossier.

Token strategy (see generate_account):
  * One LLM "account brief" per account (news / signals / jobs / LOBs), cached
    on disk by input hash and reused as a compact prefix for every person.
  * Evidence level per persona:
      A  career history + >=5 relevant own posts   -> individual LLM call
      B  career history OR >=1 relevant own post   -> individual LLM call
      C  title/headline/LinkedIn only              -> ONE call per (seniority, function)
                                                      group; icebreaker filled from a template
      D  name + title only                         -> skipped
  * Person evidence capped: last 3 roles, 5 posts x 400 chars, digest summary only.
  * Unchanged inputs (same input_hash) are skipped unless force=True.

LLM: OpenRouter chat-completions. Key from OPENROUTER_API_KEY (env), falling
back to apps/content_pipeline/.env, which is where the digest pipeline keeps it.
"""

import hashlib
import json
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import dotenv_values
from sqlalchemy import text

import config
from db.models.account import Account
from db.models.persona import Persona

PROMPT_VERSION = "callprep-v2"

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_CONTENT_PIPELINE_ENV = config.BASE_DIR / "apps" / "content_pipeline" / ".env"
_pipeline_env = dotenv_values(_CONTENT_PIPELINE_ENV) if _CONTENT_PIPELINE_ENV.exists() else {}

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY") or _pipeline_env.get("OPENROUTER_API_KEY", "")
CALLPREP_MODEL = (
    os.getenv("CALLPREP_LLM_MODEL")
    or _pipeline_env.get("LLM_MODEL")
    or "nvidia/nemotron-3-super-120b-a12b:free"
)

CACHE_DIR = config.OUTPUT_DIR / "callprep"

# ── Evidence limits (the main token levers) ──
MAX_ROLES = 3
MAX_POSTS = 5
MAX_POSTS_PER_CHANNEL = 3
POST_CHARS = 400
DIGEST_CHARS = 600
ACCOUNT_INPUT_CHARS = 24000
MAX_TOKENS_ACCOUNT = 1200
MAX_TOKENS_PERSON = 1000

SEC_CHANNELS = ("sec", "sec_mentions", "sec_proxy")
CHANNEL_WEIGHT = {
    "linkedin": 3, "news": 2, "bloomberg": 2, "web_search": 2, "brokercheck": 1,
    "patents": 1, "rss": 1, "reddit": 0,
}

# Mirrors STRADIT_OFFERINGS in frontend/js/modules/constants.js
STRADIT_OFFERINGS = {
    "ai": "Applied AI - AI governance, LLMOps, production-grade AI agents/copilots",
    "data": "Data Analytics - data integration, predictive intelligence, decision dashboards",
    "cyber": "Cybersecurity - AI-enhanced security engineering, managed threat monitoring, compliance readiness",
    "cloud": "Cloud & Infrastructure - multi-cloud migration, legacy modernization, managed cloud ops",
    "testing": "Automated AI Testing - AI-powered test automation and quality engineering",
    "digital_assets": "Digital Assets & Blockchain - regulated tokenization, custody infrastructure, smart contracts",
}

FUNCTION_RULES = [
    ("data_ai", r"\b(data|ai|ml|analytics|machine learning|genai|llm)\b"),
    ("risk_compliance", r"risk|compliance|audit|control|governance|security|cyber|regulat"),
    ("technology", r"tech|engineer|developer|software|architect|cloud|infrastructure|devops|platform|\bit\b|scrum|agile|digital"),
    ("operations", r"operation|process|settlement|custody|clearing|middle office|service delivery|transformation"),
    ("finance", r"financ|account|treasur|tax|controller|\bcfo\b"),
    ("client_sales", r"client|sales|relationship|business development|marketing|product|distribution"),
]

_OFFERINGS_TEXT = "\n".join(f"- {k}: {v}" for k, v in STRADIT_OFFERINGS.items())

_SCHEMA_PERSON = (
    '{"value_proposition":"<=40 words, tie 1-2 StradIT offerings to this person\'s priorities",'
    '"personalized_icebreaker":"<=35 words, conversational opener citing ONE concrete fact from PERSON evidence; no product pitch",'
    '"communication_style":"<=15 words",'
    '"target_kpis":["3 items, <=8 words each"],'
    '"operational_pain_points":["3 items, <=10 words each"],'
    '"objections":[{"o":"objection <=15 words","c":"counter <=25 words"}],'
    '"offerings":["offering ids"],"evidence":["<=3 short refs to facts used"]}'
)
_SCHEMA_GROUP = (
    '{"value_proposition":"<=40 words","icebreaker_template":"<=30 words; may use {first_name} and {title} '
    'placeholders; reference an ACCOUNT fact, not a personal one",'
    '"communication_style":"<=15 words","target_kpis":["3 items"],"operational_pain_points":["3 items"],'
    '"objections":[{"o":"objection","c":"counter"}],"offerings":["offering ids"]}'
)

SYSTEM_PERSON = (
    "You write concise B2B sales call-prep for StradIT sellers.\nStradIT offerings:\n"
    f"{_OFFERINGS_TEXT}\n"
    "Rules: use ONLY facts in the input; never invent numbers, names, deals or events. "
    "If person evidence is thin, stay at role/account level. Exactly 3 objections, each with a counter. Refer to offerings by name, never by id in prose. "
    f"Reply with ONLY minified JSON: {_SCHEMA_PERSON}"
)
SYSTEM_GROUP = (
    "You write concise B2B sales call-prep for StradIT sellers, for a GROUP of contacts sharing a "
    f"seniority and function at one account.\nStradIT offerings:\n{_OFFERINGS_TEXT}\n"
    "Rules: use ONLY facts in the input; never invent numbers, names or events. Exactly 3 objections, "
    f"each with a counter. Reply with ONLY minified JSON: {_SCHEMA_GROUP}"
)
SYSTEM_ACCOUNT = (
    "You condense account intelligence into a compact brief for sales call-prep. Use ONLY the input. "
    'Reply with ONLY minified JSON: {"summary":"<=80 words","priorities":["<=5"],"initiatives":["<=5"],'
    '"pressures":["<=5"],"competitors":["<=5"],"recent_events":["<=5, each <=20 words"]}'
)


class LLMError(Exception):
    pass


class QuotaExceeded(LLMError):
    """Daily provider quota hit (e.g. OpenRouter free-models-per-day) - retrying won't help."""


# ── Small helpers ─────────────────────────────────────────────────────────────

def _clean(s: Any, limit: int) -> str:
    s = re.sub(r"https?://\S+", "", str(s or ""))
    s = re.sub(r"[#*_>`|]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]


def _hash(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:16]


def _parse_date(value: Any) -> float:
    if not value:
        return 0.0
    if isinstance(value, datetime):
        return value.timestamp()
    s = str(value).strip()
    for parse in (parsedate_to_datetime, lambda v: datetime.fromisoformat(v.replace("Z", "+00:00"))):
        try:
            dt = parse(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except Exception:
            continue
    return 0.0


def _name_tokens(name: str) -> List[str]:
    parts = [re.sub(r"[^a-z]", "", w.lower()) for w in (name or "").split()]
    parts = [p for p in parts if len(p) >= 3]
    if not parts:
        return []
    return [parts[0], parts[-1]] if len(parts) > 1 else parts


def _has_list(v: Any) -> bool:
    return isinstance(v, list) and len(v) > 0


def _parse_json(raw: str) -> Dict[str, Any]:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        raw = raw[4:] if raw.lower().startswith("json") else raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            return json.loads(raw[start:end + 1])
        raise LLMError(f"Model did not return JSON: {raw[:200]}")


def call_llm(system: str, user: str, max_tokens: int) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """OpenRouter chat call with 429/5xx backoff. Returns (parsed_json, usage)."""
    if not OPENROUTER_API_KEY:
        raise LLMError("OPENROUTER_API_KEY not set (env or apps/content_pipeline/.env)")
    body = {
        "model": CALLPREP_MODEL,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        # Reasoning off: on nemotron it cost 3-6x the answer's tokens for no gain on this
        # extraction task, and it can leak into the reply instead of JSON.
        "reasoning": {"enabled": False},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "http://localhost",
        "X-Title": "sales-agent-ai call-prep",
    }
    last_err = ""
    for attempt in range(6):
        try:
            res = requests.post(OPENROUTER_URL, headers=headers, json=body, timeout=180)
        except requests.RequestException as e:
            last_err = str(e)
            time.sleep(10 * (attempt + 1))
            continue
        if res.status_code == 429 and "per-day" in res.text:
            raise QuotaExceeded(f"Daily quota exhausted: {res.text[:200]}")
        if res.status_code in (429, 500, 502, 503, 504):
            last_err = f"HTTP {res.status_code}: {res.text[:200]}"
            time.sleep(min(15 * (attempt + 1), 90))
            continue
        if res.status_code != 200:
            raise LLMError(f"HTTP {res.status_code}: {res.text[:300]}")
        payload = res.json()
        if "error" in payload:
            last_err = str(payload["error"])[:300]
            time.sleep(15 * (attempt + 1))
            continue
        content = payload["choices"][0]["message"].get("content") or ""
        u = payload.get("usage") or {}
        usage = {
            "prompt_tokens": int(u.get("prompt_tokens") or 0),
            "completion_tokens": int(u.get("completion_tokens") or 0),
            "reasoning_tokens": int((u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0),
        }
        try:
            return _parse_json(content), usage
        except (LLMError, json.JSONDecodeError) as e:
            last_err = f"bad JSON: {e}"
            continue
    raise LLMError(f"OpenRouter failed after retries: {last_err}")


def governed_llm(session, feature: str, user_id: Optional[int], system: str, user: str, max_tokens: int,
                 allow_daytime: bool = False) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """call_llm under the copilot's shared OpenRouter quota governor, so call-prep,
    profiles and the copilot draw on ONE team budget (apps/sales_copilot/README.md §10.4).
    feature: "callprep" (the profile-page button, per-user) or "callprep_batch" (script:
    leftovers only, night window unless allow_daytime)."""
    from apps.sales_copilot import llm as governor
    est = (len(system) + len(user)) // 4 + max_tokens
    try:
        (usage_id,) = governor.reserve(session, feature, user_id, est, allow_daytime=allow_daytime)
    except governor.QuotaExceeded as e:
        raise QuotaExceeded(str(e)) from e
    ok, status, usage = False, None, {}
    try:
        result, usage = call_llm(system, user, max_tokens)
        ok, status = True, 200
        return result, usage
    except QuotaExceeded:
        status = 429
        raise
    finally:
        governor.finalize(session, usage_id, ok=ok, status_code=status, model=CALLPREP_MODEL,
                          tokens_in=usage.get("prompt_tokens", 0), tokens_out=usage.get("completion_tokens", 0))


# ── Account brief (one LLM call per account, cached on disk) ─────────────────

def _account_brief_input(session, account: Account) -> str:
    q = lambda sql, **kw: session.execute(text(sql), kw).fetchall()
    lines = [f"ACCOUNT: {account.legal_name or account.display_name}"]
    if account.short_description:
        lines.append(f"About: {_clean(account.short_description, 400)}")

    sigs = q("select title, details from opportunity_signals where account_id=:i order by last_seen desc nulls last", i=account.id)
    seen, seen_summaries = set(), set()
    lines.append("\nOPPORTUNITY SIGNALS:")
    for title, details in sigs:
        if not title or title in seen or len(seen) >= 25:
            continue
        seen.add(title)
        summary = _clean(details.get("summary") if isinstance(details, dict) else details, 200)
        if summary[:80] in seen_summaries:
            lines.append(f"- {title}")  # several signal titles share one summary - send it once
            continue
        seen_summaries.add(summary[:80])
        lines.append(f"- {title}: {summary}")

    posts = q(
        "select channel, body, extra, published_at, first_seen from posts where kind='company' and target_key=:k "
        "and channel in ('cxo_news','newsroom','blog','linkedin','twitter','news')",
        k=account.key,
    )
    posts = sorted(posts, key=lambda r: _parse_date(r[3]) or _parse_date(r[4]), reverse=True)
    lines.append("\nRECENT COMPANY NEWS/POSTS:")
    seen = set()
    for channel, body, extra, _, _ in posts:
        title = (extra or {}).get("title") if isinstance(extra, dict) else None
        line = _clean(title or body, 180)
        if not line or line[:60] in seen:
            continue
        seen.add(line[:60])
        lines.append(f"- [{channel}] {line}")
        if len(seen) >= 30:
            break

    jobs = q(
        "select body, extra from posts where kind='company' and target_key=:k and channel='linkedin_jobs'", k=account.key
    )
    job_titles = defaultdict(int)
    for body, extra in jobs:
        t = (extra or {}).get("title") if isinstance(extra, dict) else None
        if t:
            job_titles[_clean(t, 60)] += 1
    if job_titles:
        top = sorted(job_titles.items(), key=lambda kv: -kv[1])[:15]
        lines.append("\nHIRING (job title x count): " + "; ".join(f"{t} x{n}" for t, n in top))

    comps, techs = defaultdict(int), defaultdict(int)
    for c, t in q("select competitors, technologies from lobs where account_id=:i", i=account.id):
        for x in (c or []):
            comps[str(x)] += 1
        for x in (t or []):
            techs[str(x)] += 1
    if comps:
        lines.append("COMPETITORS: " + ", ".join(k for k, _ in sorted(comps.items(), key=lambda kv: -kv[1])[:8]))
    if techs:
        lines.append("TECHNOLOGIES: " + ", ".join(k for k, _ in sorted(techs.items(), key=lambda kv: -kv[1])[:8]))

    return "\n".join(lines)[:ACCOUNT_INPUT_CHARS]


def get_account_brief(session, account: Account, force: bool = False, dry_run: bool = False,
                      feature: str = "callprep_batch", user_id: Optional[int] = None,
                      allow_daytime: bool = False) -> Dict[str, Any]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    user = _account_brief_input(session, account)
    h = _hash(PROMPT_VERSION, CALLPREP_MODEL, user)
    path = CACHE_DIR / f"{account.key}_account_brief.json"
    if path.exists() and not force:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if cached.get("input_hash") == h:
            return {**cached, "cached": True}
    if dry_run:
        return {"brief": {"summary": "(dry run)"}, "input_hash": h, "est_input_tokens": len(user) // 4, "cached": False}
    brief, usage = governed_llm(session, feature, user_id, SYSTEM_ACCOUNT, user, MAX_TOKENS_ACCOUNT, allow_daytime)
    out = {
        "brief": brief, "input_hash": h, "model": CALLPREP_MODEL, "usage": usage,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return {**out, "cached": False}


def _brief_block(brief: Dict[str, Any]) -> str:
    return "ACCOUNT BRIEF: " + json.dumps(brief, ensure_ascii=False, separators=(",", ":"))


# ── Per-person evidence ───────────────────────────────────────────────────────

def _seniority(p: Persona) -> str:
    t = f"{p.tier or ''} {p.title or ''}".lower()
    if re.search(r"c_suite|c-suite|chief|executive|president|chair|head of|level 1|managing director", t):
        return "executive"
    if re.search(r"vp|vice president", t):
        return "vp"
    return "director_manager"


def _function(p: Persona) -> str:
    t = f"{p.title or ''} {p.headline or ''} {' '.join(p.departments or [])}".lower()
    for name, pattern in FUNCTION_RULES:
        if re.search(pattern, t):
            return name
    return "general"


def _collect_person_evidence(session, p: Persona) -> Dict[str, Any]:
    name = p.full_name or p.display_name or ""
    tokens = _name_tokens(name)

    roles = []
    for r in (p.employment_history if _has_list(p.employment_history) else [])[:MAX_ROLES]:
        if isinstance(r, dict):
            span = "-".join(x for x in (str(r.get("start_date") or ""), str(r.get("end_date") or "")) if x)
            roles.append(_clean(f"{r.get('title', '')} @ {r.get('company', '')} ({span})", 140))
    edu = []
    for e in (p.education_history if _has_list(p.education_history) else [])[:2]:
        if isinstance(e, dict):
            edu.append(_clean(" ".join(str(e.get(k) or "") for k in ("degree", "field_of_study", "school", "institution")), 100))
    if not edu and (p.degree or p.institution):
        edu.append(_clean(f"{p.degree or ''} {p.institution or ''}", 100))

    posts = []
    if p.key and tokens:
        rows = session.execute(
            text(
                "select channel, body, extra, published_at, first_seen from posts "
                "where kind='person' and target_key=:k and not (channel = any(:sec))"
            ),
            {"k": p.key, "sec": list(SEC_CHANNELS)},
        ).fetchall()
        cand, seen = [], set()
        for channel, body, extra, pub, first_seen in rows:
            title = (extra or {}).get("title") if isinstance(extra, dict) else None
            body_txt, title_txt = _clean(body, 4000), _clean(title, 200)
            txt = body_txt if title_txt and body_txt.startswith(title_txt) else f"{title_txt} {body_txt}".strip()
            low = txt.lower()
            if not txt or not all(tok in low for tok in tokens):
                continue  # name-query noise: post doesn't actually mention this person
            sig = low[:80]
            if sig in seen:
                continue
            seen.add(sig)
            cand.append((CHANNEL_WEIGHT.get(channel, 1), _parse_date(pub) or _parse_date(first_seen), channel, txt))
        cand.sort(key=lambda c: (-c[0], -c[1]))
        per_channel = defaultdict(int)
        for weight, ts, channel, txt in cand:
            if per_channel[channel] >= MAX_POSTS_PER_CHANNEL:
                continue
            per_channel[channel] += 1
            date = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d") if ts else "n/d"
            posts.append(f"[{channel} {date}] {txt[:POST_CHARS]}")
            if len(posts) >= MAX_POSTS:
                break
        relevant_count = len(cand)
    else:
        relevant_count = 0

    digest_summary = ""
    if p.key:
        row = session.execute(text("select digest from digests where target_key=:k and kind='person'"), {"k": p.key}).fetchone()
        if row and isinstance(row[0], dict):
            summ = (row[0].get("personality_profile") or {}).get("executive_summary")
            if isinstance(summ, dict):
                summ = summ.get("summary") or summ.get("text")
            digest_summary = _clean(summ, DIGEST_CHARS)

    moves = []
    if name:
        for ev, des, eff in session.execute(
            text("select event_type, designation, effective_date from cxo_movements where lower(person_name)=lower(:n) limit 3"),
            {"n": name},
        ).fetchall():
            moves.append(_clean(f"{ev} {des} {eff or ''}", 120))

    return {
        "roles": roles, "education": edu, "skills": (p.skills or [])[:5], "posts": posts,
        "relevant_post_count": relevant_count, "digest": digest_summary, "moves": moves,
    }


def classify_level(p: Persona, ev: Dict[str, Any]) -> str:
    career = bool(ev["roles"])
    n = ev["relevant_post_count"]
    if career and n >= 5:
        return "A"
    if career or n >= 1 or ev["digest"]:
        return "B"
    if p.headline or p.linkedin_url or p.title:
        return "C"
    return "D"


def _person_prompt(p: Persona, ev: Dict[str, Any], brief_block: str, lob_name: Optional[str]) -> str:
    lines = [brief_block, "", f"PERSON: {p.full_name or p.display_name} | {p.title or ''}"]
    if p.headline and p.headline != p.title:
        lines.append(f"Headline: {_clean(p.headline, 200)}")
    if lob_name:
        lines.append(f"LOB: {lob_name}")
    if ev["roles"]:
        lines.append("Career: " + " ; ".join(ev["roles"]))
    if ev["education"]:
        lines.append("Education: " + " ; ".join(ev["education"]))
    if ev["skills"]:
        lines.append("Skills: " + ", ".join(ev["skills"]))
    if ev["moves"]:
        lines.append("Role changes: " + " ; ".join(ev["moves"]))
    if ev["digest"]:
        lines.append(f"Personality summary: {ev['digest']}")
    if ev["posts"]:
        lines.append("Recent mentions/posts:")
        lines.extend(f"- {x}" for x in ev["posts"])
    return "\n".join(lines)


def _group_prompt(key: Tuple[str, str], members: List[Persona], brief_block: str) -> str:
    seniority, function = key
    samples = sorted({_clean(m.title or m.headline, 90) for m in members if (m.title or m.headline)})[:8]
    return "\n".join([
        brief_block, "",
        f"GROUP: seniority={seniority}, function={function}, contacts={len(members)}",
        "Sample titles: " + " ; ".join(samples),
    ])


# ── Normalize + write ─────────────────────────────────────────────────────────

def _str_list(v: Any, n: int = 3) -> List[str]:
    return [_clean(x, 160) for x in (v or []) if x][:n] if isinstance(v, list) else []


def _objections(v: Any) -> List[Dict[str, str]]:
    out = []
    for o in (v or []) if isinstance(v, list) else []:
        if isinstance(o, dict) and (o.get("o") or o.get("objection")):
            out.append({"objection": _clean(o.get("o") or o.get("objection"), 200),
                        "counter": _clean(o.get("c") or o.get("counter"), 300)})
        elif isinstance(o, str):
            out.append({"objection": _clean(o, 200), "counter": ""})
    return out[:3]


def _apply(p: Persona, result: Dict[str, Any], icebreaker: str, meta: Dict[str, Any]) -> None:
    objs = _objections(result.get("objections"))
    p.value_proposition = _clean(result.get("value_proposition"), 600) or None
    p.personalized_icebreaker = _clean(icebreaker, 400) or None
    p.communication_style = _clean(result.get("communication_style"), 200) or None
    p.target_kpis = _str_list(result.get("target_kpis"))
    p.operational_pain_points = _str_list(result.get("operational_pain_points"))
    p.key_objections = [o["objection"] for o in objs]
    ep = dict(p.extended_profile or {})
    ep["callprep"] = {
        **meta,
        "objections": objs,
        "offerings": [o for o in (result.get("offerings") or []) if o in STRADIT_OFFERINGS],
        "evidence": _str_list(result.get("evidence")),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": CALLPREP_MODEL,
        "prompt_version": PROMPT_VERSION,
    }
    p.extended_profile = ep


def _fill_template(tpl: str, p: Persona) -> str:
    first = p.first_name or (p.full_name or "").split(" ")[0] or "there"
    title = _clean(p.title or "your role", 80)
    return (tpl or "").replace("{first_name}", first).replace("{title}", title)


def _backup(session, account: Account, personas: List[Persona]) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"backup_{account.key}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    rows = [{
        "id": p.id, "key": p.key, "value_proposition": p.value_proposition,
        "personalized_icebreaker": p.personalized_icebreaker, "communication_style": p.communication_style,
        "target_kpis": p.target_kpis, "operational_pain_points": p.operational_pain_points,
        "key_objections": p.key_objections, "callprep": (p.extended_profile or {}).get("callprep"),
    } for p in personas]
    path.write_text(json.dumps(rows, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return path


# ── Orchestration ─────────────────────────────────────────────────────────────

def generate_account(
    session,
    account_key: str,
    dry_run: bool = False,
    force: bool = False,
    limit: Optional[int] = None,
    only_keys: Optional[List[str]] = None,
    log=print,
    allow_daytime: bool = False,
) -> Dict[str, Any]:
    account = session.query(Account).filter_by(key=account_key).first()
    if not account:
        raise ValueError(f"Account '{account_key}' not found")

    personas = session.query(Persona).filter_by(account_id=account.id).order_by(Persona.hierarchy_level.nullslast(), Persona.id).all()
    if only_keys:
        personas = [p for p in personas if p.key in only_keys]
    lob_names = dict(session.execute(text("select id, lob_name from lobs where account_id=:i"), {"i": account.id}).fetchall())

    brief_info = get_account_brief(session, account, force=force, dry_run=dry_run, allow_daytime=allow_daytime)
    brief_block = _brief_block(brief_info["brief"])
    log(f"[callprep] account brief: {'cached' if brief_info.get('cached') else 'generated'} "
        f"(~{len(brief_block) // 4} tokens reused per call)")

    individuals, groups, skipped_d = [], defaultdict(list), []
    for p in personas:
        ev = _collect_person_evidence(session, p)
        level = classify_level(p, ev)
        if level in ("A", "B"):
            individuals.append((p, ev, level))
        elif level == "C":
            groups[(_seniority(p), _function(p))].append(p)
        else:
            skipped_d.append(p)

    stats = {
        "account": account.display_name, "personas": len(personas),
        "A": sum(1 for x in individuals if x[2] == "A"), "B": sum(1 for x in individuals if x[2] == "B"),
        "C": sum(len(v) for v in groups.values()), "C_groups": len(groups), "D_skipped": len(skipped_d),
        "llm_calls": 0, "unchanged": 0, "failed": 0,
        "prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0, "est_input_tokens": 0,
    }
    if not brief_info.get("cached") and not dry_run:
        stats["llm_calls"] += 1
        for k in ("prompt_tokens", "completion_tokens", "reasoning_tokens"):
            stats[k] += brief_info["usage"].get(k, 0)

    if not dry_run:
        log(f"[callprep] backup of current call-prep -> {_backup(session, account, personas)}")

    def _usage(u):
        stats["llm_calls"] += 1
        for k in ("prompt_tokens", "completion_tokens", "reasoning_tokens"):
            stats[k] += u.get(k, 0)

    def _stop(err):
        stats["stopped"] = str(err)[:200]
        log(f"  [!] stopping - {err}. Re-run later; finished personas are skipped by input_hash.")
        return stats

    # Group calls (C) first: each one covers many personas, so under a daily
    # request quota they give far more coverage per request than individuals.
    group_items = list(groups.items())[:limit] if limit else list(groups.items())
    for gi, (gkey, members) in enumerate(group_items, 1):
        prompt = _group_prompt(gkey, members, brief_block)
        h = _hash(PROMPT_VERSION, CALLPREP_MODEL, SYSTEM_GROUP, prompt)
        stats["est_input_tokens"] += (len(SYSTEM_GROUP) + len(prompt)) // 4
        if not force and all(((m.extended_profile or {}).get("callprep") or {}).get("input_hash") == h for m in members):
            stats["unchanged"] += len(members)
            continue
        if dry_run:
            continue
        try:
            result, usage = governed_llm(session, "callprep_batch", None, SYSTEM_GROUP, prompt, MAX_TOKENS_PERSON, allow_daytime)
        except QuotaExceeded as e:
            return _stop(e)
        except LLMError as e:
            stats["failed"] += len(members)
            log(f"  [!] group {gkey}: {e}")
            continue
        _usage(usage)
        tpl = result.get("icebreaker_template") or ""
        for m in members:
            _apply(m, result, _fill_template(tpl, m), {
                "level": "C", "method": f"llm_group:{gkey[0]}/{gkey[1]}", "confidence": "low",
                "group_size": len(members), "input_hash": h, "usage": usage,
            })
        session.commit()
        log(f"  [group {gi}/{len(group_items)}] {gkey[0]}/{gkey[1]} x{len(members)}: "
            f"in={usage['prompt_tokens']} out={usage['completion_tokens']}")

    # Individual calls (A/B)
    work = individuals[:limit] if limit else individuals
    for i, (p, ev, level) in enumerate(work, 1):
        prompt = _person_prompt(p, ev, brief_block, lob_names.get(p.lob_id))
        h = _hash(PROMPT_VERSION, CALLPREP_MODEL, SYSTEM_PERSON, prompt)
        stats["est_input_tokens"] += (len(SYSTEM_PERSON) + len(prompt)) // 4
        if not force and ((p.extended_profile or {}).get("callprep") or {}).get("input_hash") == h:
            stats["unchanged"] += 1
            continue
        if dry_run:
            continue
        try:
            result, usage = governed_llm(session, "callprep_batch", None, SYSTEM_PERSON, prompt, MAX_TOKENS_PERSON, allow_daytime)
        except QuotaExceeded as e:
            return _stop(e)
        except LLMError as e:
            stats["failed"] += 1
            log(f"  [!] {p.full_name}: {e}")
            continue
        _usage(usage)
        _apply(p, result, result.get("personalized_icebreaker", ""), {
            "level": level, "method": "llm_individual", "confidence": "high" if level == "A" else "medium",
            "input_hash": h, "usage": usage, "posts_used": len(ev["posts"]),
        })
        session.commit()
        log(f"  [{i}/{len(work)}] {level} {p.full_name}: in={usage['prompt_tokens']} out={usage['completion_tokens']} "
            f"(reasoning {usage['reasoning_tokens']})")

    return stats


def generate_persona(session, persona_id: int, force: bool = False, user_id: Optional[int] = None) -> Dict[str, Any]:
    """On-demand call-prep for ONE persona (profile page "Generate" button).

    Always an individual call, whatever the evidence level: a rep asking for
    one contact should get that contact's own brief, not the group template.
    Reuses the cached account brief, so a typical click costs ~1-1.5k tokens,
    and returns without any LLM call when the inputs are unchanged.
    """
    p = session.query(Persona).filter_by(id=persona_id).first()
    if not p:
        raise ValueError(f"Persona {persona_id} not found")
    account = session.query(Account).filter_by(id=p.account_id).first()

    brief_info = get_account_brief(session, account, feature="callprep", user_id=user_id)
    ev = _collect_person_evidence(session, p)
    level = classify_level(p, ev)
    lob_name = None
    if p.lob_id:
        lob_name = session.execute(text("select lob_name from lobs where id=:i"), {"i": p.lob_id}).scalar()
    prompt = _person_prompt(p, ev, _brief_block(brief_info["brief"]), lob_name)
    h = _hash(PROMPT_VERSION, CALLPREP_MODEL, SYSTEM_PERSON, prompt)

    existing = (p.extended_profile or {}).get("callprep") or {}
    if not force and existing.get("input_hash") == h and existing.get("method") == "llm_individual":
        return {"status": "unchanged", "persona": p, "level": level, "usage": {}}

    result, usage = governed_llm(session, "callprep", user_id, SYSTEM_PERSON, prompt, MAX_TOKENS_PERSON)
    _apply(p, result, result.get("personalized_icebreaker", ""), {
        "level": level, "method": "llm_individual",
        "confidence": {"A": "high", "B": "medium"}.get(level, "low"),
        "input_hash": h, "usage": usage, "posts_used": len(ev["posts"]), "trigger": "on_demand",
    })
    session.commit()
    return {"status": "generated", "persona": p, "level": level, "usage": usage,
            "account_brief_cached": bool(brief_info.get("cached"))}
