import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Auth } from "../src/server/auth.js";
import { type App, createApp } from "../src/server/app.js";
import { loadServerConfig } from "../src/server/config.js";
import { createRemoteServer } from "../src/server/http.js";
import { pkceMatches, validRedirectUri } from "../src/server/oauth.js";
import { authenticate, changePassword, getUser, markCampus, saveCampusCredentials } from "../src/accounts/users.js";
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
let app: App;
/** Logins the server made on (a fake) edu-ID. */
let campusLogins = 0;

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
  app = createApp({ ...config, publicUrl: new URL(origin) }, db, undefined, { auth, campusLogin: async () => void campusLogins++ });
  server = createRemoteServer(app, async () => new McpServer({ name: "t", version: "1" }));
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

test("tokens carry the key of the sealed edu-ID credentials, wrapped for the server alone", { skip: !db && "no local database" }, async () => {
  const registered = await fetch(`${origin}/oauth/register`, { method: "POST", body: JSON.stringify({ client_name: "CLI", redirect_uris: ["http://127.0.0.1:7777/cb"], token_endpoint_auth_method: "none" }) });
  const { client_id } = (await registered.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const form = { response_type: "code", client_id, redirect_uri: "http://127.0.0.1:7777/cb", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" };
  const tokenReq = (body: Record<string, string>) => fetch(`${origin}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const me = async (token: string) => (await (await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { campus: { state: string; unlocked: boolean } };
  const claims = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8")) as { vk?: string };

  const zoe = await readyAccount(db!, "zoe.troisieme@heig-vd.ch");
  // Zoé connected edu-ID: the credentials are sealed with the key of her password.
  const secret = { email: "noe@edu-id.example", password: "le secret edu-ID de Zoé" };
  const key = (await authenticate(db!, zoe.email, zoe.password))!.vaultKey;
  await saveCampusCredentials(db!, zoe.user.id, key, secret);

  const login = await fetch(`${origin}/oauth/authorize`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, email: zoe.email, password: zoe.password }) });
  const code = new URL(login.headers.get("location")!).searchParams.get("code")!;
  const first = (await (await tokenReq({ grant_type: "authorization_code", code, client_id, redirect_uri: form.redirect_uri, code_verifier: verifier })).json()) as { access_token: string; refresh_token: string };

  // The key is in the tokens, unreadable without the server's secret, and nowhere in the database.
  const wrapped = claims(first.access_token).vk!;
  assert.ok(wrapped && !wrapped.includes(key.toString("base64url")) && !Buffer.from(wrapped, "base64url").includes(key));
  assert.deepEqual(auth.unwrapVaultKey(zoe.user.id, wrapped), key);
  assert.equal(auth.unwrapVaultKey(lea.user.id, wrapped), undefined, "a key wrapped for one account opens nothing for another");
  assert.equal(new Auth(loadServerConfig({ ...ENV, HEIG_JWT_SECRET: "fedcba9876543210".repeat(3) })).unwrapVaultKey(zoe.user.id, wrapped), undefined, "another server's secret");
  const stored = JSON.stringify((await db!.system.query("SELECT * FROM oauth_refresh_tokens")).rows);
  assert.ok(!stored.includes(first.refresh_token) && !stored.includes(wrapped));

  // The server forgot everything (a restart): a request with the token is enough to open the credentials again.
  app.vault.forget(zoe.user.id);
  assert.equal(app.vault.credentials(zoe.user.id), undefined);
  assert.equal((await me(first.access_token)).campus.unlocked, true);
  assert.deepEqual(app.vault.credentials(zoe.user.id), secret);
  assert.equal(app.vault.credentials(lea.user.id), undefined);

  // A refresh hands the key on to the next tokens.
  app.vault.forget(zoe.user.id);
  const second = (await (await tokenReq({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id })).json()) as { access_token: string; refresh_token: string };
  assert.deepEqual(auth.unwrapVaultKey(zoe.user.id, claims(second.access_token).vk), key);
  assert.match(second.refresh_token, /\./);

  // The edu-ID session ended while she was away: her next request renews it, without asking her anything.
  await markCampus(db!, zoe.user.id, "expired");
  app.vault.forget(zoe.user.id);
  const before = campusLogins;
  await me(second.access_token);
  for (let i = 0; i < 50 && (await getUser(db!, zoe.user.id))!.campusState !== "ok"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal((await getUser(db!, zoe.user.id))!.campusState, "ok");
  assert.ok(campusLogins > before);

  // A token without the key (issued before the account had one at hand) still works, and opens nothing.
  app.vault.forget(zoe.user.id);
  const bare = (await auth.issueToken((await getUser(db!, zoe.user.id))!)).token;
  assert.equal((await me(bare)).campus.unlocked, false);
});
