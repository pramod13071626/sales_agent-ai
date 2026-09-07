# Action / Work-List Feature — Implementation Plan

Scope: client-specific action items (tasks tied to an account, optionally a
specific contact), completion tracking, status, and proactive reminders.
This is a plan only — nothing has been built yet.

## 0. What's actually in this codebase today

Confirmed by direct search, not assumption:

- **No existing task/todo/action-item concept anywhere.** Zero matches for
  task/todo/action_item/follow_up/reminder across `api.py`, `db/models/`,
  and `frontend/js/modules/`. This is a green-field addition, not an
  extension of something partial.
- **Celery is a dependency, not a running system.** `requirements.txt` has
  `celery>=5.3.0` / `redis>=5.0.0`, and `.env` has
  `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND`/`CELERY_SCHEDULE_DAYS=15` — but
  there is no `celery_app.py`, no `@app.task`, no beat schedule, nothing
  importing `Celery(...)` anywhere in the repo. It's unused infrastructure
  sitting in config, not a foundation to build reminders on without first
  standing up a worker + beat process.
- **`WeeklyDigestSnapshot` is an archive, not a reminder system.** It's a
  pure snapshot table (`db/models/weekly_digest.py`) written by
  `POST /api/accounts/{id}/weekly-updates/sync` (`api.py:1984-2010`), which
  only inserts a row if that `(account_id, generated_at)` pair isn't already
  archived — **no email is ever sent from that code path**. There is
  currently no scheduled/push email of any kind in this app; only the
  request-triggered auth emails (welcome, password reset) built this
  session send anything automatically.
- **Only two email senders exist**: `apps/content_pipeline/mailer.py`
  (Microsoft Graph, needs an interactive device-code login, single mailbox)
  and root `email_sender.py` (plain SMTP via `.env` `SMTP_*`, already used
  for auth emails, already supports styled HTML via `render_html()`). Reuse
  `email_sender.py` — it's already proven working in this exact codebase.
- **Auth/authorization pieces already built and directly reusable**
  (`auth.py`): `get_current_user`, `require_role(*roles)`,
  `require_account_access(account_id, user=Depends(get_current_user))` (super_admin
  bypasses, else requires a `UserAccountAccess` row), and
  `require_persona_account_access(persona_id, ...)` (resolves the persona's
  account first, then the same check). New endpoints should reuse these
  exactly, not reinvent access control.
- **Migration pattern** (`db/create_tables.py`): `Base.metadata.create_all`
  plus a hardcoded list of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  statements, each swallowed on error. A new model needs zero changes to
  that file — just register it in `db/models/__init__.py` and rerun
  `python db/create_tables.py`.
- **Frontend tab system** (`frontend/js/modules/account-tabs.js`): tabs are
  an `if/else if` chain on `state.activeSalesTab` (lines 336-350) plus a
  hardcoded row of buttons (lines 373-391), switched by one delegated click
  listener. Worth noting: the `financials` tab is dispatched in the chain
  but **has no button in the nav row today** — it's dead/unreachable via the
  UI. Don't repeat that mistake for the new tab.
- **Contact drawer** (`contact-drawer.js`) is an anchor-nav (`scrollIntoView`
  on `data-jump` targets), not a lazy-rendered tab switcher — every section
  renders at once into `drawerBody`. A per-contact action list section there
  follows that same always-rendered pattern, not a new tab-fetch cycle.

## 1. Data model

### `action_items` (new table)

| column | type | notes |
|---|---|---|
| id | Integer PK | |
| account_id | FK → accounts.id, CASCADE, not null, indexed | client-specific — every item belongs to exactly one account |
| persona_id | FK → personas.id, SET NULL, nullable, indexed | optional — ties the item to a specific contact within the account |
| title | String(500), not null | |
| description | Text, nullable | |
| status | String(20), not null, default `'open'` | `open \| in_progress \| done \| cancelled` — plain string column, matching this codebase's existing convention (`personas.tier`, `users.role`) over a Postgres enum |
| priority | String(20), not null, default `'medium'` | `high \| medium \| low` |
| due_date | DateTime(timezone=True), nullable | drives reminders and overdue detection |
| assigned_to_id | FK → users.id, SET NULL, nullable, indexed | the rep responsible; nullable so an item can exist unassigned |
| created_by_id | FK → users.id, SET NULL, nullable | audit trail of who created it |
| source | String(50), nullable | `manual \| cxo_movement \| opportunity_signal \| weekly_digest` — where it came from, see §5 auto-generation |
| source_ref_id | Integer, nullable | id of the originating row (e.g. a `cxo_movements.id`) when `source != 'manual'`, so the UI can link back to it |
| completed_at | DateTime(timezone=True), nullable | set when status → `done` |
| created_at / updated_at | DateTime(timezone=True) | same `default=lambda: datetime.now(timezone.utc)` / `onupdate=...` convention as every other model in `db/models/` |

