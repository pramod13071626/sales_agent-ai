# Sales Copilot: completed tasks

What has been built for the Sales Copilot (RAG chat over the sales database), one task per entry:
**title**, **description**, **where** the code lives and **how it was verified**. The full design is in
[README.md](README.md). This list covers this branch (`theme/dastone-restyle`). Tasks that exist only on
`feature/crm-core-phase1` are listed separately at the end.

Status legend: ✅ done and verified · 🟡 done, not yet committed

---

## A. Foundation

### T1. Plan and architecture ✅
**Description:** A research-backed design for a copilot that answers sales questions from Postgres. It covers
data sources, chunking, embeddings, de-duplication, versioning, access control, retrieval, prompting, budget,
memory, UI and roll-out, with every decision recorded (free local embeddings, ChromaDB, OpenRouter free models
only, 90k tokens per person per day, personal contact details never shown).
**Where:** `README.md` §1–§22.

### T2. Copilot database schema and change capture ✅
**Description:** Ledger tables for the search index: `rag_documents` (versioned, SCD-2), `rag_chunks`
(content-addressed, full-text search), `rag_document_entities` (which account / person a document is about),
`rag_index_entries`, `rag_outbox`, sync state. Triggers queue a re-index only when content columns really change
(a scrape that only bumps `last_seen` queues nothing). The schema is applied only when its fingerprint changes,
with a lock timeout so it never deadlocks with the dev server.
**Where:** `schema.sql`, `ingest.ensure_schema`.
**Verified:** a `last_seen`-only update queues 0 rows; a real contact edit queues 1.

### T3. Free local embeddings and ChromaDB store ✅
**Description:** `BAAI/bge-small-en-v1.5` (384-dim) runs locally through fastembed, with no API cost. Vectors
live in an embedded ChromaDB owned by the API process, with deterministic ids so re-syncs are idempotent. The
model is warmed up at start-up.
**Where:** `embed.py`, `store.py`, `settings.py`.

### T4. Ingestion: renderers, de-duplication and versioning ✅
**Description:** Turns database rows into searchable documents: contact cards, call-prep, accounts, lines of
business, opportunity signals, digests, leadership moves, social / news / blog posts, job postings and weekly
hiring summaries. De-duplication happens on five levels (same row, same item under several targets,
same text, same chunk, near-duplicates via SimHash). Old versions are kept for history. Garbled characters from
scraping ("â€™") are repaired. Chunks stay under the embedding model's 512-token limit.
**Where:** `ingest.py`.
**Verified:** 6,491 documents → 7,263 vectors, equal to the ledger; a re-sync with no changes takes about 4 s with 0 re-embeds.

### T5. Background sync and retention ✅
**Description:** A worker inside the API process drains the change queue every few minutes and runs a full
reconcile plus retention clean-up every 24 h: 13-month history, quarterly snapshots, 30-day windows for events,
chats kept 12 months, and versions cited in chats pinned. An advisory lock ensures only one runner.
Admins can trigger a sync (`POST /api/copilot/admin/sync`).
**Where:** `sync.py`.

## B. Answering questions

### T6. Hybrid search with access control ✅
**Description:** Every question searches both the vector store and Postgres full-text search, and merges the two
with reciprocal-rank fusion. Account access is applied **inside** the vector query and re-checked in Postgres, so
nobody sees documents about accounts they can't open. A person's own documents are boosted, near-duplicate
articles collapse to one, and sales phrasing is expanded ("push back" also finds "objections").
**Where:** `retrieve.py`, `chat.QUERY_EXPANSIONS`.
**Verified:** recall@10 = 1.0 on the golden set, 0 access leaks.

### T7. Question router and database tools ✅
**Description:** A rule-based router (no AI) decides what kind of question it is:
- person brief / call prep;
- account brief;
- list people (e.g. decision-makers, VPs in technology);
- what changed in the last 30 days;
- remember this;
- draft an email;
- open question.

