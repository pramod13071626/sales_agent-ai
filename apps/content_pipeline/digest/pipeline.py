"""Digest pipeline — per-channel summaries rolled into an account email."""
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict

from paths import DIGEST_DIR, digest_path, store_path
from store import ScrapeStore
from targets import resolve as resolve_company
from people_targets import resolve as resolve_person
import db

from . import cache
from .llm_client import LLMClient, LLMError, channel_model, describe_config
from .renderer import render_markdown
from .selection import (
    build_action_item_suggestions,
    build_email,
    build_personality_profile,
    select_posts,
    summarize_channel,
)


def run(
    company_key: str = None,
    new_only: bool = True,
    since_days: int = 14,
    cap: int = 25,
    out_dir: str = DIGEST_DIR,
    store_path_override: str = None,
    kind: str = "company",
    target: Dict[str, Any] = None,
    suggest_actions: bool = False,
) -> Dict[str, Any]:
    """Generate one account's (or one person's) digest and write JSON + Markdown.

    kind: "company" (targets.py, the default) or "person" (people_targets.py).
    Pass `target` (a dict with at least "key" and "display_name") to digest
    an ad-hoc target that isn't registered in targets.py/people_targets.py.

    suggest_actions: opt-in (person digests only) — also runs the LLM
    action-item-suggestion step and writes any results into the main app's
    action_items table as status='pending_review'. See
    ACTION_ITEMS_LLM_SUGGESTIONS_PLAN.md. Off by default so this doesn't
    silently start spending an extra flagship-model call (and creating DB
    rows) on every ordinary digest run.
    """
    is_person = kind == "person"
    target = target or (
        resolve_person(company_key) if is_person else resolve_company(company_key)
    )
    key = target["key"]
    target.setdefault("display_name", key)
    path = store_path_override or store_path(key)

    store = ScrapeStore(path)
    if not store.exists:
        # No local JSON store on this machine — fall back to Postgres, which
        # is the shared source of truth (same pattern the API server already
        # uses in main.py for GET /api/store).
        db_doc = db.get_store(key)
        if db_doc:
            store.doc = db_doc
        else:
            cli_flag = " --person" if is_person else ""
            raise FileNotFoundError(
                f"No store at {path} and nothing in the database for '{key}'. "
                f"Run: python main.py scrape {key}{cli_flag} --limit 20"
            )

    channel_client = LLMClient(model=channel_model())
    # The email step aggregates every channel's output in one call, so it
    # needs more output headroom than any single channel does — this is what
    # was hitting the 8000-token ceiling and getting cut off mid-JSON for
    # accounts with several channels' worth of capability_matches to roll up.
    email_client = LLMClient(max_tokens=16000)
    # A dry-run's placeholder text is deterministic *per prompt*, not a real
    # summary — caching it would mean a later run with a real key silently
    # keeps serving stale "[DRY RUN]" text instead of ever calling the model.
    use_cache = channel_client.provider != "dry-run" and channel_client.configured
    print(
        f"🧠  {target['display_name']} — LLM: {describe_config()} "
        f"(channels: {channel_client.model})"
    )

    channels, considered = [], 0
    for channel in store.doc.get("data", {}):
        posts = select_posts(store, channel, new_only, since_days, cap)
        if not posts:
            print(f"   {channel:<9} no posts in scope, skipped")
            continue

        sig = cache.signature(channel, posts)
        cached = cache.get(key, channel, sig) if use_cache else None
        if cached is not None:
            print(f"   {channel:<9} unchanged since last digest, reusing cached summary")
            channels.append(cached)
            considered += len(posts)
            continue

        print(f"   {channel:<9} summarising {len(posts)} posts…")
        try:
            result = summarize_channel(
                channel_client, target["display_name"], channel, posts, kind=kind
            )
            channels.append(result)
            considered += len(posts)
            if use_cache:
                cache.put(key, channel, sig, result)
        except LLMError as e:
            print(f"   {channel:<9} ❌ {e}")

    if not channels:
        raise RuntimeError("Nothing to summarise — no posts in scope.")

    try:
        email = build_email(
            email_client, target["display_name"], target.get("ticker"), channels, kind=kind
        )
    except LLMError as e:
        # Every channel above already made (and paid for) a real LLM call —
        # discarding all of that because only the final rollup call failed
        # is the single most expensive failure mode in this pipeline. Write
        # a degraded but honest email instead of losing that work; the
        # channel storylines below it are unaffected and still real.
        print(f"   email     ❌ {e}")
        email = {
            "subject": f"{target['display_name']} — digest (email synthesis failed)",
            "body": f"Channel-level summaries below are real and complete, but "
            f"the final email rollup failed: {e}. Re-run the digest to retry "
            "just the email step — the channel data is already cached.",
            "talking_points": [],
            "capability_opportunities": [],
            "priority": "low",
            "priority_reason": "Email synthesis failed; see data_gaps.",
            "confidence": "low",
            "do_not_say": [],
            "data_gaps": [f"Email synthesis error: {e}"],
        }

    personality_profile = None
    if is_person:
        bio = db.get_person_bio(key) or {}
        # Unlike the per-channel calls above, this step has no natural
        # "new_in_last_run" filter of its own — without caching it re-spent
        # a full LLM call on every single digest run even when every channel
        # below was itself a 100% cache hit (nothing had changed).
        profile_sig = cache.content_signature({"bio": bio, "channels": channels})
        cached_profile = cache.get(key, "__personality_profile__", profile_sig) if use_cache else None
        if cached_profile is not None:
            print("   personality profile  unchanged since last digest, reusing cached synthesis")
            personality_profile = cached_profile
        else:
            try:
                print("   personality profile  synthesising…")
                personality_profile = build_personality_profile(
                    email_client, target["display_name"], bio, channels
                )
                if use_cache:
                    cache.put(key, "__personality_profile__", profile_sig, personality_profile)
            except LLMError as e:
                print(f"   personality profile  ❌ {e}")
                personality_profile = {
                    "executive_summary": "Not generated — synthesis failed this run.",
                    "executive_profile": {},
                    "caveats": [f"Personality profile synthesis error: {e}"],
                }

        if suggest_actions:
            # Same cache-signature pattern as personality_profile above —
            # this is a second flagship-model call, so it must not re-run
            # (and re-write duplicate DB rows) on an unchanged digest.
            suggestions_sig = cache.content_signature({"bio": bio, "channels": channels})
            cached_suggestions = cache.get(key, "__action_suggestions__", suggestions_sig) if use_cache else None
            if cached_suggestions is not None:
                print("   action suggestions   unchanged since last digest, reusing cached synthesis")
                action_suggestions = cached_suggestions
            else:
                try:
                    print("   action suggestions   synthesising…")
                    action_suggestions = build_action_item_suggestions(
                        email_client, target["display_name"], bio, channels
                    )
                    if use_cache:
                        cache.put(key, "__action_suggestions__", suggestions_sig, action_suggestions)
                except LLMError as e:
                    print(f"   action suggestions   ❌ {e}")
                    action_suggestions = []

            if action_suggestions:
                inserted = db.create_llm_suggested_action_items(key, action_suggestions)
                print(f"   action suggestions   {len(action_suggestions)} suggested, "
                      f"{inserted} new (status=pending_review, awaiting review)")
            else:
                print("   action suggestions   nothing suggested this run")

    digest = {
        "company": target["display_name"],
        "company_key": key,
        "kind": kind,
        "ticker": target.get("ticker"),
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scope": {
            "new_only": new_only,
            "since_days": since_days,
            "max_posts_per_channel": cap,
            "store": path,
            "store_last_run": store.last_run(),
        },
        "llm": describe_config(),
        "posts_considered": considered,
        "email": email,
        "channels": channels,
    }
    if personality_profile is not None:
        digest["personality_profile"] = personality_profile

    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, f"{key}_digest.json")
    md_path = os.path.join(out_dir, f"{key}_digest.md")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(digest, fh, indent=2, ensure_ascii=False)
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write(render_markdown(digest))

    print(f"💾  {json_path}")
    print(f"💾  {md_path}")
    db.upsert_digest(key, kind, digest)
    return digest


