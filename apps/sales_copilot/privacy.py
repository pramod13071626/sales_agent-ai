"""Contact-data rules (README §11.3): work email/phone may be shown to anyone with
account access; personal email and personal mobile must never be shown.

Enrichment sometimes copies the same value into both the work and the personal
column (measured 2026-09-24: 15 of 16 personal_email values equal `email`, 16 of 17
direct_mobile_phone values equal `phone`). So the rule is enforced on VALUES, not
just on column names:
  * phone — hidden when it is the person's direct mobile number — unless that "mobile" is
            recorded for 3+ people (measured: 16 BlackRock contacts share the public HQ
            switchboard as their "direct mobile"), which makes it a company line;
  * email — hidden when it is a free-mail address (gmail, outlook, …), wherever it is
            stored. A company-domain address copied into personal_email is still the
            work email and stays visible.
Use these SQL expressions wherever contact fields are selected (persona table aliased `p`).
"""

FREEMAIL = ("gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com",
            "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "rediffmail.com", "gmx.com", "zoho.com")

_FREEMAIL_SQL = ", ".join(f"'{d}'" for d in FREEMAIL)

# Also hides malformed addresses (enrichment produced 7 like "first.m. last@bny.com"), so no page
# offers a mailto: link or pre-fills a draft with an address that can't receive mail.
SAFE_EMAIL_SQL = (f"CASE WHEN split_part(lower(coalesce(p.email, '')), '@', 2) IN ({_FREEMAIL_SQL}) "
                  "OR p.email !~ '^[^@[:space:],;]+@[^@[:space:],;]+[.][^@[:space:],;]+$' THEN NULL ELSE p.email END")

SHARED_LINE_MIN = 3   # a "mobile" recorded for >= 3 people is a company switchboard, not a personal number

SAFE_PHONE_SQL = r"""CASE WHEN p.direct_mobile_phone IS NOT NULL
        AND right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(p.direct_mobile_phone, '\D', '', 'g'), 10)
        AND NOT (right(regexp_replace(p.direct_mobile_phone, '\D', '', 'g'), 10) = ANY (coalesce(
             -- uncorrelated: Postgres evaluates this once per query (InitPlan), not once per row
             (SELECT array_agg(d) FROM (SELECT right(regexp_replace(p2.direct_mobile_phone, '\D', '', 'g'), 10) AS d
                                        FROM personas p2 WHERE p2.direct_mobile_phone IS NOT NULL
                                        GROUP BY 1 HAVING count(*) >= 3) shared_lines), '{}')))
    THEN NULL ELSE p.phone END"""


# ── Python equivalents, for API payloads built from ORM objects ──────────────
import re as _re
from typing import Any, Optional

# extended_profile keys that are personal (README §11.3) — never sent to the browser
EXTENDED_PROFILE_HIDDEN = {"home_address", "political_affiliation", "political_donations", "fec_query_names", "age"}
# raw_data keys that hold personal contact data
RAW_PERSONAL_KEYS = {"personal_email", "personal_emails", "direct_mobile_phone", "mobile_phone", "mobile_phones",
                     "personal_phone", "home_address", "home_phone"}


def _digits(s: Any) -> str:
    """Comparable phone key: the last 10 digits, so "+1 212-810-5300" == "212-810-5300"."""
    return _re.sub(r"\D", "", str(s or ""))[-10:]


def safe_email(email: Optional[str]) -> Optional[str]:
    """Work email only: a free-mail address is personal wherever it is stored."""
    if email and email.split("@")[-1].strip().lower() in FREEMAIL:
        return None
    if email and not _re.fullmatch(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+", email.strip()):
        return None                      # malformed — not a deliverable address
    return email


_shared_cache: dict = {"at": 0.0, "numbers": frozenset()}


def shared_lines() -> frozenset:
    """Digits of "mobile" numbers recorded for SHARED_LINE_MIN+ people (company switchboards). Cached 10 min."""
    import time
    if time.time() - _shared_cache["at"] > 600:
        from sqlalchemy import text as _text
        from db.connection import engine
        try:
            # Own short-lived connection with a lock timeout: callers usually hold a transaction on
            # `personas`, and a queued DDL (db/create_tables.py runs ALTERs on startup) must never
            # make this wait — that combination deadlocked once.
            with engine.connect() as c:
                c.execute(_text("SET LOCAL lock_timeout = '2s'"))
                rows = c.execute(_text("""SELECT right(regexp_replace(direct_mobile_phone, '[^0-9]', '', 'g'), 10) FROM personas
                                          WHERE direct_mobile_phone IS NOT NULL GROUP BY 1 HAVING count(*) >= :n"""),
                                 {"n": SHARED_LINE_MIN}).fetchall()
            _shared_cache.update(at=time.time(), numbers=frozenset(r[0] for r in rows))
        except Exception:
            # Keep the last known value; if we never had one, the empty set means every
            # mobile counts as personal (hidden) — the safe default. Retry in a minute.
            _shared_cache["at"] = time.time() - 540
    return _shared_cache["numbers"]


def is_personal_mobile(direct_mobile: Optional[str]) -> bool:
    d = _digits(direct_mobile)
    return len(d) >= 7 and d not in shared_lines()


def safe_phone(phone: Optional[str], direct_mobile: Optional[str]) -> Optional[str]:
    """Hide the phone when it is the person's own direct mobile (enrichment copies it into `phone`)."""
    if phone and direct_mobile and _digits(phone) == _digits(direct_mobile) and is_personal_mobile(direct_mobile):
        return None
    return phone


def scrub_extended_profile(ep: Any) -> Any:
    if not isinstance(ep, dict):
        return ep
    return {k: v for k, v in ep.items() if k not in EXTENDED_PROFILE_HIDDEN}


def scrub_raw(obj: Any, personal_email: Optional[str], direct_mobile: Optional[str]) -> Any:
    """Recursively drop personal-contact keys and redact the person's personal email/mobile values."""
    pe = (personal_email or "").strip().lower()
    pe = pe if (pe and pe.split("@")[-1] in FREEMAIL) else ""       # company addresses are work emails
    mob = _digits(direct_mobile) if is_personal_mobile(direct_mobile) else ""

    def walk(x: Any) -> Any:
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items() if str(k).lower() not in RAW_PERSONAL_KEYS}
        if isinstance(x, list):
            return [walk(v) for v in x]
        if isinstance(x, str):
            if pe and pe in x.lower():
                return _re.sub(_re.escape(pe), "[redacted]", x, flags=_re.I)
            if mob and mob in _digits(x) and len(_digits(x)) <= len(mob) + 4:
                return "[redacted]"
        return x
    return walk(obj)
