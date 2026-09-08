# Task Management — How It Works Today

Research notes on the existing action-item ("task") system in this codebase,
written to inform building a dedicated Task Management page. Everything
below is confirmed by reading the actual code (`db/models/action_item.py`,
`db/models/action_item_reminder.py`, `api.py`, `frontend/js/modules/action-items.js`,
`scripts/send_action_reminders.py`) — not the original design docs alone,
though those (`ACTION_ITEMS_IMPLEMENTATION_PLAN.md`,
`ACTION_ITEMS_LLM_SUGGESTIONS_PLAN.md`) matched what's actually implemented.

## TL;DR

A full task system already exists end-to-end: data model, 7 REST endpoints,
access control, three frontend surfaces (per-account tab, per-contact
section, cross-account "My Tasks" drawer), an LLM-suggestion pipeline, and a
scheduled reminder-email script. **What's missing is a dedicated,
full-page Task Management view** — today a rep only sees their tasks either
one account at a time, or as a flat list in a small topbar drawer. There's
also no "team/manager" view — every list endpoint is scoped to either one
account or "tasks assigned to me," never "every task across my team."

---

## 1. Data model

### `action_items`

| column | type | notes |
|---|---|---|
| `id` | int PK | |
| `account_id` | FK → `accounts.id`, CASCADE, **required** | every task belongs to exactly one account |
| `persona_id` | FK → `personas.id`, SET NULL, optional | ties it to one contact within the account |
| `title` | string(500), required | |
| `description` | text, optional | for LLM-suggested items, this doubles as the rationale/source (see §4) |
| `status` | string(20), default `open` | `pending_review \| open \| in_progress \| done \| cancelled` |
| `priority` | string(20), default `medium` | `high \| medium \| low` |
| `due_date` | datetime, optional | drives overdue detection + reminders |
| `assigned_to_id` | FK → `users.id`, SET NULL, optional | nullable — an item can be unassigned |
| `created_by_id` | FK → `users.id`, SET NULL, optional | audit trail |
| `source` | string(50), default `manual` | `manual \| llm_suggested` (values seen in practice today; `cxo_movement`/`opportunity_signal` were planned but nothing currently writes them — see §7 gap) |
| `source_ref_id` | int, optional | id of the originating row, when `source != manual` |
| `completed_at` | datetime, optional | set automatically when status → `done` |
| `created_at` / `updated_at` | datetime | standard timestamps |

### `action_item_reminders` (reminder send-log, not a single flag)

| column | notes |
|---|---|
| `action_item_id` | FK, CASCADE |
| `reminder_type` | `due_soon \| overdue \| assigned` |
| `sent_at`, `sent_to_user_id` | |

`UniqueConstraint(action_item_id, reminder_type, sent_to_user_id)` — each
reminder *stage* fires once per assignee. `assigned` is excluded from ever
being treated as "already sent forever" because an item can be reassigned
more than once (a new assignee should still get notified).

---

## 2. API surface (`api.py`, tag `"8. Action Items"`)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/accounts/{account_id}/action-items` | GET | `require_account_access` | list one account's items; query params `status`, `assigned_to_id`, `persona_id` |
| `/api/accounts/{account_id}/action-items` | POST | `require_account_access` | create (`ActionItemCreateRequest`: title, description, persona_id, priority, due_date, assigned_to_id) |
| `/api/action-items/{item_id}` | PATCH | `require_action_item_account_access` | edit any field incl. `status` (excluding `pending_review` — see §4). Sends an "assigned to you" email via `BackgroundTasks` if `assigned_to_id` changes |
| `/api/action-items/{item_id}` | DELETE | same | hard delete |
| `/api/action-items/{item_id}/complete` | POST | same | one-click: `status='done'`, `completed_at=now()` |
| `/api/action-items/{item_id}/approve` | POST | same | LLM suggestion → real task: `status='open'`, `assigned_to_id` = approver |
| `/api/action-items/{item_id}/reject` | POST | same | LLM suggestion → `status='cancelled'` (kept, not deleted, as a record) |
| `/api/me/action-items` | GET | `get_current_user` | **cross-account** — every item assigned to the caller, further filtered by their account access |