Lists, changes and "remember" are answered straight from the database. People are recognised from @mentions,
full names, unique surnames, fuzzy matches and pronouns ("prep me for *him*"), using the page and chat context.
**Where:** `chat.route`, `chat.resolve_entities`, `chat.tool_*`.
**Verified:** intent accuracy = 1.0.

### T8. AI layer on OpenRouter free models ✅
**Description:** One request per answer to free models (Nemotron → Qwen → Gemma fallback list), with model
"reasoning" turned off so answers come back as text. Answers stream token by token. If the provider is overloaded
before the first token, it retries once on the next model. The UTF-8 stream decoding is fixed.
The prompt forces answers to use only the supplied facts, with a citation `[n]` on every factual line.
**Where:** `llm.py`, `chat.SYSTEM_PROMPT`, `chat.stream_message`.

### T9. Daily AI quota ✅
**Description:** A governor shared by the copilot, the call-prep button, the profile buttons and night-time batch jobs:
- **Team request split:** copilot 40 %, call-prep 10 %, profiles 20 %, shared pool 30 %.
- **Per person:** 90k tokens a day, plus a share of the team's requests.
- **Night-time batch jobs** only use what's left, between 21:00 and 05:30 IST.
- **When the budget runs out,** the copilot still answers from sources without an AI summary ("SOURCES ONLY"),
  and the buttons return a clear 429 instead of failing silently.
**Where:** `llm.reserve / finalize / quota_status`, `services/callprep_service.py`, the main `api.py` profile generation.
**Verified:** with the day used up, both buttons return 429 immediately and send 0 requests.

### T10. Streaming chat API and sessions ✅
**Description:** `/api/copilot/chat/stream` (server-sent events: status → meta → tokens → done) plus a JSON
fallback. A Stop button saves the partial answer and settles the quota, and a disconnected client is handled.
Sessions can be created, renamed, pinned, searched and deleted. Feedback 👍/👎, answer-style preference, context
endpoint, entity search for @mentions, quota endpoint.
**Where:** `api.py`, `chat.handle_message / stream_message`.

## C. Trust, privacy and safety

### T11. Contact privacy by value ✅
**Description:** Personal contact data is never shown:
- free-mail addresses (Gmail, Outlook.com …) and malformed emails are hidden;
- a phone equal to the person's own direct mobile is hidden, unless 3 or more people share it
  (a company switchboard);
- `personal_email` and `direct_mobile_phone` are never sent to the browser;
- home address, political and age fields are stripped from profiles.

The same rules were applied to the main app (profile page, contact drawer, people list, profile PDF).
**Where:** `privacy.py`, the serializers in the main `api.py`.
**Verified:** 0 leaks across 22 contact and account endpoints; the eval's leak gate reports 0.

### T12. Professional email drafts with guardrails ✅
**Description:** "Draft an intro / follow-up email to X" produces a structured, fact-based email (subject,
greeting, context, "Where StradIT could help" bullets, a clear ask, a Sources line). Eight automatic checks run on
every draft:
- structure;
- citations removed from the email body;
- figures not found in the evidence removed;
- no unearned personal credit;
- no implied client track record;
- no guarantees or spam wording;
- no contact details;
- length 80–190 words.

The checks are shown under the draft, in an email card with **Copy email** and **Open in mail app**.
**Where:** `guardrails.py`, `chat.DRAFT_INSTRUCTION`, `render.js`.
**Verified:** a real Nemotron draft passes all 8 checks, and the email you reported as a problem has every issue caught.

### T13. Abusive-language filter 🟡
**Description:** Messages with profanity, slurs or insults, in English or Hindi / Hinglish, get a fixed polite
refusal. It also catches disguised spellings (`f*ck`, `f**k`, `sh1t`, `f u c k`, `fuuuck`) and doesn't flag
innocent words that contain a banned string (Scunthorpe, assessment, Dickson, Niger, "BC province", "MC of the event").
Flagged messages are never searched or sent to the AI, are stored masked, and are written to the audit log
(without the words). The copilot's own answers are masked the same way.
**Where:** `moderation.py`, `chat.begin_turn`, `chat.finish_turn`, `tests/test_copilot_moderation.py`.
**Verified:** 30+ unit cases for catches and false alarms; end-to-end test: refused, stored masked, audited, 0 AI calls.

