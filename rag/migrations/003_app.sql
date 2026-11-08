-- Tables of the web application (docs/app.md): snapshots of GAPS and Cyberlearn, the versioned calendar, flashcards,
-- corrections, the student's profile, sync runs and the request log of the status page.

-- Latest state of what the server fetches (schedule, deadlines, grades, transcript, plan, absences, courses). A new
-- row is only written when the data changed; `checked_at` says when it was last confirmed unchanged.
CREATE TABLE snapshots (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  hash text NOT NULL,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX snapshots_kind_idx ON snapshots (kind, fetched_at DESC);

-- Every version of every calendar event. The displayed version of a key is its most recent row: a manual override
-- wins until the source changes again after it (see docs/app.md).
CREATE TABLE calendar_versions (
  id bigserial PRIMARY KEY,
  key text NOT NULL,                 -- gaps:<summary>|<start>, cyberlearn:<event id>, manual:<uuid>
  source text NOT NULL,              -- gaps, cyberlearn, manual
  kind text NOT NULL,                -- lesson, deadline, exam, event
  title text NOT NULL,
  course text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  url text,
  details text,
  deleted boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  author text NOT NULL DEFAULT 'sync' -- sync, user, agent
);
CREATE INDEX calendar_versions_key_idx ON calendar_versions (key, fetched_at DESC);
CREATE INDEX calendar_versions_time_idx ON calendar_versions (starts_at);

-- Background work of the server: syncs, ingestion checks, renders.
CREATE TABLE sync_runs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,                -- gaps, cyberlearn, ingest-check, ingest
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  message text,
  stats jsonb
);
CREATE INDEX sync_runs_kind_idx ON sync_runs (kind, started_at DESC);

-- Last requests, for the status page (pruned after a few days).
CREATE TABLE request_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  client text,
  method text NOT NULL,
  path text NOT NULL,
  status int NOT NULL,
  ms int NOT NULL,
  tool text,                         -- MCP tool called, if any
  note text                          -- e.g. "invalid token"
);
CREATE INDEX request_log_at_idx ON request_log (at DESC);

CREATE TABLE decks (
  id bigserial PRIMARY KEY,
  course text,
  title text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cards (
  id bigserial PRIMARY KEY,
  deck_id bigint NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  front text NOT NULL,               -- Markdown with LaTeX
  back text NOT NULL,
  hint text,
  tags text[] NOT NULL DEFAULT '{}',
  source text,                       -- where it comes from, e.g. "Cours MAD ch. 1 p. 32"
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cards_deck_idx ON cards (deck_id, position);

-- Spaced repetition state of a card (absent until first studied).
CREATE TABLE card_state (
  card_id bigint PRIMARY KEY REFERENCES cards (id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  interval_days real NOT NULL,
  ease real NOT NULL,
  reps int NOT NULL DEFAULT 0,
  lapses int NOT NULL DEFAULT 0,
  last_grade int,
  reviewed_at timestamptz
);

CREATE TABLE card_reviews (
  id bigserial PRIMARY KEY,
  card_id bigint NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  grade int NOT NULL,                -- 0 again, 1 hard, 2 good, 3 easy
  interval_days real NOT NULL
);
CREATE INDEX card_reviews_card_idx ON card_reviews (card_id, reviewed_at DESC);

CREATE TABLE corrections (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  course text,
  topic text,
  state text NOT NULL DEFAULT 'capture', -- capture, received, corrected
  notes text,                        -- what the agent asked the student to photograph
  result jsonb,                      -- the correction (see src/app/corrections.ts)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  corrected_at timestamptz
);
CREATE INDEX corrections_created_idx ON corrections (created_at DESC);

CREATE TABLE correction_photos (
  id bigserial PRIMARY KEY,
  correction_id uuid NOT NULL REFERENCES corrections (id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  file text NOT NULL,                -- under data/corrections/<id>/
  content_type text NOT NULL,
  bytes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX correction_photos_idx ON correction_photos (correction_id, position);

-- What the student does well and badly, observed by the agent while correcting (or told by the student).
CREATE TABLE profile_notes (
  id bigserial PRIMARY KEY,
  course text,
  topic text NOT NULL,
  kind text NOT NULL,                -- weakness, strength, mistake, note
  text text NOT NULL,
  severity int NOT NULL DEFAULT 2,   -- 1 minor, 2 notable, 3 recurring or blocking
  correction_id uuid REFERENCES corrections (id) ON DELETE SET NULL,
  exercise text,
  embedding vector(1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX profile_notes_course_idx ON profile_notes (course, kind) WHERE resolved_at IS NULL;
