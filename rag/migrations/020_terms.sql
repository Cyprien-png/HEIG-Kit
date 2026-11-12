-- The conditions of use each account reads and accepts before anything else (src/accounts/terms.ts): which version,
-- and when. A new version of the text asks everyone again.
ALTER TABLE users ADD COLUMN terms_version text;
ALTER TABLE users ADD COLUMN terms_accepted_at timestamptz;
