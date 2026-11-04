-- A review session of flashcards: the cards in the order shown (a card graded "again" is appended once more), the
-- grade given at each slot, and where the student stopped, so that a session left on one device resumes on another.
CREATE TABLE study_sessions (
  id serial PRIMARY KEY,
  deck_id int REFERENCES decks(id) ON DELETE CASCADE,  -- null: every due card, whatever the deck
  card_order int[] NOT NULL,
  shuffled boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX study_sessions_open ON study_sessions (deck_id, started_at DESC) WHERE finished_at IS NULL;

CREATE TABLE study_session_answers (
  session_id int NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  slot int NOT NULL,
  card_id int NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  grade smallint NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, slot)
);
