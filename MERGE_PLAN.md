# Merge Plan — `data_scrapper` + `sales_agent-ai`

Goal: bring the two repos together **without breaking either one**. This is a
plan, not a migration script — nothing here has been executed yet.

## 1. What each repo actually is

| | `data_scrapper` (this repo) | `sales_agent-ai` |
|---|---|---|
| Purpose | Scrapes social/news/SEC/blog posts per company, LLM-digests them into a sales email + talking points | Builds firmographic account/LOB/persona intelligence (Crunchbase, GLEIF, SEC, Apollo, Exa, etc.) |
| Entry point | `main.py` (CLI: `scrape`/`digest`/`run`/`serve`) | `main.py` (CLI pipeline) **and** `api.py` (FastAPI server) |
| Server | Stdlib `http.server`, binds `127.0.0.1:8001` | FastAPI + `uvicorn`, binds `:8000` |
| Storage | JSON files under `output/` (source of truth) + optional Postgres mirror (`db.py`, raw `psycopg2`) | Postgres is the source of truth (SQLAlchemy models under `db/`) |
| Queue/async | None | Celery + Redis (15-day refresh scheduling) |
| Frontend | `frontend/index.html` — single-file Bootstrap + jQuery explorer | `frontend/index.html` + `frontend/js/dashboard.js` (167KB) + a separate `frontend/pipline/` UI |
| Git history | Independent repo, remote `janak-stradit/data_scrapper` | Independent repo, remote `pramod13071626/sales_agent-ai` — **no shared git ancestry**, so this is a folder-level merge, not a `git merge` |

They are complementary, not duplicates: this repo watches what a company is
*saying* (posts, press, jobs) and turns it into a sales email; `sales_agent-ai`
maps *who* the company is and *who* to talk to (org chart, personas, LOBs).

## 2. They already talk to each other — just manually

`sales_agent-ai/db/models/post.py` and `digest.py` are **column-for-column
copies** of this repo's `posts`/`digests` tables in `db.py`. The bridge today
is `sales_agent-ai/db/import_content_dump.py`: someone pg_dumps this repo's
`posts`/`digests` tables and one-off imports the `COPY` blocks into
`sales_agent-ai`'s `sales_ai` Postgres database. `sales_agent-ai`'s
`GET /api/content` then serves that imported data into its dashboard,
matched to `accounts.key` by the same string this repo calls `target_key`
(e.g. `"bny"`).

That manual dump is the main thing this plan replaces — everything else is
lower-risk.

## 3. Collision points (why this can't be a straight file copy)

| Path | Conflict | Resolution |
|---|---|---|
| `main.py`, `config.py`, `requirements.txt`, `frontend/`, `.env`, `README.md` | Both repos have a file at this exact path with unrelated content | Keep each app in its own subfolder — never merge these files into one |
| `db.py` (this repo, single file) vs `db/` (sales_agent-ai, package) | Name collision if flattened into one root | No action needed if each stays in its own subfolder |
| Ports | This repo: `8001`. `sales_agent-ai`: `8000` | No conflict — can already run side by side today |
| `posts` / `digests` / `linkedin_jobs` tables | Both write these; schemas match exactly today | Point both at the *same* Postgres DB instead of dump/import (see Phase 1) — but pin this, since either repo's next migration could silently drift the two schemas apart |
| `targets` (this repo) vs `accounts` (sales_agent-ai) | Different tables, same key string, no name clash | Leave as two tables; join in application code on `key` / `target_key` |
| `sales_agent-ai/sales_agent-ai/` | This is a **Python venv** (`pyvenv.cfg`, `Lib/`, `Scripts/`) sitting inside the repo, not source | Exclude from anything moved/merged — should be `.gitignore`d, not migrated |

## 4. Recommended shape: monorepo, two apps, one database

Don't fuse the two servers into one process — `http.server` + stdlib CLI vs
FastAPI + Celery + Redis is a real architectural difference, and forcing them
together is exactly the kind of change that "hampers" both. Instead:

```
sales-platform/                  (new parent repo, or sales_agent-ai repo root)
├── apps/
│   ├── content_pipeline/        ← this repo (data_scrapper), moved as-is
│   │   ├── main.py, engine.py, digest/, scrapers/, frontend/, ...
│   │   └── requirements.txt
│   └── sales_ai/                ← sales_agent-ai, moved as-is
│       ├── main.py, api.py, collectors/, db/, frontend/, ...
│       └── requirements.txt
├── docker-compose.yml           ← both services + shared Postgres + Redis
└── .env                         ← shared DATABASE_URL; each app keeps its
                                     own token vars, still loaded via
                                     python-dotenv from the same file
```

Each app keeps its own entry point, own `requirements.txt`, own venv/deps —
nothing about how either one runs today changes. The only new coupling is:
they read/write the **same** Postgres instance.

## 5. Phased execution

### Phase 0 — Safety net
- Tag/branch both repos before touching anything (`git tag pre-merge`).
- Back up the current `sales_ai` Postgres database.
- Confirm both apps currently run standalone (`python main.py serve` here,
  `python api.py` there) — this is the baseline "not hampered" has to hold.

### Phase 1 — Shared database, behind a toggle (in progress)

Checking this before cutover surfaced two things a straight `DATABASE_URL`
swap would have hit immediately:

- The two repos don't actually point at the same Postgres today. This repo
  writes to a **Neon cloud DB**; `sales_agent-ai` reads from its own
  **local Postgres** (`localhost:5432/sales_ai`) — the manual
  `import_content_dump.py` step exists precisely because of that gap.
- `sales_agent-ai`'s `Post` ORM model (`db/models/post.py`) was missing the
  `UNIQUE (target_key, channel, post_key)` constraint that this repo's
  `db.py` relies on for `ON CONFLICT (...) DO UPDATE`. Pointing this repo
  at local Postgres unchanged would have made every post write fail.

Decision: don't force a single DB yet. Instead, built a **toggle** so this
repo can connect to either Postgres on demand, with Neon staying the
unchanged default:

- `config.py` now resolves `DATABASE_URL` from two named connections,
  `DATABASE_URL_NEON` (falls back to the old `DATABASE_URL` var, so nothing
  changes for anyone who hasn't touched `.env`) and `DATABASE_URL_LOCAL`,
  picked by a `DB_USE_LOCAL=true|false` flag (default `false` → Neon).
- Fixed the missing constraint: added `UniqueConstraint("target_key",
  "channel", "post_key")` to `sales_agent-ai`'s `Post` model, and applied it
  to the existing local Postgres table with a one-off migration script,
  `sales_agent-ai/db/fix_posts_unique_constraint.py` (checked for
  pre-existing duplicate rows first — none found across 521 rows — then
  added the constraint; safe to re-run, it no-ops if already present).
- Verified end-to-end with `DB_USE_LOCAL=true`: wrote the same post twice
  through `db.upsert_posts()` against local Postgres and confirmed exactly
  one row landed (the `ON CONFLICT` upsert, not a duplicate-key failure).
- Left `import_content_dump.py` in place, unused, as a manual fallback.

Both changes are on matching branches, `merge/phase-1-shared-db`, in each
repo — not merged to either `main`/default branch yet.

**Still open before flipping `DB_USE_LOCAL=true` for real use (not just this
test):** decide whether local Postgres or Neon should be the *permanent*
shared DB (see §7.1-adjacent question below) — the toggle defers that
decision, it doesn't answer it. Neon remains the safer long-term default
since it's reachable regardless of which machine either app runs on; local
Postgres only works if both apps stay on the same machine.

### Phase 2 — Folder consolidation (done — `merge/phase-2-folder-consolidation`)

Before moving anything, found that `paths.py`'s `OUTPUT_DIR`, `main.py`'s
`serve` static-file directory, its `run_history.json` path, and its
`frontend/manifest.json` path were all resolved relative to the process's
**current working directory**, not this project's own directory. Harmless
run from its own root (always true before this phase), but nesting it
under `sales_agent-ai/apps/content_pipeline/` and launching from the parent
repo's root would have silently served or written into whatever
`frontend/`/`output/` happened to sit at that cwd — including
`sales_agent-ai`'s own `frontend/`/`output/` directories, since both exist
at its root too. Fixed by anchoring all of these to a new `paths.PROJECT_ROOT
= os.path.dirname(os.path.abspath(__file__))` instead of trusting cwd.

Then:
- Moved the content pipeline's full history into
  `sales_agent-ai/apps/content_pipeline/` via
  `git subtree add --prefix=apps/content_pipeline <local path> merge/phase-2-folder-consolidation`
  — history preserved, not squashed (`git log` on the moved files still
  works).
- Did **not** touch `engine.py`, `scrapers/`, `digest/`, or any of
  `sales_agent-ai`'s `collectors/`/`db/` logic — a move, not a rewrite.
- Moved this plan doc itself (`MERGE_PLAN.md`) from
  `apps/content_pipeline/` up to the monorepo root, via `git mv` (history
  preserved) — it documents the whole merge, not just the one subproject.
- `output/` and `.env` weren't part of the move (both gitignored in the
  source repo, so never tracked) — `sales_agent-ai`'s own `.gitignore`
  patterns for `.env` and `output/` apply at any depth, so the nested
  copies stay ignored too, no `.gitignore` change needed. A local `.env`
  was copied into `apps/content_pipeline/` for testing only, untracked.
