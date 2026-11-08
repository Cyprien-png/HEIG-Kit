-- OAuth 2.1 authorization server of the remote server (src/server/oauth.ts), so that clients which only speak OAuth
-- (claude.ai connectors, the Claude phone app) can use /mcp. Codes and refresh tokens are stored hashed.
CREATE TABLE oauth_clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  redirect_uris jsonb NOT NULL,
  secret_hash text,                  -- null for public clients (token_endpoint_auth_method = none)
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients (id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,      -- PKCE, S256 only
  scope text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE oauth_refresh_tokens (
  token_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients (id) ON DELETE CASCADE,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX oauth_refresh_tokens_client_idx ON oauth_refresh_tokens (client_id);
