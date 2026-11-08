-- The order of the questions of an attempt when it was shuffled (ids of quiz_questions); null keeps the quiz order.
ALTER TABLE quiz_attempts ADD COLUMN question_order int[];
