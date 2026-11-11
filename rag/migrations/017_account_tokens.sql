-- Tokens, sync runs and requests of the remote server know their account (docs/accounts.md). Reached by the server
-- itself only: the application role has no right on these tables (016_accounts.sql).

-- A code or a refresh token without account gives nothing (src/server/oauth.ts).
ALTER TABLE oauth_codes ADD COLUMN user_id bigint REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE oauth_refresh_tokens ADD COLUMN user_id bigint REFERENCES users (id) ON DELETE CASCADE;
-- Connectors authorized before the accounts log in again, as an account.
DELETE FROM oauth_codes;
DELETE FROM oauth_refresh_tokens;
CREATE INDEX oauth_refresh_tokens_user_idx ON oauth_refresh_tokens (user_id);

ALTER TABLE sync_runs ADD COLUMN user_id bigint REFERENCES users (id) ON DELETE CASCADE;
UPDATE sync_runs SET user_id = 1 WHERE kind IN ('gaps', 'cyberlearn');
CREATE INDEX sync_runs_user_idx ON sync_runs (user_id, kind, started_at DESC);

-- The activity journal of the administrators: who called what.
ALTER TABLE request_log ADD COLUMN user_id bigint REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX request_log_user_idx ON request_log (user_id, at DESC);