**No endpoint lists tasks across accounts/users other than "assigned to
me."** There's no `/api/action-items` (global) and no "everyone on my team's
tasks" endpoint. `GET /api/admin/stats` only returns two aggregate *counts*
(`open_action_items`, `overdue_action_items`) — not a list.

### Access control (`auth.py`, all reused, nothing new needed)

- `require_account_access(account_id, ...)` — `super_admin` bypasses;
  anyone else needs an explicit `UserAccountAccess` grant for that account.
- `require_action_item_account_access(item_id, ...)` — resolves the item's
  `account_id` first, then applies the same check. Same pattern as
  `require_persona_account_access`.
- Practical effect: a regular user can only create/see/edit tasks on
  accounts a super_admin has granted them. `GET /api/me/action-items`
  additionally filters to those same accounts even though it's nominally
  "my tasks."

---

## 3. Frontend surfaces today

Three places render tasks, all sharing helpers from
`frontend/js/modules/action-items.js` (fetch/cache/render/mutate — one
source of truth for a task card's markup):

1. **Per-account "Action Items" tab** (`account-tabs.js`, `state.activeSalesTab === 'action-items'`)
   — a create form + filterable list (status chips: Suggested/Open/In
   Progress/Done/Cancelled/All), each card with a status `<select>`, Take
   (self-assign), Done, Delete buttons.
2. **Contact drawer, per-persona section** (`contact-drawer.js` →
   `renderPersonaActionItems`) — same cards, pre-filtered to one persona,
   plus a quick-add (`window.prompt`, not a full form).
3. **"My Tasks" drawer** (topbar, `topbar-auth.js` + `action-items.js` →
   `renderMyTasksPanel`) — cross-account, read-only cards (no inline
   actions), backed by `GET /api/me/action-items`. This is the *only*
   cross-account view that exists today, and it's a small slide-out panel,
   not a page.

State lives in `state.js`: `actionItemsByAccount` (per-account cache),
`myActionItems`, `activeActionItemStatus` (current filter).

**Styling**: `frontend/css/action-items.css` — card/pill/filter-chip
classes (`.action-item-card`, `.pill-*`, `.aitem-*`). Any new task UI should
reuse these classes rather than inventing new ones, for visual consistency.

---

## 4. Where tasks come from

- **Manual** — the create form (account tab) or quick-add (contact drawer).
  `source='manual'`.
- **LLM-suggested** (`source='llm_suggested'`) — a second-stage LLM call in
  `apps/content_pipeline/digest/pipeline.py` (per-person digest run) can
  generate 0-3 suggestions per contact, written with `status='pending_review'`
  and **no assignee**. The rationale + source URL are folded into
  `description` as `"...\n\nWhy: <rationale> — Source: <url>"` (no separate
  columns — parsed back out client-side by
  `splitSuggestionDescription()` in `action-items.js`). A rep must
  Approve (→ `open`, self-assigned) or Dismiss (→ `cancelled`) — never
  auto-promoted to a real task. Gated behind an opt-in CLI flag
  (`--suggest-actions`) on the content-pipeline app, scoped to a specific
  people-targets roster, not the whole persona database.
- **Sales Command Center** (`/command-center`, this session's work) — "Create
  task" (signal feed rows, dossier drawer) and "Push to CRM" (playbook)
  resolve a display name to a real `accounts.id` and `POST` a `source='manual'`,
  self-assigned item. This is the newest write path and works exactly like
  the manual form — Command Center has no special task type of its own.

---

## 5. Reminders (`scripts/send_action_reminders.py`)

Not a running service — a standalone script meant to be triggered by an
OS-level scheduler (Windows Task Scheduler / cron), since **no Celery
worker or beat process actually runs in this codebase** (the dependency is
declared, nothing imports it). Logic:

1. Query `open`/`in_progress` items with a `due_date`.
2. Overdue (`due_date < now`) → `reminder_type='overdue'`; due within
   `--due-soon-hours` (default 24) → `reminder_type='due_soon'`.
3. Skip if that `(item, type, assignee)` triple is already in
   `action_item_reminders` — idempotent, safe to run as often as you like.
4. Send via `email_sender.send_email()` (same SMTP sender already used for
   auth emails), log the send.
5. Unassigned items are silently skipped — nobody to notify.

Separately, **assignment** notifications (`reminder_type='assigned'`) fire
synchronously from `PATCH /api/action-items/{id}` itself (via
`BackgroundTasks`, not this script) whenever `assigned_to_id` changes.

---

## 6. Admin visibility

`GET /api/admin/stats` (super_admin only) includes `open_action_items` and
`overdue_action_items` as plain counts alongside user/account stats — no
breakdown by user, account, or priority, and no way to click through to the
underlying list from there today.

---

## 7. Gaps — what does not exist yet

Confirmed absent by reading the code, not assumed:

1. **No dedicated Task Management page/route.** Everything is either
   scoped to one account (the tab) or squeezed into a small topbar drawer
   (My Tasks). There's no `/tasks`-style page with real filtering, sorting,
   or bulk actions.
2. **No cross-user / team view.** Every endpoint is either
   account-scoped or "assigned to me." A manager cannot see "everything my
   team owes" without opening each account's tab individually. Building
   that needs a new endpoint (e.g. `GET /api/action-items?assigned_to_id=&account_id=&status=`
   for `super_admin`, or team-scoped once a manager concept exists).
3. **No Kanban / board view** — only a flat filtered list.
4. **No bulk actions** (multi-select reassign / complete / delete).
5. **No comment/activity thread per item** (`action_item_comments` was
   planned, never built).
6. **No snooze** (push `due_date` forward with history).
7. **No recurring tasks.**
8. **No search** (title/description `ILIKE` or otherwise).
9. **`source` values `cxo_movement` / `opportunity_signal` are unused** —
   only `manual` and `llm_suggested` are ever written today, even though
   the column supports arbitrary values and the original plan described
   auto-generating items from exec movements / opportunity signals. This
   is real, already-collected data (`cxo_movements`, and whatever backs
   "opportunity signals") that isn't yet turned into tasks automatically.
10. **No global admin task list** — stats are counts only, not a browsable
    list from the admin dashboard.

---

## 8. Recommended shape for the new Task Management page

Given the above, and matching how `/command-center` was built (same
`.dash-shell`/topbar/nav chrome, plain ES modules, real API data, no
framework):

- **New route + template**, e.g. `/tasks` → `frontend/templates/tasks.html`,
  registered in `api.py` next to the `/command-center` route, reusing
  `partials/topbar.html` + `partials/nav.html` for a consistent shell.
- **Reuse `action-items.js`'s render/mutate helpers** rather than
  reinventing task-card markup — `renderItemCard`, the status/priority
  pill maps, and the approve/reject/complete/delete/take handlers are
  already correct and already styled (`action-items.css`).
- **Data source**: `GET /api/me/action-items` for "my tasks across every
  account I can see" (works today, no backend change). A cross-*account*
  filter (dropdown of the user's granted accounts, from `/api/accounts`)
  can be applied client-side against that same payload — no new endpoint
  needed for a single-user view.
- **List + filter/sort bar**: status chips (reuse `renderFilterChips`
  pattern), priority filter, account filter, due-date sort — all doable
  client-side over `/api/me/action-items`.
- **The team/manager view is the one piece that needs a backend change**
  (§7.2) — worth deciding up front whether v1 is personal-only ("my
  tasks, one page, better than the drawer") or needs manager oversight
  from day one, since that determines whether a new endpoint is in scope.
- **Kanban as a view toggle**, not a separate page, over the same data —
  three columns (Open / In Progress / Done) driving the same PATCH
  `status` calls the list view already uses.

## 9. Open questions before implementation

1. **Scope: personal task list, or manager/team oversight too?** Determines
   whether a new backend endpoint is needed (§7.2, §8).
2. **Kanban, list, or both?** Both is straightforward once the data-fetch
   layer is shared, but worth confirming as an MVP boundary.
3. **Should `pending_review` (LLM suggestions) show on this page**, or stay
   contact-drawer-only as today?
4. **Auto-generation from `cxo_movements`/opportunity signals** (§7.9) —
   in scope for this page's first version, or a later phase?
5. Where should this page live in navigation — a new left-nav entry next
   to "Global Accounts Dashboard" / "Sales Command Center" (same pattern
   used for Command Center), replace the My Tasks drawer entirely, or both
   (drawer stays as a quick-glance, page is the full view)?
