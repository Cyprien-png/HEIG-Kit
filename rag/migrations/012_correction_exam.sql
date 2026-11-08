-- The mock exam a correction corrects (src/app/exams.ts): the library item of the statement, `document:<name>`, so
-- that the Tests blancs page shows which practice exams were done, with their grade and their correction.
ALTER TABLE corrections ADD COLUMN exam text;
CREATE INDEX corrections_exam_idx ON corrections (exam) WHERE exam IS NOT NULL;