### T14. Greetings and small talk 🟡
**Description:** "Good morning" (typos included), "thanks", "bye", "how are you?" and "what can you do?" get an
instant friendly reply with suggestions for the person or account in focus. There's no search, no AI use and no
source dump. A greeting in front of a real question ("Hi, which BNY VPs …") is ignored and the question is
answered normally.
**Where:** `chat.smalltalk`, `chat._smalltalk_answer`.
**Verified:** end-to-end chat (greeting → thanks → help → question) with 0 AI calls; the eval still passes.

### T14b. Stronger guardrails and a safety eval 🟡
**Description:** Every AI answer is now checked, not only email drafts:
- **Answers:** citations must point at a real source, and an uncited long answer gets a warning. Figures missing from the sources are flagged. Echoed prompt text, links not found in the sources, contact details and offensive words are removed.
- **Drafts:** five more checks — internal jargon and private-note wording ("pain points" is reworded), competitor put-downs, confidential or "I heard" material, links not in the sources, and unfilled placeholders.
- **Evidence:** scraped text that reads like instructions to an AI is replaced before the model sees it (prompt injection).
- **Display:** checks show under an answer only when something was fixed or flagged.
- **Eval:**
  - a no-database safety suite of 27 guardrail cases, 15 injection cases and 40 moderation cases, gated at 100% (moderation recall ≥ 95%, no false positives);
  - small-talk and abusive golden cases that must never reach the AI;
  - a count of indexed chunks that contain injection text;
  - a comparison with the previous run.

**Where:** `guardrails.py` (`check_answer`, `sanitize_evidence`), `chat._guard` / `chat.pre_route`, `eval/safety_cases.py`, `eval/run_eval.py`, `tests/test_copilot_guardrails.py`.
**Verified:** 105 tests pass; `run_eval --safety-only` passes every gate. The full eval run was stopped because the machine ran low on memory and has not been run again.

## D. Memory, exports and tooling

### T15. Per-user chat memory ✅
**Description:**
- **Explicit notes:** `/remember …`, visible only to their owner.
- **Suggested saves:** "Save this to your private notes?".
- **Recall:** notes are found by meaning, using local embeddings, and attached to the person in focus.
- **Long chats:** summarised without AI.
- **"My notes" panel:** export and clear-all.
- **Per-user switch:** memory can be turned off.

**Where:** `chat.save_note / recall_notes`, `api.py` notes endpoints, UI.

### T16. Downloads and exports ✅
**Description:** Answer as PDF; a table or its sources as Excel; a whole chat as PDF, Excel or Markdown; notes
as Excel; "my data" as JSON. Also added where they help elsewhere: account contacts to Excel (people panel) and
My Tasks to Excel.
**Where:** `exports.py`, `frontend/js/modules/download.js`, `people-panel.js`, `tasks-page/main.js`.

### T17. Evaluation harness (quality gate) ✅
**Description:** A golden set of questions with expected intent, person and source documents. `run_eval.py`
measures intent accuracy, entity accuracy, recall@10, access leaks and personal-contact leaks, and fails
below the gates (intent ≥ 0.9, recall ≥ 0.85, 0 leaks). No AI requests.
**Where:** `eval/golden.jsonl`, `eval/run_eval.py`, `python -m apps.sales_copilot.cli eval`.
**Verified:** 1.0 / 1.0 / 0 / 0, passed.

### T18. Command-line tools ✅
**Description:** `cli.py init | sync | maintain | stats | search | ask | models | eval`, for set-up,
troubleshooting and checking which free models are available.
**Where:** `cli.py`.

## E. User interface

