-- Tags of the library (src/app/library.ts): the course and the type or topic tags of a generated document or video,
-- set by the agent or the user; items without a row are classified from their name and title.
CREATE TABLE library_tags (
  item text PRIMARY KEY,              -- document:name or video:name (base name without extension)
  course text,
  tags text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
