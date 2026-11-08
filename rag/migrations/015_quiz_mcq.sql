-- Multiple-choice questions (src/app/quizzes.ts): a question with `options` is a QCM, its right answers are the indexes
-- in `correct` (one or several); a true/false question keeps `answer`. An answer to a QCM keeps the chosen indexes.
ALTER TABLE quiz_questions ALTER COLUMN answer DROP NOT NULL;
ALTER TABLE quiz_questions ADD COLUMN options text[];
ALTER TABLE quiz_questions ADD COLUMN correct int[];
ALTER TABLE quiz_answers ALTER COLUMN answer DROP NOT NULL;
ALTER TABLE quiz_answers ADD COLUMN choice int[];