- Verified both apps independently, post-move:
  - `python apps/content_pipeline/main.py status`, run from inside that
    directory, reads the existing JSON store correctly.
  - `python apps/content_pipeline/main.py serve`, launched from
    `sales_agent-ai`'s repo root (the actual risk scenario), correctly
    served *its own* `frontend/` (`<title>Social Scraper Explorer</title>`,
    not `sales_agent-ai`'s dashboard) — confirms the path-anchoring fix
    holds under the exact conditions that would have broken it.
  - `sales_agent-ai`'s own `api.py` still imports cleanly and builds its
    FastAPI `app` object, unaffected by the new `apps/` subfolder.
- Not yet done: `.dockerignore`/`Dockerfile`/`docker-compose.yml`/`Caddyfile`
  under `apps/content_pipeline/` are unchanged and still work as before,
  but only if Docker commands are run with that directory as the build
  context (`cd apps/content_pipeline && docker compose up`) — no monorepo-
  level `docker-compose.yml` bringing up both services together yet; that's
  Phase 4.

### Phase 3 — Cross-linking (done — `merge/phase-3-cross-linking`)

Built:
- `?account=<key>` deep-links the content pipeline's frontend straight to
  that account (same as clicking it in the sidebar); `?account_key=<key>`
  does the same for `sales_agent-ai`'s dashboard, matched by the `key`
  column since the linking app only knows the string key, not this app's
  numeric account id.
- A "← Sales Dashboard" link on the digest header (company accounts only);
  an "Open in Content Pipeline" link on `sales_agent-ai`'s content panel,
  so a rep can jump to the live app to trigger a fresh run or use its
  copy-to-clipboard email/talking-points UI.
- `scripts/reconcile_targets_accounts.py` — the §7.3 follow-up: checks
  `targets` (content pipeline) against `accounts` (this app) for drift,
  since the two live in genuinely separate databases (Phase 1).

Running that script for real immediately found a live case of exactly the
drift it was built to catch: `sales_agent-ai`'s one account
(`key = "bank_of_new_york_mellon_corporation"`) had no matching target —
`resolveAccountTargetKey()`'s existing fallbacks (ticker/slugified
name/legal name) didn't produce `"bny"` either, so the new content-pipeline
link would never have rendered for it. Fixed by renaming the target's
canonical key to match the account (`targets.py`, `frontend/manifest.json`,
the local JSON store/digest files, and both Postgres databases — Neon and
this app's local `sales_ai`, across `targets`/`posts`/`digests`/
`linkedin_jobs`/`run_history`, in an order that avoids violating
`linkedin_jobs`' FK to `targets(key)`: insert the new `targets` row first,
repoint children, then drop the old row). `"bny"` and its other aliases
still resolve to the new key via `ALIASES`, so nothing that already types
`"bny"` broke. Row counts verified before/after on both databases;
re-running the reconciliation script confirmed the account now has
matching content monitoring.

Not done: the `POST /api/run` / `POST /api/send-email` buttons inside
`sales_agent-ai`'s dashboard, and syncing `talking_points[]` into
`OpportunitySignal` — both still just proposed, not built.

### Phase 4 — Deeper unification (in progress — `merge/phase-4-deeper-unification`)

Checked before building anything: the "shared config loader" item turned
out to be one variable (`APIFY_TOKEN` — everything else in either
`config.py` is genuinely app-specific), not worth an abstraction on its
own — skipped. And `sales_agent-ai` had **no Dockerfile at all** yet, so
"single docker-compose.yml bringing up both services" meant writing this
app's first one, not unifying two existing setups — confirmed by checking
this repo for any Dockerfile/docker-compose and finding only the one that
came from `apps/content_pipeline`.

