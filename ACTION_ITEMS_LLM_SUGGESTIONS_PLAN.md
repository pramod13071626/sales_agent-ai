# LLM-Generated Per-Individual Action Items — Implementation Plan

Extends `ACTION_ITEMS_IMPLEMENTATION_PLAN.md` §6.1 (auto-generation) with a
concrete design for suggesting action items **at the individual contact
level**, using the LLM infrastructure already built and running in this
codebase (the person digest + Personality Profile pipeline). Plan only —
nothing has been built yet.

## 0. Why this is feasible with what already exists

- **The exact input already gets computed for every person digest.**
  `apps/content_pipeline/digest/pipeline.py:128-154` already runs a
  second-stage LLM synthesis per persona (`build_personality_profile`,
  `digest/selection.py:194-239`) over that person's per-channel summaries
  (`channels`) plus their bio (`db.get_person_bio`, `db.py:535`). A
  suggestion generator needs the identical inputs — no new data collection,
  just a new prompt over data already assembled in the same function.
- **The LLM client, caching, and cost-control patterns are already proven.**
  `LLMClient`, `cache.content_signature()` (`digest/cache.py`), and the
  cheap/flagship model split (`channel_model()` vs. the flagship
  `email_client`) are all real, tested infrastructure from this session —
  not something to design from scratch.
- **The grounding method (`observed` → `interpretation`, cited
  `source_url`, `evidence_strength`) is already the house style** in every
  prompt in `prompts.py`, including `PERSONALITY_PROFILE_SYSTEM`
  (`prompts.py:465`). The new prompt should follow it exactly, for the same
  reason: an ungrounded suggestion is worse than no suggestion.
- **The action-items schema and API already exist** (built this session):
  `db/models/action_item.py`, `POST /api/accounts/{id}/action-items`
  (`api.py`). `source` is a free-text column
  (`action_item.py:30`, no DB constraint) and is never set by the existing
  create/update Pydantic models (`ActionItemCreateRequest`/
  `ActionItemUpdateRequest` in `api.py` never accept a `source` field) — so
  a new write path can use `source='llm_suggested'` today with zero schema
  change.

## 1. The one real design decision: suggest-and-approve, not auto-create

An LLM call over social posts can hallucinate or misjudge tone. Writing
directly into `action_items` with `status='open'` means a bad suggestion
sits in a rep's real work-list indistinguishable from a task they wrote
themselves. Instead:

- Add **`pending_review`** as a new valid `status` value (alongside the
  existing `open | in_progress | done | cancelled` — `api.py`'s
  `update_action_item` currently only accepts those four; extend that
  validation list).
- LLM-generated rows are created with `status='pending_review'`,
  `source='llm_suggested'`, and **no `assigned_to_id`** (nobody should be
  notified of a task nobody has approved yet — this also means the
  existing reassignment-notification code path in `update_action_item`
  is naturally silent until a human actually assigns it).
- Two new endpoints, not a repurposed generic PATCH: `POST
  /api/action-items/{id}/approve` (→ `status='open'`, optionally sets
  `assigned_to_id` to the approver) and `POST
  /api/action-items/{id}/reject` (→ `status='cancelled'`, so it's excluded
  from every existing open/overdue query without a schema change). Kept
  separate from the general-purpose PATCH so "approve" is one deliberate
  click, not a side effect of an unrelated field edit.
- `admin_dashboard_stats` (`api.py:429`) and the account tab's badge count
  should **not** count `pending_review` as "open" — a suggestion isn't
  work yet.

## 2. New LLM prompt (`apps/content_pipeline/digest/prompts.py`)

`PERSON_ACTION_SUGGESTIONS_SYSTEM`, appended after
`PERSONALITY_PROFILE_SYSTEM` (same file, same style):

- Input: the same `bio` dict and per-channel `channels` list already built
  in `pipeline.py:128-135` for the Personality Profile step — literally the
  same variables, passed to a second function call.
- Output: a JSON list of 0-3 suggestions (deliberately capped low — a
  10-item suggestion dump is noise, not help), each with:
  `title`, `description`, `priority` (`high|medium|low`), `suggested_due_days`
  (an integer offset from today, e.g. `3`, rather than an absolute date the
  model has no reliable sense of), `rationale` (why this is worth doing,
  citing which channel/fact it came from), `source_url` (must be a URL that
  already appeared in the supplied channel data — never invented, same hard
  rule as every other prompt in this file).
- Hard rule carried over from `PERSON_CHANNEL_SYSTEM` (`prompts.py:206`):
  if the channel evidence is thin/off-topic/a namesake collision, return an
  **empty list**, not a padded one. A quiet period with nothing worth
  suggesting is the common, honest case.

## 3. New builder function (`digest/selection.py`)

`build_action_item_suggestions(client, subject, bio, channels)` — mirrors
`build_personality_profile` (`selection.py:194-239`) exactly: same
prompt-assembly shape (bio lines + per-channel observed/summary blocks),
same `client.complete_json(...)` call.

