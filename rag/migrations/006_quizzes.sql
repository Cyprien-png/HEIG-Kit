-- True/false quizzes (src/app/quizzes.ts): the agent writes them from the course material, the student answers by
-- swiping on the web app or aloud with a voice assistant through the MCP tools; every attempt keeps its answers.
CREATE TABLE quizzes (
  id serial PRIMARY KEY,
  course text,
  title text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quiz_questions (
  id serial PRIMARY KEY,
  quiz_id int NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  position int NOT NULL,
  statement text NOT NULL,
  answer boolean NOT NULL,
  explanation text,
  source text,
  topic text
);
CREATE INDEX quiz_questions_quiz_idx ON quiz_questions (quiz_id, position);

CREATE TABLE quiz_attempts (
  id serial PRIMARY KEY,
  quiz_id int NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'web',   -- web, voice, cli
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  score int,
  total int NOT NULL
);
CREATE INDEX quiz_attempts_quiz_idx ON quiz_attempts (quiz_id, started_at DESC);

CREATE TABLE quiz_answers (
  attempt_id int NOT NULL REFERENCES quiz_attempts (id) ON DELETE CASCADE,
  question_id int NOT NULL REFERENCES quiz_questions (id) ON DELETE CASCADE,
  answer boolean NOT NULL,
  correct boolean NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);