Built:
- `Dockerfile` (this app's first) — mirrors `content_pipeline`'s
  `python:3.12-slim` style. Runs `uvicorn api:app` directly rather than
  `python api.py`, since that script's `__main__` block hardcodes
  `reload=True` (dev-only file-watching, wrong for a container). Doesn't
  run DB migrations on start, matching how this app already expects
  `python db/create_tables.py` as a manual one-time step.
- `.dockerignore` — critically excludes `sales_agent-ai/`, the leftover
  Python venv sitting at this repo's root (see §3's collision table) —
  without it, `COPY . .` would have shipped Windows venv binaries into a
  Linux image. Also excludes `apps/` (that app builds its own image),
  `output/`, `.env`, caches.
- `docker-compose.yml` at the repo root — local dev convenience only,
  brings up both app containers on their existing default ports
  (8000/8001). Deliberately does **not** containerize Postgres (both apps
  already point at real Postgres — Neon and/or local, per Phase 1's
  toggle; a containerized one would just be a third database) or add
  Redis/Celery (not implemented in this app yet — `celery_app.py`/`tasks/`
  are gitignored placeholders, nothing would consume it). Does **not**
  touch or replace `content_pipeline`'s own
  `apps/content_pipeline/docker-compose.yml` + Caddy/TLS setup, which
  stays its production deploy path — the reverse-proxy-consolidation
  question below is still open.

**Not verified against a running Docker daemon** — none available in this
environment. Checked by static review only (requirements need no native
build deps beyond what `python:3.12-slim` + `psycopg2-binary` already
handle, `api.py`'s imports all resolve within the build context, compose
YAML parses correctly) — needs a real `docker compose build` smoke test
before relying on it.

**Still open:** whether this app's `http.server`-based sibling should ever
move behind the same reverse proxy (`Caddyfile`) as `sales_agent-ai`'s
FastAPI so there's one public origin — that's a live deployment-topology
decision, not something to do speculatively alongside a Dockerfile that
has never been deployed.

### Phase 5 — Cleanup (only after Phase 3/4 are live and stable — not yet true)

Neither condition holds yet: nothing from Phase 3/4 has been pushed or
merged to either repo's default branch, and Phase 4's Docker setup has
never actually been run (no Docker available to test it — see Phase 4).
Did the one item that didn't depend on that gate:

- Stray venv folder (`sales_agent-ai/sales_agent-ai/`): checked first —
  it was never actually tracked by git (it self-ignores via its own
  generated `.gitignore`), so there was nothing to remove *from* version
  control. Added an explicit rule to the outer `.gitignore` anyway, since
  relying on a nested venv-generated file surviving forever is fragile.
  Confirmed nothing in the codebase references that path.

Deliberately **not done**: retiring `db/import_content_dump.py`. It's the
fallback for exactly the scenario Phase 1's live-DB toggle hasn't been
proven under yet (real, sustained use) — removing it now, before either
of those phases has actually run in practice, would cut the fallback at
the moment it might still be needed. Revisit once Phase 3/4 have actually
been used for a while, not on a fixed schedule.

### Phase 1 follow-up — permanent DB: Neon (decided)

Both apps are confirmed to always run on the same machine/VM going
forward, which resolves Neon's main disadvantage (reachability across
machines) — so the deciding factor came down to which side had less/safer
data to move. Checked row counts on both databases: each holds the *live*
copy of one app's data and a *stale* copy of the other's (Neon: 676 posts/
8 targets/8 digests, current; local: 521 posts, a stale one-off dump.
Local: 1 account/15 lobs/56 personas/2 pipeline runs, current; Neon: none
of these tables exist there yet). Neither side is a no-migration option.