### `action_item_reminders` (new table — reminder log, not just a timestamp column)

A separate log table rather than a single `reminder_sent_at` column on
`action_items`, so multiple reminder *stages* (due-soon vs. overdue) are
each tracked once and never double-sent, and so there's a queryable history.

| column | type | notes |
|---|---|---|
| id | Integer PK | |
| action_item_id | FK → action_items.id, CASCADE, not null, indexed | |
| reminder_type | String(30), not null | `due_soon \| overdue \| assigned` |
| sent_at | DateTime(timezone=True), not null | |
| sent_to_user_id | FK → users.id, SET NULL, nullable | |

`UniqueConstraint(action_item_id, reminder_type)` for `due_soon`/`overdue`
(each fires once per item — re-fires only if the due date changes, see §4)
is deliberately **not** applied to `assigned`, since an item can be
reassigned more than once.

### `action_item_comments` (new table — optional, see §6 enhancements)

Lightweight activity thread, same shape as `AuditLog` but scoped to one
item: `id`, `action_item_id` (FK, CASCADE), `author_id` (FK → users.id, SET
NULL), `body` (Text), `created_at`. Ship in Phase 2, not Phase 1 — the core
feature (create/assign/track/remind) doesn't need it to be useful.

## 2. API endpoints (`api.py`, same function-based style as every existing route)

All account-scoped reads/writes reuse `Depends(auth.require_account_access)`
exactly like the existing weekly-updates/opportunities/signals endpoints do
— no new authorization concept needed.

