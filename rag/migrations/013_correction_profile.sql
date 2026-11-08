-- Whether a correction counts in the student's profile (grades per course, weaknesses, chapter radar). On by default;
-- a correction kept for reference (an old test, a trial) can be left out without deleting its notes.
ALTER TABLE corrections ADD COLUMN affects_profile boolean NOT NULL DEFAULT true;