Checked both repos for existing backup tooling for local Postgres — found
none (no `pg_dump` script, no scheduled job, nothing in either codebase).
Whether the target machine/VM has backups at the infra level (disk
snapshots, etc.) instead couldn't be confirmed from here. Decided not to
migrate sales_agent-ai's real data (56 personas, 15 lobs, 2 pipeline runs)
onto local Postgres as the permanent store without that confirmed —
**Neon stays the permanent shared DB**, keeping its managed backups.
`DB_USE_LOCAL` stays `false` (the toggle's default); local Postgres
remains available for testing via the toggle, not as the target.

**Follow-up completed (2026-08-30):** migrated `sales_agent-ai`'s own
tables onto Neon and pointed its `DATABASE_URL` there — both apps now
share the same live database, not just capable of being pointed at either.

Running `db/create_tables.py` against Neon (idempotent — `create_all()` +
`ADD COLUMN IF NOT EXISTS`, nothing destructive) surfaced something the
row-count check above didn't catch: **Neon already had its own
`accounts`/`lobs`/`personas` data** — a `blackrock` account and a `bny`
account (key `"bny"`, not `"bank_of_new_york_mellon_corporation"`), both
created 2026-08-25, predating local Postgres's current account (created
2026-08-26, `id=11` — that table had clearly been reset/reseeded at least
once during development). Two independent, live-looking datasets, not an
empty target. Decided (explicitly, not inferred): keep both rather than
merge them at that point — local's account was copied onto Neon as a
**third**, separate account (new id, own key
`bank_of_new_york_mellon_corporation`), leaving Neon's pre-existing
`blackrock`/`bny` untouched.

**`"bny"` / `"bank_of_new_york_mellon_corporation"` reconciled
(2026-08-30):** compared the two accounts' actual content before merging
anything — zero overlapping LOBs (`"bny"`'s 10 are named business lines:
Walter Scott, Newton Investment Management, Insight Investment, etc.;
`"bank_of_new_york_mellon_corporation"`'s 15 are legal/trust/nominee
entities: Pershing, BNY Mellon Trust Co., nominee shells — reads like two
different source systems' views of the same corporate structure, e.g.
Crunchbase-style vs. SEC Exhibit-21-style) and only 4 overlapping persona
names out of ~55 each. Genuinely complementary, not duplicates — merged
rather than picked one and discarded the other: reparented `"bny"`'s 10
lobs and 54 personas onto `bank_of_new_york_mellon_corporation` (`UPDATE
... SET account_id = <target> WHERE account_id = <bny>`, no id remapping
needed since the lob/persona rows themselves don't move, only their
parent), then deleted the now-empty `"bny"` account row. Kept
`bank_of_new_york_mellon_corporation` as the surviving key — it's what
the content-pipeline cross-link (Phase 3) was already aligned to; keeping
`"bny"` instead would have undone that rename. Result: one account, 25
lobs, 110 personas. Verified via a running `sales_agent-ai` instance —
`/api/accounts` lists exactly two accounts (`blackrock`,
`bank_of_new_york_mellon_corporation`), no orphaned `"bny"`. The ~4
overlapping persona names weren't deduplicated (different source records,
finer-grained than this account-level reconciliation) — minor duplication
there is far less costly than picking wrong and losing a record.

Migration mechanics: local's `accounts`/`lobs`/`sub_lobs`/`personas`/
`pipeline_runs` rows copied via a generic script that remaps FK columns
(`account_id`, `lob_id`) to the new auto-assigned ids as it goes (`lobs`
before `personas`, `accounts` before both) — old ids weren't reusable
since Neon's sequences had already moved past them. Row counts matched
exactly post-copy (15 lobs, 56 personas, 2 pipeline runs), and Neon's
pre-existing `blackrock`/`bny` counts (7/53 and 10/54) were confirmed
unchanged before and after. Verified end-to-end by running `sales_agent-ai`
against Neon with no env override — `/api/accounts` lists all three
accounts, `/api/content` still resolves correctly.

`sales_agent-ai/.env`'s old local-Postgres config is commented out, not
deleted, so switching back for testing is a one-line change. Local
Postgres's data itself was left as-is (nothing dropped) — it's now a
point-in-time snapshot, not read from by either app by default.

## 6. Guardrails ("should not hamper" — concrete rules)

- Never edit a file in one app to satisfy the other's needs — cross-cutting
  changes go in a new shared layer (Phase 4+), not by reaching into the
  other app's modules.
- Every phase must leave both `python main.py serve` (this repo) and
  `python api.py` (sales_agent-ai) independently runnable — if a phase
  breaks either standalone, it's reverted before moving on.
- Schema changes to `posts`/`digests`/`linkedin_jobs` are proposed in this
  repo's `db.py` **and** mirrored in `sales_agent-ai/db/models/` in the same
  change — never one without the other, or the shared-DB assumption in
  Phase 1 silently breaks.
