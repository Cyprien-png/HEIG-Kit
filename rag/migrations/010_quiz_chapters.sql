-- The chapter of a quiz question (src/app/quizzes.ts): the last finished attempt of each quiz counts in the profile's
-- chapter status (src/app/profile.ts), one point for or against the chapter per answer.
ALTER TABLE quiz_questions ADD COLUMN chapter text;
