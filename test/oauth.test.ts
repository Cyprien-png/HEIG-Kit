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
import { authenticate, changePassword } from "../src/accounts/users.js";
import { FAST, type TestAccount, newAccount, readyAccount } from "./helpers/accounts.js";
import { testDb } from "./helpers/db.js";

const db = await testDb("heigkit_test_oauth");
after(async () => db?.end());
process.env.HEIG_WEB_DIR = "/nonexistent-web-dir";
const ENV = { HEIG_JWT_SECRET: "0123456789abcdef".repeat(3), HEIG_PUBLIC_URL: "http://127.0.0.1", HEIG_SYNC_MINUTES: "0" };
let lea: TestAccount;
let noe: TestAccount;
let fresh: TestAccount;
let auth: Auth;
let server: Server;
let origin: string;

before(async () => {
  if (!db) return;
  lea = await readyAccount(db, "lea.premiere@heig-vd.ch");
  noe = await readyAccount(db, "noe.second@heig-vd.ch");
  fresh = await newAccount(db, "ada.nouvelle@heig-vd.ch");
  const config = loadServerConfig(ENV);
  const probe = createRemoteServer(createApp(config, db, undefined, { auth: new Auth(config) }), async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  probe.close();
  origin = `http://127.0.0.1:${port}`;
  auth = new Auth(config);
  server = createRemoteServer(createApp({ ...config, publicUrl: new URL(origin) }, db, undefined, { auth }), async () => new McpServer({ name: "t", version: "1" }));
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

  const submit = (password: string, account = lea) => fetch(meta.authorization_endpoint, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(query), email: account.email, password }) });
  assert.equal((await submit("wrong")).status, 401);
  assert.equal((await submit(noe.password)).status, 401, "the password of another account");
  const ok = await submit(lea.password);
  assert.equal(ok.status, 302);
  const location = new URL(ok.headers.get("location")!);
  assert.equal(location.origin + location.pathname, redirect);
  assert.equal(location.searchParams.get("state"), "xyz");
  const code = location.searchParams.get("code")!;

  const tokenReq = (body: Record<string, string>) => fetch(meta.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  assert.equal((await tokenReq({ grant_type: "authorization_code", code, client_id, redirect_uri: redirect, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier-wrong" })).status, 400);
  // The code was consumed by the failed attempt: get a fresh one.
  const code2 = new URL((await submit(lea.password)).headers.get("location")!).searchParams.get("code")!;
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

  // The tokens are those of the account that logged in, and of no other.
  const whoami = async (token: string) => ((await (await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { email: string }).email;
  assert.equal(await whoami(access_token), lea.email);
  const noeCode = new URL((await submit(noe.password, noe)).headers.get("location")!).searchParams.get("code")!;
  const noeTokens = (await (await tokenReq({ grant_type: "authorization_code", code: noeCode, client_id, redirect_uri: redirect, code_verifier: verifier })).json()) as { access_token: string; refresh_token: string };
  assert.equal(await whoami(noeTokens.access_token), noe.email);

  // An account that has not finished its setup gets no code: it is sent to the web application, logged in there.
  const sent = await submit(fresh.password, fresh);
  assert.equal(sent.status, 302);
  assert.match(sent.headers.get("location")!, /^\/\?next=%2Foauth%2Fauthorize%3F/);
  assert.match(sent.headers.get("set-cookie") ?? "", /^heig_session=/);

  // A browser already logged in confirms instead of typing its password again; the form only works for its session.
  const session = `heig_session=${(await auth.issueToken(noe.user)).token}`;
  const confirmPage = await (await fetch(`${meta.authorization_endpoint}?${query}`, { headers: { Cookie: session } })).text();
  assert.match(confirmPage, /Noe Second/);
  assert.doesNotMatch(confirmPage, /name="password"/);
  const consent = /name="consent" value="([^"]+)"/.exec(confirmPage)![1];
  const confirm = (cookie: string, value: string) => fetch(meta.authorization_endpoint, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie }, body: new URLSearchParams({ ...Object.fromEntries(query), consent: value }) });
  assert.equal((await confirm(`heig_session=${(await auth.issueToken(lea.user)).token}`, consent)).status, 401, "a form shown to another session");
  assert.equal((await confirm("", consent)).status, 401);
  const confirmed = await confirm(session, consent);
  assert.equal(confirmed.status, 302);
  const confirmedCode = new URL(confirmed.headers.get("location")!).searchParams.get("code")!;
  const confirmedTokens = (await (await tokenReq({ grant_type: "authorization_code", code: confirmedCode, client_id, redirect_uri: redirect, code_verifier: verifier })).json()) as { access_token: string };
  assert.equal(await whoami(confirmedTokens.access_token), noe.email);

  // A new password ends every grant of the account: its access and refresh tokens stop at once.
  const login = (await authenticate(db!, noe.email, noe.password))!;
  await changePassword(db!, login.user, "un tout autre mot de passe", login.vaultKey, FAST);
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${noeTokens.access_token}` } })).status, 401);
  assert.equal((await tokenReq({ grant_type: "refresh_token", refresh_token: noeTokens.refresh_token, client_id })).status, 400);
  assert.equal(await whoami(access_token), lea.email, "the other account is untouched");
});

test("the CLI logs in with the authorization code flow on a loopback port", { skip: !db && "no local database" }, async () => {
  const { RemoteClient, remoteLogin } = await import("../src/remote/client.js");
  const url = new URL(origin);
  const saved = await remoteLogin(url, async (loginUrl) => {
    // The person's browser: the login page, then the redirection back to this computer.
    const answer = await fetch(loginUrl, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(new URL(loginUrl).searchParams), email: lea.email, password: lea.password }) });
    assert.equal(answer.status, 302);
    void fetch(answer.headers.get("location")!);
  });
  assert.ok(saved.refreshToken);
  assert.equal((await new RemoteClient(url, saved.token).get<{ email: string }>("/api/auth/me")).email, lea.email);
});
