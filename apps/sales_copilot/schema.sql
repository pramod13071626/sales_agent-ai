-- Sales Copilot schema (README §4.3, §18.4). Idempotent: safe to run repeatedly.
-- Phase-1 subset: outbox triggers (§7.1) come in Phase 3; until then `cli sync`
-- diffs the whole corpus by content hash (cheap: no re-embedding of unchanged text).

CREATE TABLE IF NOT EXISTS rag_index_versions (
  id                  serial PRIMARY KEY,
  collection_name     text NOT NULL UNIQUE,
  embed_model         text NOT NULL,
  dims                int  NOT NULL,
  chunker_version     text NOT NULL,
  attribution_version text NOT NULL,
  status              text NOT NULL CHECK (status IN ('building','active','retired')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  activated_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_index ON rag_index_versions ((true)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS rag_documents (
  id              bigserial PRIMARY KEY,
  canonical_key   text NOT NULL,
  version         int  NOT NULL,
  is_current      boolean NOT NULL DEFAULT true,
  doc_type        text NOT NULL,
  title           text,
  url             text,
  published_at    timestamptz,
  content_hash    bytea NOT NULL,
  simhash         bigint,
  near_dup_of     bigint REFERENCES rag_documents(id),
  render_version  text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}',
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  deleted_at      timestamptz,
  UNIQUE (canonical_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS rag_doc_current ON rag_documents (canonical_key) WHERE is_current;

CREATE TABLE IF NOT EXISTS rag_document_sources (
  canonical_key text NOT NULL,
  source_table  text NOT NULL,
  source_pk     text NOT NULL,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_pk)
);
CREATE INDEX IF NOT EXISTS rag_doc_sources_key ON rag_document_sources (canonical_key);

CREATE TABLE IF NOT EXISTS rag_document_entities (
  canonical_key text NOT NULL,
  account_id    int  NOT NULL,
  persona_id    int,
  lob_id        int,
  relation      text NOT NULL,
  confidence    real NOT NULL DEFAULT 1.0
);
CREATE UNIQUE INDEX IF NOT EXISTS rag_doc_entities_uq
  ON rag_document_entities (canonical_key, account_id, coalesce(persona_id, 0), relation);
CREATE INDEX IF NOT EXISTS rag_doc_entities_acct ON rag_document_entities (account_id);
CREATE INDEX IF NOT EXISTS rag_doc_entities_persona ON rag_document_entities (persona_id) WHERE persona_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rag_chunks (
  chunk_hash   bytea PRIMARY KEY,
  text         text NOT NULL,
  token_count  int  NOT NULL,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rag_chunks_tsv ON rag_chunks USING gin (tsv);

CREATE TABLE IF NOT EXISTS rag_document_chunks (
  document_id bigint NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  ordinal     int    NOT NULL,
  chunk_hash  bytea  NOT NULL REFERENCES rag_chunks(chunk_hash),
  PRIMARY KEY (document_id, ordinal)
);
CREATE INDEX IF NOT EXISTS rag_doc_chunks_hash ON rag_document_chunks (chunk_hash);

CREATE TABLE IF NOT EXISTS rag_index_entries (
  index_version_id int   NOT NULL REFERENCES rag_index_versions(id) ON DELETE CASCADE,
  chunk_hash       bytea NOT NULL REFERENCES rag_chunks(chunk_hash) ON DELETE CASCADE,
  account_id       int   NOT NULL,
  indexed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (index_version_id, chunk_hash, account_id)
);

CREATE TABLE IF NOT EXISTS rag_sync_state (
  source_table         text PRIMARY KEY,
  last_reconcile_at    timestamptz,
  last_reconcile_stats jsonb
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id          bigserial PRIMARY KEY,
  day_utc     date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  feature     text NOT NULL,
  model       text NOT NULL,
  user_id     int,
  ok          boolean,                 -- NULL = reserved, in flight
  status_code int,
  tokens_in   int, tokens_out int,
  reserved_tokens int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_usage_day ON llm_usage (day_utc, feature);

CREATE TABLE IF NOT EXISTS copilot_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      int,
  persona_id      int,
  title           text,
  summary         text,
  active_entities jsonb NOT NULL DEFAULT '[]',
  pinned          boolean NOT NULL DEFAULT false,
  archived_at     timestamptz,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS copilot_sessions_user ON copilot_sessions (user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id               bigserial PRIMARY KEY,
  session_id       uuid NOT NULL REFERENCES copilot_sessions(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user','assistant')),
  content          text NOT NULL,
  mode             text,
  intent           text,
  citations        jsonb,
  extras           jsonb,              -- table rows, contact cards, notes used (rendered by the UI)
  llm_model        text,
  index_version_id int,
  evidence_hash    bytea,
  tokens_in        int, tokens_out int, latency_ms int,
  feedback         smallint,
  feedback_note    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS copilot_messages_session ON copilot_messages (session_id, id);
CREATE INDEX IF NOT EXISTS copilot_messages_evidence ON copilot_messages (evidence_hash) WHERE evidence_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS copilot_user_prefs (
  user_id            int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  memory_enabled     boolean NOT NULL DEFAULT true,
  answer_style       text NOT NULL DEFAULT 'balanced' CHECK (answer_style IN ('brief','balanced','detailed')),
  default_account_id int,
  favorite_personas  int[] NOT NULL DEFAULT '{}',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS copilot_memories (
  id                bigserial PRIMARY KEY,
  user_id           int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('note','fact','reminder','preference')),
  text              text NOT NULL CHECK (length(text) <= 1000),
  account_id        int,
  persona_id        int,
  source_message_id bigint REFERENCES copilot_messages(id) ON DELETE SET NULL,
  embedding         real[],
  pinned            boolean NOT NULL DEFAULT false,
  expires_at        timestamptz,
  last_used_at      timestamptz,
  use_count         int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS copilot_memories_user ON copilot_memories (user_id) WHERE deleted_at IS NULL;

-- ── Change capture (README §7.1) ────────────────────────────────────────────
-- Triggers only enqueue "something changed" rows; the in-process worker
-- (sync.py) drains them by running the hash-diff sync, which re-embeds only
-- text that actually changed. posts/jobs/cxo fire on CONTENT columns only,
-- because every scrape bumps their last_seen.
CREATE TABLE IF NOT EXISTS rag_outbox (
  id           bigserial PRIMARY KEY,
  source_table text NOT NULL,
  source_pk    text,
  op           char(1) NOT NULL CHECK (op IN ('I','U','D')),
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS rag_outbox_pending ON rag_outbox (id) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION rag_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  INSERT INTO rag_outbox (source_table, source_pk, op)
  VALUES (TG_TABLE_NAME, rec ->> TG_ARGV[0], left(TG_OP, 1));
  RETURN NULL;
END $$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('posts', 'id', 'OLD.body IS DISTINCT FROM NEW.body OR OLD.post_url IS DISTINCT FROM NEW.post_url OR OLD.extra IS DISTINCT FROM NEW.extra'),
      ('linkedin_jobs', 'id', 'OLD.title IS DISTINCT FROM NEW.title OR OLD.description IS DISTINCT FROM NEW.description OR OLD.location IS DISTINCT FROM NEW.location'),
      ('cxo_movements', 'id', 'OLD.context IS DISTINCT FROM NEW.context OR OLD.designation IS DISTINCT FROM NEW.designation OR OLD.event_type IS DISTINCT FROM NEW.event_type'),
      ('personas', 'id', 'OLD.* IS DISTINCT FROM NEW.*'),
      ('accounts', 'id', 'OLD.* IS DISTINCT FROM NEW.*'),
      ('lobs', 'id', 'OLD.* IS DISTINCT FROM NEW.*'),
      ('opportunity_signals', 'id', 'OLD.title IS DISTINCT FROM NEW.title OR OLD.details IS DISTINCT FROM NEW.details OR OLD.status IS DISTINCT FROM NEW.status'),
      ('digests', 'target_key', 'OLD.digest IS DISTINCT FROM NEW.digest')
    ) AS v(tbl, pk, upd_when)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS rag_%s_ins ON %I', t.tbl, t.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS rag_%s_del ON %I', t.tbl, t.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS rag_%s_upd ON %I', t.tbl, t.tbl);
    EXECUTE format('CREATE TRIGGER rag_%s_ins AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION rag_enqueue(%L)', t.tbl, t.tbl, t.pk);
    EXECUTE format('CREATE TRIGGER rag_%s_del AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rag_enqueue(%L)', t.tbl, t.tbl, t.pk);
    EXECUTE format('CREATE TRIGGER rag_%s_upd AFTER UPDATE ON %I FOR EACH ROW WHEN (%s) EXECUTE FUNCTION rag_enqueue(%L)',
                   t.tbl, t.tbl, t.upd_when, t.pk);
  END LOOP;
END $$;
