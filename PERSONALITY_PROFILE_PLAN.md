# Personality Profile — Data Audit & Implementation Plan (Robin Vince / BNY Mellon)

Audited the NeonDB `sales_ai` database for everything held on **Robin Vince**
(President, Chairman & CEO, The Bank of New York Mellon Corporation) to work
out which parts of a **Personality Profile** section — with **Executive
Summary** and an **Executive Profile** sub-block (Leadership Character,
Decision-Making Style, Values and Motivation, Public Reputation) — can be
generated from data already captured, versus what needs new
collection/enrichment work. This is a plan only; nothing has been built yet.

## 0. Important — this collides with an existing guardrail

`apps/content_pipeline/digest/prompts.py` (`PERSON_CHANNEL_SYSTEM` and
`PERSON_EMAIL_SYSTEM`) currently instructs the LLM, in bold hard rules:

> "Stay strictly professional. Do **NOT** infer or report personality traits,
> psychological characteristics, religious or political affiliation, family,
> health, or other personal-life details... This digest is business contact
> intelligence, not a personal or psychological profile."

That's a deliberate design choice in the current pipeline, not an oversight —
and the contact drawer UI (`frontend/js/modules/contact-drawer.js:191-200`)
currently renders both a "Psychological Profile" and a "Personality Profile"
section as permanently-disabled placeholders ("no personality-assessment
source (e.g. DISC/Big Five) is connected"), consistent with that guardrail.

Building the feature this plan describes means **deliberately opting back
into** personality-style inference for a defined, business-relevant subset
(leadership style, decision style, values, public reputation) — not lifting
the guardrail wholesale. Recommend keeping the existing `PERSON_CHANNEL_*`
prompts untouched (they still feed the factual contact-intelligence digest)
and adding a **new, separate** prompt/pipeline specifically scoped to this
feature, with its own explicit boundaries (professional/public-persona
inference only, always hedged, always cited, never health/family/politics).
This is a product decision worth confirming with the user/legal before
building — flagged here rather than decided unilaterally.

## 1. What's in NeonDB for Robin Vince today

| Source | Table | Rows | What it contains |
|---|---|---|---|
| Identity/dossier | `personas` | **2** (id 108 Diffbot, id 54 Crunchbase — duplicate, not merged) | title, tier=c_suite, hierarchy_level=1, decision_authority=final, budget_authority=full, location, sales-oriented `skills`/`target_kpis`/`operational_pain_points`/`key_objections`, one `communication_style` string ("Strategic, executive-level, ROI & shareholder-value oriented" — only on id 54), a canned `personalized_icebreaker`. `degree`, `institution`, `prior_company` are all **NULL** on both rows. |
| Career history | `cxo_movements` | **2** | 2022 CEO appointment announcement + 2023 "promoted to President & CEO" record, each with `previous_role` ("Vice Chair & Head of Global Market Infrastructure, Goldman Sachs, 26 years"), source article, date. |
| His own voice | `posts` (`channel='linkedin'`) | **20** | His own authored LinkedIn posts, full text + engagement (`likes`/`comments`/`shares`/reaction-type breakdown). Rich personal material: intern/analyst advice, "the most powerful question is why", National Geographic Explorers Festival, England-born World Cup loyalty, F1 simulator anecdote, America's 250th, Q2 2026 earnings commentary. |
| Third-party coverage | `posts` (`channel='news'`) | **9** | Google News RSS hits — earnings call transcripts, OpenAI board appointment, CEO succession coverage. |
| Public sentiment (indirect) | `posts` (`channel='reddit'`) | **11** | Mostly about BNY generally (an AI-agent story, market-news roundups mentioning BNY), not really personally about him — weak signal. |
| Regulatory/financial behavior | `posts` (`channel='sec'`) | **20** | Form 4 insider-ownership filings — **only filing metadata is stored** (`period covered`, filing URL); the actual transaction detail (buy/sell, share count, price, date vs. news) is **not parsed out**. |
| Third-party proxy votes | `posts` (`channel='sec_mentions'`) | **10** | N-PX records of funds voting on BNY board matters — generic, near-zero personal signal. |
| AI synthesis | `digests` (`target_key='robin_vince'`, `kind='person'`) | **1** | Exists but is a **dry-run placeholder** — `llm: "... ANTHROPIC_API_KEY not set, falling back to dry-run"`. No real narrative has ever been generated for him. Company-level digest for BNY (`kind='company'`) *did* run for real (`openrouter/nvidia/nemotron-3-super-120b-a12b:free`). |
| Growth signals | `opportunity_signals` | 25, but **account-level only** (`account_id=3`, i.e. BNY-wide, e.g. "wealth management operating model redesign") | Not persona-specific, not personality-relevant. |
| Firmographics | `accounts` (id 3) | 1 | Full BNY firmographic/financial record — useful as company context, not personal. |

No rows exist anywhere for podcast transcripts, YouTube interviews, Google
Scholar/patents, or Wikidata for him, even though `personas` stores
scrape-target URLs for all of these (`podcast_search_url`,
`youtube_interviews_url`, `google_scholar_url`, `wikidata_person_url`,
`google_trends_url`) — those channels have simply never been scraped for this
person.

## 2. Feasibility per section

| Section | Can we build it now from existing data? | Notes |
|---|---|---|
| **Executive Summary** | ✅ Yes | Persona title/tier + `cxo_movements` career trajectory (26 yrs at Goldman → BNY President 2022 → CEO/Chairman 2023) + account context (BNY size/scale) is enough for a solid factual summary. Needs an LLM pass to write it as prose (or a template), no new data required. Only gap: no education/degree — see §3. |
| **Leadership Character** | 🟡 Partial | The 20 LinkedIn posts are a strong qualitative source (how he talks about his team, interns, "why" philosophy, celebrating employees) — enough for a hedged, cited narrative. Would be stronger with interview/podcast transcripts (URLs exist, never scraped). Requires the new LLM pass described in §0. |
| **Decision-Making Style** | 🟡 Partial, weakest section | Qualitative angle (how he frames strategic moves in earnings commentary/news) is buildable now. The concrete behavioral signal — his own SEC Form 4 trading pattern — is **not usable yet**: only filing headers are stored, not parsed transaction type/size/timing. This is a real data gap, not just a prompting gap. |
| **Values and Motivation** | ✅ Yes, richest section | The LinkedIn corpus is unusually personal for a CEO account (curiosity/"why", exploration, patriotism as an England-born New Yorker, employee development) — good hedged-inference material with citations. No new data needed, just the LLM pass. |
| **Public Reputation** | 🟡 Partial | LinkedIn engagement counts (likes/shares/comments/reaction mix) give a real, computable engagement signal today with **no LLM needed**. News coverage (9 articles) gives qualitative reputation context. Reddit signal is weak/mostly off-topic. No sentiment score is stored anywhere — a lightweight version (engagement-ratio based) is free; a richer sentiment-classified version needs an LLM pass over news + reddit text. |

**Bottom line:** two of five sections (Executive Summary, Values &
Motivation) are ready to build today purely on data already in NeonDB, once a
real LLM key is enabled for this pipeline. Leadership Character and Public
Reputation are buildable but would benefit from added source channels.
Decision-Making Style is the one section with an actual data gap (Form 4
parsing) rather than just a missing LLM call.

## 3. What to fetch/build if we want the stronger version of every section

1. **Turn on a real LLM key for the person-digest path.** Nothing narrative
   exists yet for any persona because `ANTHROPIC_API_KEY`/`LLM_PROVIDER` isn't
   set when `digest.py` runs in "person" mode — confirm this is the actual
   blocker (vs. intentionally dry-run in this environment) before building
   further.
2. **Parse SEC Form 4 transaction detail**, not just filing metadata — table
   type (P=purchase/S=sale/A=award), share count, price, transaction date.
   `sec_insider_trades_url` / `sec_cik` are already stored on the persona;
   the ingestion job just needs to fetch and parse the XML body instead of
   only the filing period. This directly unblocks Decision-Making Style.
3. **Scrape the already-registered-but-unused channels**: podcast/interview
   search, YouTube interviews, Google Trends, Wikidata — URLs exist on the
   persona row and go nowhere today. Interview transcripts in particular
   would materially strengthen Leadership Character and Values.
4. **Backfill `degree`/`institution`/`prior_company`** (all NULL currently)
   from a bio source (Wikipedia/Wikidata — `api.py` already has a working
   `fetch_wikipedia_dbpedia_intel` endpoint for companies; would need a
   person-level equivalent) to round out the Executive Summary.
5. **De-duplicate the two `personas` rows** (id 108 Diffbot vs id 54
   Crunchbase) — they disagree on title wording and only one carries
   `communication_style`. Any synthesis job needs to either merge them or
   pick one canonically, or it will double-count/contradict itself.
6. **(Optional) sentiment classification** on `news`/`reddit` posts to make
   Public Reputation a scored metric instead of a narrative-only section.

## 4. Proposed implementation phases

**Phase 0 — decision checkpoint (no code)**
Confirm with the user/stakeholders that "opt back into" personality-style
inference (§0) is wanted, and what boundaries it must respect (e.g. never
health/family/politics, always hedge + cite, label as inference not fact).

**Phase 1 — make the data usable (backend, no new tables)**
- Fix/confirm the LLM key so `digest.py --person` stops dry-running.
- Add a Form 4 XML parser to whatever ingests the `sec` channel so
  transaction type/size/date land in `posts.extra` or a new column.
- De-dup the two `personas` rows for the same `external_id`/name+account.

**Phase 2 — new synthesis pipeline (backend)**
- Add a new prompt pair (parallel to `PERSON_CHANNEL_SYSTEM` /
  `PERSON_EMAIL_SYSTEM`) scoped exactly to: Executive Summary, Leadership
  Character, Decision-Making Style, Values and Motivation, Public
  Reputation — each field hedged ("suggests"/"implies") and cited back to a
  `source_url`, same `observed` → `interpretation` → `evidence_strength`
  method already used elsewhere in `prompts.py`.
- Store output as a new `digests.kind='personality'` row per persona (reuses
  the existing `digests` table/shape — no new table needed) or a new
  `personality_profiles` table keyed on `persona_id` if it needs to coexist
  with the person contact-intel digest.
- Public Reputation gets a cheap, no-LLM baseline for free: aggregate
  `posts.engagement` (likes/comments/shares/reaction mix) per channel,
  independent of whether the LLM call succeeds.

**Phase 3 — enrichment collectors (backend, optional/parallel)**
- Podcast/YouTube-interview scraper using the already-stored URLs.
- Person-level Wikipedia/Wikidata bio fetch for education/prior roles.

**Phase 4 — frontend**
- Replace the two static placeholders in
  `frontend/js/modules/contact-drawer.js:191-200` with a real
  "Personality Profile" section (Executive Summary + the four Executive
  Profile sub-blocks), each block showing its `evidence_strength` and
  linking out to `source_url`s, matching the existing dossier/chip-row
  visual style already used by `renderDossier`/`renderSocialActivity`.
- Keep an explicit "AI-inferred, not verified" disclosure in the UI, given
  the nature of this content — this mirrors the `do_not_say` /
  `evidence_note` pattern the existing pipeline already uses.

## 5. Open questions for the user

- Is enabling personality-style inference (vs. the current strictly
  professional-only guardrail) actually wanted, or should "Personality
  Profile" here really mean an *executive/professional* profile (title,
  career, communication style, public reputation) without venturing into
  psychological inference at all? The section names (Leadership Character,
  Values and Motivation) suggest the former, but it's worth confirming since
  the current codebase deliberately avoids it today.
- Is a real LLM key (Anthropic or another provider) available/expected to be
  configured in this environment, or should Phase 1 assume dry-run forever
  and lean more on the no-LLM engagement-metrics baseline?
- Priority on Phase 3 (podcast/interview scraping, Form 4 parsing) — these
  are the only genuine "fetch more data" items; everything else is
  prompting/synthesis work on data already sitting in NeonDB.
