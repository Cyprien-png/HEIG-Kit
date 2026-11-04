-- Calendars (layers) of the calendar page: the built-in ones receive the events of the sources, the user's own hold
-- revision plans and anything else. Every event version belongs to one calendar.
CREATE TABLE calendars (
  id serial PRIMARY KEY,
  slug text UNIQUE,                  -- schedule, exams, deadlines for the built-in ones; null for the user's own
  name text NOT NULL,
  color text NOT NULL,               -- #rrggbb
  description text,
  visible boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO calendars (slug, name, color, description, position) VALUES
  ('schedule', 'Horaires', '#2563eb', 'Les cours de l''horaire GAPS, avec le programme annoncé sur Cyberlearn', 0),
  ('exams', 'Examens', '#dc2626', 'Travaux écrits et évaluations', 1),
  ('deadlines', 'Rendus', '#d97706', 'Devoirs, rendus et quiz Cyberlearn', 2);

ALTER TABLE calendar_versions ADD COLUMN calendar_id int REFERENCES calendars (id) ON DELETE CASCADE;
UPDATE calendar_versions SET calendar_id = (
  SELECT id FROM calendars WHERE slug = CASE kind WHEN 'exam' THEN 'exams' WHEN 'deadline' THEN 'deadlines' ELSE 'schedule' END
);
ALTER TABLE calendar_versions ALTER COLUMN calendar_id SET NOT NULL;
CREATE INDEX calendar_versions_calendar_idx ON calendar_versions (calendar_id);