## 4. Wiring into the existing pipeline (`digest/pipeline.py`)

Inside the existing `if is_person:` block (`pipeline.py:129-154`), right
after the Personality Profile step, add the same
cache-check → generate → cache-write pattern already there:

```python
suggestions_sig = cache.content_signature({"bio": bio, "channels": channels})
cached_suggestions = cache.get(key, "__action_suggestions__", suggestions_sig) if use_cache else None
if cached_suggestions is not None:
    action_suggestions = cached_suggestions
else:
    action_suggestions = build_action_item_suggestions(email_client, target["display_name"], bio, channels)
    if use_cache:
        cache.put(key, "__action_suggestions__", suggestions_sig, action_suggestions)
```

This reuses the exact caching mechanism that already prevents the
Personality Profile step from re-spending an LLM call on every digest
re-run — the same fix applies here for the same reason, and there is no
reason to duplicate it.

## 5. Writing suggestions into `action_items` (cross-app boundary)

This is the one genuinely new piece of code, because `action_items` is
owned by the **main app's** SQLAlchemy models
(`db/models/action_item.py`), while this write happens from
**`apps/content_pipeline`**, which only has raw `psycopg2` access
(`apps/content_pipeline/db.py`) — the same cross-schema pattern
`get_person_bio` (`db.py:535`) already uses to read `personas`/
`cxo_movements`. A new `db.py` function,
`create_llm_suggested_action_items(person_key, account_id, persona_id, suggestions)`,
does a plain parameterized `INSERT INTO action_items (...) VALUES (...)`
per suggestion — no ORM needed, matching every other write in that file.

Two things this function must resolve first, since `get_person_bio` today
returns bio fields but not `id`/`account_id` (`db.py:535` only selects
`title, degree, institution, ...` — extend that query, or add a sibling
one): the persona's own `id` (for `persona_id`) and its `account_id` (for
the required `account_id` FK). Both come from the same `personas` table
this function already queries by `key`.

Deduplication: before inserting, check for an existing
`action_items` row with the same `(persona_id, source, title)` — an LLM
re-run on unchanged data would otherwise create a duplicate suggestion
every digest cycle even with the content_signature cache, since the cache
only prevents re-*calling* the LLM, not re-*inserting* a previously-created
suggestion if the pipeline ever runs with `use_cache=False`
(`--all-posts`, the flag used earlier this session for the first
Personality Profile backfill).

## 6. Frontend changes (`frontend/js/modules/action-items.js`, `contact-drawer.js`)

- `STATUS_LABEL`/`STATUS_PILL` (`action-items.js:13-14`) gain a
  `pending_review` entry (label "Suggested", a distinct pill color so it
  visually reads as "not yet real work").
- `renderItemCard` (`action-items.js:52-80`): when `status ===
  'pending_review'`, replace the status `<select>` + Take/Done/Delete
  button row with two buttons — **Approve** (`POST .../approve`) and
  **Dismiss** (`POST .../reject`) — and show `rationale`/`source_url`
  inline (the same "why" the Personality Profile cards already surface via
  `basis` in `profile-render.js`, so this stays visually consistent with
  that existing pattern rather than inventing a new one).
- Add a `pending_review` filter chip alongside the existing four
  (`renderFilterChips`, `action-items.js:93-103`).
- The contact-drawer's persona-scoped section
  (`renderPersonaActionItems`, `action-items.js:171-182`) is the primary
  place these show up, since they're generated per-person — a rep opens a
  contact and sees "3 suggested actions" waiting for a decision, not
  something they have to discover on the account-wide tab.

## 7. Cost and rollout

- This adds one more flagship-model call (`email_client`, same tier as the
  Personality Profile and email-rollup steps) per person digest run — not
  per channel, so cost scales with contacts digested, not with post volume.
- Ship gated behind an opt-in flag (e.g. `--suggest-actions` on
  `main.py digest --person`, mirroring how `--all-posts` already exists as
  an explicit opt-in flag on the same command) rather than unconditionally
  on every person digest, so this can be validated on a handful of
  contacts (Robin Vince, say) before turning it on for the full roster.
- Phase order: (1) prompt + builder function, tested standalone against one
  person's existing cached channel data with no DB write; (2) the
  `pending_review` status + approve/reject endpoints in the main app,
  tested via curl exactly like every other endpoint this session; (3) the
  cross-app `db.py` write function; (4) wire into `pipeline.py` behind the
  opt-in flag; (5) frontend approve/dismiss UI last, once there's real
  suggested data in the database to render against.

## 8. Scope decision (confirmed)

Scoped to the existing `apps/content_pipeline/people_targets.py` roster for
now — suggestions only generate for people already registered there and
digested individually (e.g. Robin Vince), not automatically across every
persona in the main database. Running it against the full persona roster is
explicitly out of scope for this pass; it would first require solving
"which contacts are worth digesting at all," which is a separate,
larger problem than the LLM-suggestion mechanism itself.
