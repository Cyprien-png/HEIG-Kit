-- Sections of a chapter (src/app/profile.ts): the sub-chapters shown inside each chapter of the profile, each with its
-- keywords, as `[{"title": "Relation d'ordre", "keywords": ["ordre partiel", "ordre total"]}]`. Notes and quiz questions
-- may name theirs.
ALTER TABLE course_chapters ADD COLUMN sections jsonb NOT NULL DEFAULT '[]';
ALTER TABLE profile_notes ADD COLUMN section text;
ALTER TABLE quiz_questions ADD COLUMN section text;