### T19. Copilot workspace page `/copilot` ✅
**Description:** A three-column workspace:
- **Left:** chats and My notes.
- **Middle:** the conversation, with streaming answers and progress steps.
- **Right:** the people and accounts in focus, and the sources used in this chat.

The chat itself supports:
- @mentions and /commands (`/prep`, `/remember`, `/changes`);
- ↑ to edit your last question, Stop, and Ask again;
- follow-up suggestions, clickable source pills and sortable tables;
- a download menu and a help panel.

The page also has a quota meter, chat search / rename / pin, jump-to-latest, dark mode and a mobile layout.
Chat bubbles no longer overflow the layout.
**Where:** `templates/copilot.html`, `js/modules/copilot/{main,chat-view,render,client}.js`, `css/copilot.css`.
**Verified:** ESLint clean; every import resolves; every template ID exists.

### T20. Copilot dock on every page ✅
**Description:** A floating "Ask Copilot" panel (Ctrl/⌘+K) on the main pages. It knows the account or person you
are looking at and shares chats with `/copilot`. The profile page also has an **Ask Copilot** button.
**Where:** `partials/copilot-dock.html`, `js/modules/copilot/dock.js`.

## F. Deals pipeline (planned in README §21, built as `apps/sales_deals`)

### T21. Deals pipeline D1 + D2 ✅
**Description:** A board for Intro → Discovery → Proposal → Pilot → Contract, with drag-and-drop (and Alt+←/→ from the
keyboard). A deal room offers:
- a stage stepper and editable fields;
- a health ring (score, what's going well, what needs attention);
- stage exit criteria that tick themselves from the data;
- the buying committee (roles, sentiment, gaps, recent leadership-change flags);
- activity notes and tasks linked to My Tasks;
- Excel export, a soft stage gate, and a required reason when a deal is lost.

The New deal dialog loads its lists correctly, and hidden dialogs no longer show on page load.
**Where:** `apps/sales_deals/`, `templates/deals.html`, `js/modules/deals/main.js`, `css/deals.css`.
**Verified:** API end to end via TestClient; pages and assets load (200) on the dev server.

## G. Related work in the main app, done for the copilot

### T22. On-demand call-prep and profile generation ✅
**Description:**
- **Call-prep:** a **Generate** button for Sales Call-Prep & Battlecards on the profile page. BNY personas were
  generated in bulk with token-optimised prompts: levels A/B individually, level C grouped, level D skipped.
- **Profile generation:** fixed the Executive Personality / Psychological profile errors, including a `db` module
  name clash and a misleading "no content" message when the real cause was the quota.
- **Readiness checklist:** shows what data a profile needs, and how much, under the Generate button.
- **Download buttons** only appear once a profile exists.

**Where:** `services/callprep_service.py`, `scripts/generate_callprep.py`, the main `api.py`, `profile-*.js`, `callprep-generate.js`.

---

## Also completed, on branch `feature/crm-core-phase1` (commit "crm feature")

These copilot tasks were done after this branch's last commit and exist only on the CRM branch. Merging that
branch brings them here (`chat.py` needs a small manual merge with T13/T14).

| Task | Description |
|---|---|
| **Deals D3: stage toolkits** | One toolkit per stage, with no AI: why now, who to approach, a question bank, the MEDDICC tracker, a value map, a battlecard, an objection pack, a pilot plan, the approval chain and an expansion map. Writing tasks open the copilot with the question pre-filled |
| **Deals D4: copilot knows deals** | A "deals" question type ("which deals are stuck / at risk / closing?"), deal-scoped chats (`?deal_id=`), `?q=` prefill, and a weekly pipeline digest panel |
| **Conversation layout v3** | One 760 px reading column, lighter bubbles, hover actions, loading skeletons, suggestion cards, floating composer |
| **CRM activities in the copilot** | Logged and captured meetings, emails and transcripts are indexed (private ones never) |
| **Better keyword ranking** | Results that match more of the question's words rank first, so a short note matching every rare word beats a long document repeating one common word |
