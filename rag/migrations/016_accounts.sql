-- Accounts (docs/accounts.md): several people share one server. Course material, generated documents and videos,
-- decks and quizzes are shared and remember who created them; everything personal (calendars, snapshots of GAPS and
-- Cyberlearn, the profile, corrections, work copies, the progress on cards and quizzes) belongs to one account.
--
-- The separation is enforced here, by row level security, and not by the queries of the application: the application
-- runs its queries as the role `heigkit_app` with the account of the request in `heig.user_id` (src/rag/db.ts). A query
-- that forgets its account sees nothing and writes nothing.

CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
  -- Argon2id (src/accounts/password.ts); null until an account is created on this row.
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT true,
  password_changed_at timestamptz,
  -- Raised to revoke every token of the account.
  token_version int NOT NULL DEFAULT 1,
  -- The edu-ID credentials, sealed with a key derived from the account's password: the server alone cannot read them.
  campus_sealed bytea,
  -- missing: never connected; ok; expired: the edu-ID session ended and the account must unlock its credentials again.
  campus_state text NOT NULL DEFAULT 'missing' CHECK (campus_state IN ('missing', 'ok', 'expired')),
  campus_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

-- The owner of a single-user installation: its data, and what the commands run on the machine itself act as. The first
-- account created on a server takes this row over (npm run users -- add).
INSERT INTO users (id, email, first_name, role) VALUES (1, 'local@heig-kit', 'Local', 'admin');
SELECT setval('users_id_seq', 1);

-- The account and role of the current request, set by the application for each query.
CREATE FUNCTION heig_user() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('heig.user_id', true), '')::bigint $$;
CREATE FUNCTION heig_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('heig.role', true), '') = 'admin' $$;
-- Shared things are changed by their author or an administrator.
CREATE FUNCTION heig_may_edit(author bigint) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT heig_admin() OR (author IS NOT NULL AND author = heig_user()) $$;

