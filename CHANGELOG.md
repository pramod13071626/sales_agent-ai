# Changelog — Sales Intelligence Platform

High-level summary of features shipped and bugs fixed over the last 10 days (**Sep 7 – Sep 15, 2026**), across the whole team (janak, ankita-1408, pramod13071626).

---

## ✅ Features & Enhancements

### Sales Command Center
*Sep 7 – 15*
New action-first dashboard page, built up over several passes: the initial app shell with a live account navigator and real data wired in, a personal Task Management page, six real-data intelligence widgets (hiring signals, capital events, coverage gaps, tech signals, and more), per-user access toggling, and a later round of polish that separated out a dedicated Investment Tracks panel, upgraded the Hiring Trend Radar, and streamlined several UI controls.

### Executive Psychological & Personality Profiles
*Sep 7 – 9*
New AI-generated profile pipeline for executive personas — synthesizes a Personality Profile and a Psychological & Leadership Profile from captured social/career data, with on-demand generation triggered directly from the dashboard.

### Login, Roles & Access Control
*Sep 7 – 11*
Login and role-based access were added, followed by granular per-user permission toggles (Dashboard, Command Center, Tasks, Pipeline access) managed from a Super Admin panel, plus a general Super Admin dashboard UI pass.

### Account Intelligence Pipeline
*Sep 7 – 15*
Enterprise persona directory with tier filtering and search; account explorer improvements for data fetching and validation; theorg.com added as a new enrichment data source; and Level 3 sub-LOBs added with a competitors card grid and audit/pipeline-run logging.

### Profile Page Enhancements
*Sep 7 – 9*
Redesigned the contact profile sidebar and unified the topbar across profile pages so navigation feels consistent with the rest of the app.

### Task Assignment & Follow-Up
*Sep 7*
Added the ability to assign tasks and track follow-ups from within the dashboard.

### Performance: Account List Payload Optimization
*Sep 15*
The `/api/accounts` list endpoint (powers the left-nav account list, topbar ticker, and digest) was shipping every account's full data dossier on every request — including heavy fields only needed once a specific account is opened. Trimmed it to only what the list view actually reads, moved signal-count calculation to the server, and added a session-scoped cache (cleared on login/logout, force-refreshed after pipeline data writes) so the list doesn't refetch on every page navigation.

---

## 🐛 Bug Fixes

### Persona key-resolution bugs (multiple endpoints)
*Sep 9*
A recurring bug where a persona's internal "key" didn't match how their captured social posts/content were indexed — caused missing bio data on profile pages, missing content on `/api/accounts/{id}/content`, and failed Psychological Profile generation. Fixed across all three call sites, removing hardcoded fallbacks in favor of real key resolution.

### Data Pipeline Console hitting the wrong API port
*Sep 11*
The pipeline console had a hardcoded `http://127.0.0.1:8000` API base, so it broke whenever the app was served from a different port. Now resolves same-origin automatically.

### theorg.com data validation & dump logic
*Sep 11*
Fixed validation and database-dump logic issues that surfaced when theorg.com was added as a data source.

### Merge conflict markers left in committed code
*Sep 7*
Leftover `<<<<<<<`/`=======`/`>>>>>>>` conflict markers and broken model imports from an earlier merge were cleaned up.

### Lint & formatting errors
*Sep 9*
General cleanup pass resolving lint/formatting issues introduced across recent commits.

### Database schema drift causing 500 errors
*Sep 15*
Several columns existed on the SQLAlchemy models but were never migrated into the live Postgres database, causing `UndefinedColumn` 500 errors: `users.has_dashboard_access` (broke login), and `is_manually_verified`/`manually_verified_at` on accounts/LOBs/personas — with `sub_lobs` alone missing 13 columns entirely (broke `/api/accounts`). Added the missing migrations and verified every model now matches the live schema.

### Hardcoded account ID breaking Hiring Signals
*Sep 15*
The Hiring Signals panel hardcoded BNY Mellon's account ID as `11`, which 404'd in any environment where BNY doesn't happen to have that exact ID. Now resolved dynamically by account name, like the rest of Command Center already does.

### Account list payload regression
*Sep 15*
A later commit had accidentally reverted the Sep 15 payload-trim optimization (and made it worse, duplicating persona data inside every LOB), ballooning the account list response to 7.3MB. Re-applied the trim while preserving the newer fields other features genuinely need.

---

*Generated from git history and this session's work — 2026-09-15.*
