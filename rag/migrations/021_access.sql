-- The kind of access each account chose (src/accounts/access.ts), which has nothing to do with its role: 'campus'
-- connects its edu-ID account (timetable, grades, deadlines, calendar), 'local' never gives the server anything of
-- edu-ID and does without those. NULL: not chosen yet, asked at the next login.
ALTER TABLE users ADD COLUMN access text CHECK (access IN ('campus', 'local'));
UPDATE users SET access = 'campus' WHERE campus_verified_at IS NOT NULL;