-- Personal tables: one owner, nobody else, administrators included.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['snapshots', 'calendars', 'calendar_versions', 'card_state', 'card_reviews', 'study_sessions', 'study_session_answers',
                           'corrections', 'correction_photos', 'profile_notes', 'course_chapters', 'quiz_attempts', 'quiz_answers', 'workcopies'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN user_id bigint REFERENCES users (id) ON DELETE CASCADE', t);
    EXECUTE format('UPDATE %I SET user_id = 1', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN user_id SET DEFAULT heig_user()', t);
    EXECUTE format('CREATE INDEX %I ON %I (user_id)', t || '_user_idx', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owner ON %I USING (user_id = heig_user()) WITH CHECK (user_id = heig_user())', t);
  END LOOP;
END $$;

-- What was unique for one person is now unique per account.
ALTER TABLE card_state DROP CONSTRAINT card_state_pkey, ADD PRIMARY KEY (user_id, card_id);
ALTER TABLE calendars DROP CONSTRAINT calendars_slug_key, ADD UNIQUE (user_id, slug);
ALTER TABLE course_chapters DROP CONSTRAINT course_chapters_course_position_key, ADD UNIQUE (user_id, course, position);

-- A row never hangs on another account's parent (the parent is looked up with the caller's own rights).
CREATE POLICY parent ON correction_photos AS RESTRICTIVE USING (true) WITH CHECK (EXISTS (SELECT 1 FROM corrections c WHERE c.id = correction_id));
CREATE POLICY parent ON quiz_answers AS RESTRICTIVE USING (true) WITH CHECK (EXISTS (SELECT 1 FROM quiz_attempts a WHERE a.id = attempt_id));
CREATE POLICY parent ON study_session_answers AS RESTRICTIVE USING (true) WITH CHECK (EXISTS (SELECT 1 FROM study_sessions s WHERE s.id = session_id));
CREATE POLICY parent ON calendar_versions AS RESTRICTIVE USING (true) WITH CHECK (EXISTS (SELECT 1 FROM calendars c WHERE c.id = calendar_id));

-- Every account has the built-in calendars.
CREATE FUNCTION seed_user_calendars() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO calendars (user_id, slug, name, color, description, position) VALUES
    (NEW.id, 'schedule', 'Horaires', '#2563eb', 'Les cours de l''horaire GAPS, avec le programme annoncé sur Cyberlearn', 0),
    (NEW.id, 'exams', 'Examens', '#dc2626', 'Travaux écrits et évaluations', 1),
    (NEW.id, 'deadlines', 'Rendus', '#d97706', 'Devoirs, rendus et quiz Cyberlearn', 2);
  RETURN NEW;
END $$;
CREATE TRIGGER users_calendars AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION seed_user_calendars();

-- Shared tables: everyone reads, the author (or an administrator) changes.
ALTER TABLE decks ADD COLUMN created_by bigint DEFAULT heig_user() REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE quizzes ADD COLUMN created_by bigint DEFAULT heig_user() REFERENCES users (id) ON DELETE SET NULL;
UPDATE decks SET created_by = 1;
UPDATE quizzes SET created_by = 1;
CREATE INDEX decks_created_by_idx ON decks (created_by);
CREATE INDEX quizzes_created_by_idx ON quizzes (created_by);

-- Who created each generated document and video (`document:name`, `video:name`), which also reserves its name.
CREATE TABLE library_items (
  item text PRIMARY KEY,
  created_by bigint DEFAULT heig_user() REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX library_items_created_by_idx ON library_items (created_by);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['decks', 'quizzes', 'library_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY read ON %I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY add ON %I FOR INSERT WITH CHECK (created_by = heig_user())', t);
    EXECUTE format('CREATE POLICY change ON %I FOR UPDATE USING (heig_may_edit(created_by))', t);
    EXECUTE format('CREATE POLICY remove ON %I FOR DELETE USING (heig_may_edit(created_by))', t);
  END LOOP;
END $$;

-- Cards and questions follow their deck or quiz.
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON cards FOR SELECT USING (true);
CREATE POLICY add ON cards FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM decks d WHERE d.id = deck_id AND heig_may_edit(d.created_by)));
CREATE POLICY change ON cards FOR UPDATE USING (EXISTS (SELECT 1 FROM decks d WHERE d.id = deck_id AND heig_may_edit(d.created_by)));
CREATE POLICY remove ON cards FOR DELETE USING (EXISTS (SELECT 1 FROM decks d WHERE d.id = deck_id AND heig_may_edit(d.created_by)));

ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON quiz_questions FOR SELECT USING (true);
CREATE POLICY add ON quiz_questions FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM quizzes q WHERE q.id = quiz_id AND heig_may_edit(q.created_by)));
CREATE POLICY change ON quiz_questions FOR UPDATE USING (EXISTS (SELECT 1 FROM quizzes q WHERE q.id = quiz_id AND heig_may_edit(q.created_by)));
CREATE POLICY remove ON quiz_questions FOR DELETE USING (EXISTS (SELECT 1 FROM quizzes q WHERE q.id = quiz_id AND heig_may_edit(q.created_by)));

-- The course and tags of a library item are set by its author; items nobody is known to have created, by anyone.
ALTER TABLE library_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON library_tags FOR SELECT USING (true);
CREATE POLICY add ON library_tags FOR INSERT WITH CHECK (NOT EXISTS (SELECT 1 FROM library_items i WHERE i.item = library_tags.item AND NOT heig_may_edit(i.created_by)));
CREATE POLICY change ON library_tags FOR UPDATE USING (NOT EXISTS (SELECT 1 FROM library_items i WHERE i.item = library_tags.item AND NOT heig_may_edit(i.created_by)));
CREATE POLICY remove ON library_tags FOR DELETE USING (NOT EXISTS (SELECT 1 FROM library_items i WHERE i.item = library_tags.item AND NOT heig_may_edit(i.created_by)));

-- Names of the members, the only thing an account sees of the others.
CREATE VIEW members AS SELECT id, first_name, last_name, role FROM users WHERE disabled_at IS NULL;

-- The role the application's queries run as. Cluster-wide: several databases may create it at the same time (tests).
DO $$
BEGIN
  CREATE ROLE heigkit_app NOLOGIN;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;
DO $$
BEGIN
  -- A superuser may take any role; another owner must be a member of it.
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT heigkit_app TO %I', current_user);
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO heigkit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO heigkit_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO heigkit_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO heigkit_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO heigkit_app;
-- Accounts, tokens and journals are only reached by the server itself (the `system` side of src/rag/db.ts).
REVOKE ALL ON users, oauth_clients, oauth_codes, oauth_refresh_tokens, request_log, sync_runs, schema_migrations FROM heigkit_app;
