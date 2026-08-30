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

### Phase 1 — Shared live database (removes the manual dump step)
- Point this repo's `DATABASE_URL` (`.env`) at the same Postgres instance
  `sales_agent-ai` uses.
- Diff the two schema definitions once more right before cutover
  (`db.py`'s `_SCHEMA_STATEMENTS` vs `db/models/post.py` + `digest.py`) —
  they match today, but confirm no drift crept in since this plan was written.
- Run this repo's pipeline once against the shared DB; verify
  `sales_agent-ai`'s `GET /api/content` reflects it *live*, with no
  `import_content_dump.py` step.
- Leave `import_content_dump.py` in place, unused, as a manual fallback —
  don't delete it in this phase.
- **Risk:** this repo's `db.py` writes are already best-effort/non-fatal if
  the DB is unreachable, so a bad `DATABASE_URL` degrades to "JSON-only mode"
  rather than breaking scraping. Low risk.

### Phase 2 — Folder consolidation (no behavior change)
- Move this repo's contents into `sales_agent-ai/apps/content_pipeline/`
  (decision: `sales_agent-ai` is the destination repo — see §7.1), ideally
  via `git subtree add` so this repo's commit history comes with it.
- Update only path-relative things that break from the move: `paths.py`'s
  `output/` resolution, `.dockerignore`, `Dockerfile`, `Caddyfile`,
  `docker-compose.yml`, any `python main.py` docs.
- Do **not** touch `engine.py`, `scrapers/`, `digest/`, or any of
  `sales_agent-ai`'s `collectors/`/`db/` logic in this phase — it's a move,
  not a rewrite.
- Re-run both test/status commands after the move to confirm nothing broke:
  `python main.py status` here, `python api.py` + `GET /docs` there.

### Phase 3 — Cross-linking (the actual "merge" value)
This is where the two apps start being useful *together*, still as two
processes:
- Add a link/embed from `sales_agent-ai`'s account dashboard to this repo's
  `/frontend/?account=<key>` digest view (or vice versa) using the shared
  `key`/`target_key`.
- Optionally expose this repo's `POST /api/run` and `POST /api/send-email`
  as buttons inside `sales_agent-ai`'s dashboard, so a rep never has to
  leave the sales-intel UI to trigger a content refresh or send the digest
  email — reuses the "Copy Email" / talking-points UI already in this repo
  rather than rebuilding it.
- `sales_agent-ai`'s `OpportunitySignal` model is the natural home for this
  repo's `talking_points[]` — consider syncing digest talking points into
  it as signals, since the sync endpoint pattern (`sync_account_*`) already
  exists in `api.py`.

### Phase 4 — Optional deeper unification (only if Phase 3 proves valuable)
- Single shared `.env` loader / config module, so tokens aren't duplicated
  across two `config.py`s (`APIFY_TOKEN`, etc. already appear in both).
- Single `docker-compose.yml` bringing up both services + Postgres + Redis
  together for local dev.
- Evaluate whether this repo's lightweight `http.server` should move behind
  the same reverse proxy (`Caddyfile`) as `sales_agent-ai`'s FastAPI, so
  there's one public origin — purely a deployment change, not a code merge.

### Phase 5 — Cleanup (only after Phase 3/4 are live and stable)
- Retire `db/import_content_dump.py` once nobody has run it in a while.
- Remove the stray venv folder `sales_agent-ai/sales_agent-ai/` from version
  control (add to `.gitignore` first, confirm it's not referenced anywhere).

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