- No destructive DB operations (`DROP`, `TRUNCATE`) against the shared
  `sales_ai` database without an explicit go-ahead and a fresh backup.

## 7. Decisions

### 7.1 Destination repo: `sales_agent-ai` becomes the monorepo home

This repo (`data_scrapper`) moves into `sales_agent-ai` as
`apps/content_pipeline/`, not the other way around, and not a fresh
third repo. Reasons:

- `sales_agent-ai` already owns the shared Postgres database and already
  reads from it (`GET /api/content`) — it's the side with more to lose from
  a database migration, so keep the DB where it already lives.
- `sales_agent-ai` has Celery + Redis wired up for scheduled refreshes;
  this repo's `scrape`/`digest` commands are natural Celery tasks later
  (Phase 4+) if that's ever wanted, and it's easier to add a task to an
  existing worker than to stand up Celery from scratch on this side.
- `sales_agent-ai`'s dashboard (`dashboard.js`, org chart, growth
  opportunities panel) reads as the app a sales rep opens daily; this repo
  reads as a specialized feed into it. The feed moves to the hub, not the
  other way around.
- A new third repo adds a migration with no offsetting benefit — everything
  gained from a fresh repo (clean history, no leftover cruft) is also
  achievable by cleaning `sales_agent-ai` in Phase 5 without the extra move.

Net effect on git history: this repo's history can be preserved with
`git subtree add` (or `git filter-repo` + merge) into `sales_agent-ai`
rather than a plain copy-paste, so `git log` on the moved files still works.

### 7.2 Frontend strategy: keep two UIs, cross-link, do not fold

Do not merge this repo's `frontend/index.html` into `sales_agent-ai`'s
`dashboard.js`, now or later, unless real usage shows the split UI is
actively getting in someone's way. Reasons:

- `dashboard.js` is already 167KB and tightly coupled to `sales_agent-ai`'s
  own state (org chart, signals, growth panel); folding this repo's digest
  view into it risks becoming exactly the kind of change that "hampers"
  the existing app — high churn on a file that already carries a lot.
- This repo's digest UI is small, self-contained, and just got a
  copy-to-clipboard feature for the sales email and talking points — that
  investment stays intact and low-maintenance as its own page.
- Cross-linking gets the actual value (a rep can get from an account to its
  content digest and back in one click) without either app editing the
  other's frontend code.

Concretely (Phase 3): `sales_agent-ai`'s account view gets a link/tab —
"Content Intelligence" — that opens this repo's
`frontend/?account=<key>` for that company; this repo's digest view
gets a "Back to account" link using the same key. Both are simple `<a href>`
changes, not shared components.

### 7.3 Target/account ownership: `accounts` is the registry, `targets` is scrape config

Split by responsibility instead of merging the two lists:

- **Existence — "do we track this company at all"** is owned by
  `sales_agent-ai`'s `accounts` table. It's already the relational hub:
  `lobs`, `personas`, `pipeline_runs`, `opportunity_signal`, and
  `weekly_digest` all foreign-key to `accounts.id`, and it carries the
  richer identity (legal name, domain, CIK, LEI, etc.).
- **Channel scrape configuration** — LinkedIn URL, X handle, Reddit query,
  SEC CIK, blog/newsroom URLs and globs, RSS feed — stays owned by this
  repo's `targets.py` / `custom_targets.json` / Postgres `targets` table.
  `accounts` has no equivalent columns and shouldn't grow them; that's
  scraper-specific config, not firmographic identity.
- **Rule going forward:** every key in this repo's `targets` config must
  correspond to an existing `accounts.key`. Onboarding a new company means
  creating it in `accounts` first (via `sales_agent-ai`'s existing
  account-creation path), then optionally adding scrape config here to turn
  on content monitoring — not the reverse, and not two independent
  onboarding flows.
- **Follow-up implementation note (Phase 3, not done yet):** add a
  reconciliation check — e.g. a `sales_agent-ai` endpoint or a small script
  that flags any `targets.key` with no matching `accounts.key` (orphaned
  scrape config) and any `accounts.key` with no `targets` entry (trackable
  but not content-monitored) — so the two lists don't silently drift once
  they're no longer maintained by the same person out of habit.