| Endpoint | Method | Access |
|---|---|---|
| `/api/accounts/{account_id}/action-items` | GET | `require_account_access` — list, with query params for `status`, `assigned_to_id`, `persona_id` |
| `/api/accounts/{account_id}/action-items` | POST | `require_account_access` — create |
| `/api/action-items/{item_id}` | PATCH | new `require_action_item_account_access` dependency (same pattern as `require_persona_account_access`: resolve `action_items.account_id`, then the standard check) — update any field, including `status` |
| `/api/action-items/{item_id}` | DELETE | same | prefer this over letting status become the only way to remove a mistaken entry |
| `/api/action-items/{item_id}/complete` | POST | same | convenience: sets `status='done'`, `completed_at=now()` in one call, for a one-click "Done" button |
| `/api/me/action-items` | GET | `get_current_user` | cross-account "My Tasks" — every item assigned to the caller, further filtered by their account access (super_admin sees all of theirs; a `user` only sees items on accounts they're granted) |

## 3. Admin dashboard integration

`GET /api/admin/stats` (`api.py:429-475`) already computes its numbers
inline per-request with plain `session.query(...).count()` calls — no
caching layer to work around. Add two more counts to the same returned
dict: `open_action_items` and `overdue_action_items` (`due_date < now()` and
`status not in ('done','cancelled')`). Zero new infrastructure, matches the
existing pattern exactly.

## 4. Proactive reminders — the part with no existing foundation

There is genuinely nothing to hook into here (§0) — this needs its own
scheduling mechanism. Two real options, not a false binary:

**Recommended for now: a standalone script + OS-level scheduler.**
`scripts/send_action_reminders.py` (matches the existing `scripts/`
convention — `create_super_admin.py`, `reconcile_targets_accounts.py` are
already exactly this shape: a plain script importing this app's own
modules, run manually or via an external scheduler). It would:

1. Query `action_items` where `status not in ('done','cancelled')` and
   either `due_date` is within the next 24h (→ `due_soon`) or `due_date <
   now()` (→ `overdue`).
2. For each, check `action_item_reminders` for an existing row with that
   `(action_item_id, reminder_type)` — skip if already sent (this is what
   makes the reminder table a log, not a single flag: the due-soon
   reminder and the later overdue reminder are two distinct, independently-
   tracked sends for the same item).
3. Send via `email_sender.send_email(..., html_body=email_sender.render_html(...))`
   to `assigned_to.email` — reuses the exact function and branded template
   already built and proven this session for auth emails.
4. Insert the `action_item_reminders` row so it isn't sent again.
5. Run it via Windows Task Scheduler (this is a Windows dev box per the
   environment) or cron, e.g. every 30-60 minutes — no new long-running
   process, no Redis/Celery worker to keep alive.

**Upgrade path, not required now: wire up the existing Celery dependency.**
Since `celery`/`redis` are already declared, the same reminder logic could
become a `celery beat` periodic task instead of an OS-scheduled script —
worth doing once there's an actual multi-instance deployment where "run a
script on a schedule" stops being operationally simple. Don't build this
first; it requires standing up a worker + beat process that doesn't exist
today for zero behavioral difference at current scale.

**Assignment notification** (`reminder_type='assigned'`) fires
synchronously instead, from the `PATCH /api/action-items/{item_id}`
handler itself when `assigned_to_id` changes — via FastAPI
`BackgroundTasks`, exactly like `create_user`/`forgot_password` already do
in `api.py`, so the API response isn't blocked on the SMTP round-trip
(this was a real bug fixed earlier this session — don't reintroduce it here).

## 5. Frontend

### Per-account tab
Add `action-items` to the `if/else if` chain in `renderCenter()`
(`account-tabs.js:336-350`) **and** add its button to the nav row
(lines 373-391) in the same change — the `financials` tab's dead button is
a cautionary example of doing only the first half.

Render: a filterable list (status/priority/assignee), each row showing
title, due date (color-coded if overdue), assignee, a one-click "Mark Done"
button hitting the `/complete` endpoint, and an "Add Action Item" form
(title, description, due date, assignee, optional persona link — populated
from that account's already-loaded `personas` list, no new fetch needed).

### Contact drawer section
Add an always-rendered `drawer-sec-actions` block (matching the existing
`drawer-sec-overview`/`-dossier`/`-social`/`-profiles` pattern in
`contact-drawer.js`) showing action items scoped to `persona_id` — reuses
the account-level list component, just pre-filtered.

### "My Tasks" widget
A cross-account panel on the main dashboard (`digest.js`'s render path,
alongside the existing digest sections) backed by `GET /api/me/action-items`
— the one place a rep sees everything assigned to them without opening each
account individually.

### State additions (`state.js`)
Following the existing per-scope-object convention (`weeklyUpdateHistory`,
`opportunityHistory`, `contentStore`): add
`actionItemsByAccount: {}` (accountId → items array),
`myActionItems: []`, and `activeActionItemStatus: 'open'` (the current
filter, following `activeSalesTab`'s naming style).

## 6. Enhancements beyond the MVP (in rough priority order)

1. **Auto-generated action items from data already in this database.** This
   app already detects real signals with no action taken on them —
   `cxo_movements` (e.g. a new CEO — "send a congratulations note"),
   `opportunity_signals` (a growth theme — "follow up on X"), and a
   high-priority `weekly_digest_snapshots` row. A background job could
   create a `source='cxo_movement'` / `source='opportunity_signal'` action
   item automatically when these are detected, pre-filled and ready to
   assign — turning already-collected intelligence into an actual to-do
   instead of something a rep has to notice on their own.
2. **Comment/activity thread per item** (§1's `action_item_comments`) — for
   collaboration on a task rather than status alone.
3. **SLA escalation** — if an item stays overdue past a second threshold
   (e.g. 3 days), notify the assignee's account-granting super_admin, not
   just the assignee.
4. **Recurring items** — a `recurrence_rule` (e.g. "quarterly check-in")
   that spawns the next instance when the current one is completed.
5. **Kanban board view** (open / in_progress / done columns) as an
   alternative to the list view, same underlying data and endpoints.
6. **Bulk actions** — multi-select to reassign or mark several items done
   at once.
7. **Snooze** — push `due_date` forward without losing history; track a
   `snooze_count` so a chronically-snoozed item is visible as such.
8. **Fold into the weekly digest email** — once §4's reminder mechanism
   exists, the same query (open items due this week for an account) can be
   embedded directly into whatever eventually sends the weekly digest as
   real email rather than just archiving it (see §0 — that email doesn't
   exist yet either; a natural joint follow-up).
9. **Slack/Teams webhook as an alternative reminder channel** — for a sales
   team, a channel ping may land better than an email for daily nudges;
   additive to email, not a replacement.
10. **Simple search** — `ILIKE` on `title`/`description`; no search
    infrastructure exists elsewhere in this codebase to build on, so keep
    this basic rather than introducing a new dependency for it.

## 7. Phased rollout

1. **Phase 0 — data model.** Add `ActionItem`/`ActionItemReminder` models,
   register in `db/models/__init__.py`, run `db/create_tables.py`.
2. **Phase 1 — CRUD + access control.** The six endpoints in §2, all via
   the already-built `auth.require_account_access` (plus one new
   `require_action_item_account_access` following the existing
   `require_persona_account_access` pattern).
3. **Phase 2 — frontend.** Per-account tab (list + create + complete),
   contact-drawer section, "My Tasks" widget, admin-stats counts.
4. **Phase 3 — proactive reminders.** `scripts/send_action_reminders.py` +
   OS-level schedule (§4), assignment-notification background task.
5. **Phase 4 — enhancements.** Pick from §6 based on actual usage once
   Phases 0-3 are live — auto-generation from `cxo_movements`/
   `opportunity_signals` (§6.1) is the highest-leverage one, since it turns
   data this app already collects into work reps actually see.
