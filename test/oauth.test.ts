import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Auth } from "../src/server/auth.js";
import { createApp } from "../src/server/app.js";
import { loadServerConfig } from "../src/server/config.js";
import { createRemoteServer } from "../src/server/http.js";
import { pkceMatches, validRedirectUri } from "../src/server/oauth.js";
import { testDb } from "./helpers/db.js";

const db = await testDb("heigkit_test_oauth");
after(async () => db?.end());
process.env.HEIG_WEB_DIR = "/nonexistent-web-dir";
const ENV = { HEIG_AUTH_USERNAME: "me", HEIG_AUTH_PASSWORD: "correct-horse-battery", HEIG_JWT_SECRET: "x".repeat(40), HEIG_PUBLIC_URL: "http://127.0.0.1", HEIG_SYNC_MINUTES: "0" };
let server: Server;
let origin: string;

before(async () => {
  if (!db) return;
  const config = loadServerConfig(ENV);
  const probe = createRemoteServer(createApp(config, db, undefined, new Auth(config)), async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  probe.close();
  origin = `http://127.0.0.1:${port}`;
  server = createRemoteServer(createApp({ ...config, publicUrl: new URL(origin) }, db, undefined, new Auth(config)), async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});
after(() => server?.close());

test("redirect URIs and PKCE checks", () => {
  assert.equal(validRedirectUri("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(validRedirectUri("http://localhost:6274/oauth/callback"), true);
  assert.equal(validRedirectUri("http://evil.example/cb"), false);
  assert.equal(validRedirectUri("https://a.example/cb#frag"), false);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(pkceMatches(verifier, challenge), true);
  assert.equal(pkceMatches(`${verifier}x`, challenge), false);
  assert.equal(pkceMatches("short", challenge), false);
});

test("the OAuth flow: metadata, registration, login page, code with PKCE, tokens, refresh, /mcp", { skip: !db && "no local database" }, async () => {
  const unauthorized = await fetch(`${origin}/mcp`, { method: "POST" });
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get("www-authenticate") ?? "", /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
  const prm = (await (await fetch(`${origin}/.well-known/oauth-protected-resource`)).json()) as { authorization_servers: string[] };
  assert.deepEqual(prm.authorization_servers, [origin]);
  const meta = (await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
  assert.equal(meta.registration_endpoint, `${origin}/oauth/register`);

  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const bad = await fetch(meta.registration_endpoint, { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) });
  assert.equal(bad.status, 400);
  const registered = await fetch(meta.registration_endpoint, { method: "POST", body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect], token_endpoint_auth_method: "none" }) });
  assert.equal(registered.status, 201);
  const { client_id, client_secret } = (await registered.json()) as { client_id: string; client_secret?: string };
  assert.equal(client_secret, undefined);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({ response_type: "code", client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "heig-kit" });
  const pageRes = await fetch(`${meta.authorization_endpoint}?${query}`);
  assert.equal(pageRes.status, 200);
  const html = await pageRes.text();
  assert.match(html, /Claude/);
  assert.match(html, /name="password"/);
  assert.match(pageRes.headers.get("content-security-policy") ?? "", /form-action 'self' https:/, "the redirect to the client's callback must be allowed by the CSP");
  assert.equal((await fetch(`${meta.authorization_endpoint}?${new URLSearchParams({ ...Object.fromEntries(query), redirect_uri: "https://evil.example/cb" })}`)).status, 400);

  const submit = (password: string) => fetch(meta.authorization_endpoint, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(query), username: "me", password }) });
  assert.equal((await submit("wrong")).status, 401);
  const ok = await submit(ENV.HEIG_AUTH_PASSWORD);
  assert.equal(ok.status, 302);
  const location = new URL(ok.headers.get("location")!);
  assert.equal(location.origin + location.pathname, redirect);
  assert.equal(location.searchParams.get("state"), "xyz");
  const code = location.searchParams.get("code")!;

  const tokenReq = (body: Record<string, string>) => fetch(meta.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  assert.equal((await tokenReq({ grant_type: "authorization_code", code, client_id, redirect_uri: redirect, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier-wrong" })).status, 400);
  // The code was consumed by the failed attempt: get a fresh one.
  const code2 = new URL((await submit(ENV.HEIG_AUTH_PASSWORD)).headers.get("location")!).searchParams.get("code")!;
  const tokens = await tokenReq({ grant_type: "authorization_code", code: code2, client_id, redirect_uri: redirect, code_verifier: verifier });
  assert.equal(tokens.status, 200);
  const { access_token, refresh_token, expires_in } = (await tokens.json()) as { access_token: string; refresh_token: string; expires_in: number };
  assert.ok(expires_in > 0 && expires_in <= 7 * 86_400);
  assert.equal((await tokenReq({ grant_type: "authorization_code", code: code2, client_id, redirect_uri: redirect, code_verifier: verifier })).status, 400, "a code is single use");

  const mcp = await fetch(`${origin}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  assert.equal(mcp.status, 200);

  const refreshed = await tokenReq({ grant_type: "refresh_token", refresh_token, client_id });
  assert.equal(refreshed.status, 200);
  const next = (await refreshed.json()) as { refresh_token: string };
  assert.notEqual(next.refresh_token, refresh_token);
  assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token, client_id })).status, 400, "a rotated refresh token is refused");
  assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token: next.refresh_token, client_id })).status, 400, "and its reuse revoked the family");
});
