-- Chapters of a course (src/app/profile.ts): the axes of the profile's radar. Set by the agent from the syllabus or by
-- the student; a note is filed under a chapter by its `chapter` field, or by the chapter's keywords matching its topic.
CREATE TABLE course_chapters (
  id bigserial PRIMARY KEY,
  course text NOT NULL,
  position int NOT NULL,
  title text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',   -- topics of the chapter, as written in the notes
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course, position)
);

ALTER TABLE profile_notes ADD COLUMN chapter text;
