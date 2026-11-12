import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseLibraryId, planSync, saveLibraryFile } from "../src/app/library.js";
import { Auth } from "../src/server/auth.js";
import { type App, createApp } from "../src/server/app.js";
import { loadServerConfig } from "../src/server/config.js";
import { createRemoteServer } from "../src/server/http.js";
import { BadCredentialsError, MfaRequiredError } from "../src/auth/eduid.js";
import { getUser, readCampusCredentials, userCacheDir } from "../src/accounts/users.js";
import { type TestAccount, newAccount, readyAccount } from "./helpers/accounts.js";
import { testDb } from "./helpers/db.js";

const base = mkdtempSync(path.join(os.tmpdir(), "heig-api-"));
process.env.HEIG_OUTPUT_DIR = path.join(base, "out");
mkdirSync(path.join(base, "out", "documents"), { recursive: true });
mkdirSync(path.join(base, "out", "videos"), { recursive: true });
process.env.HEIG_WEB_DIR = path.join(base, "web");
mkdirSync(process.env.HEIG_WEB_DIR);
writeFileSync(path.join(process.env.HEIG_WEB_DIR, "index.html"), "<!doctype html><title>app</title>");

const ENV = { HEIG_JWT_SECRET: "0123456789abcdef".repeat(3), HEIG_PUBLIC_URL: "http://127.0.0.1", HEIG_SYNC_MINUTES: "0" };
const db = await testDb("heigkit_test_api");
const NO_DB = !db && "no local database";
let server: Server;
let origin: string;
let app: App;
let lea: TestAccount;
let noe: TestAccount;
/** What the fake edu-ID answers to the next login. */
let campus: (mfaCode?: string) => Promise<unknown> = async () => undefined;

const JSON_HEADERS = { "Content-Type": "application/json", "X-Requested-With": "heig-kit" };
const bearer = async (account: TestAccount) => ({ Authorization: `Bearer ${(await app.auth.issueToken((await getUser(db!, account.user.id))!)).token}` });

before(async () => {
  if (!db) return;
  lea = await readyAccount(db, "lea.premiere@heig-vd.ch");
  noe = await readyAccount(db, "noe.second@heig-vd.ch");
  const config = loadServerConfig(ENV);
  const probe = createRemoteServer(createApp(config, db, undefined, { auth: new Auth(config) }), async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  probe.close();
  origin = `http://127.0.0.1:${port}`;
  app = createApp({ ...config, publicUrl: new URL(origin) }, db, undefined, { auth: new Auth(config), campusLogin: (code) => campus(code) });
  server = createRemoteServer(app, async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  server?.close();
  rmSync(base, { recursive: true, force: true });
  await db?.end();
});

test("library identifiers and sync plans", () => {
  assert.deepEqual(parseLibraryId("documents/MAD-notes.pdf"), { kind: "documents", name: "MAD-notes.pdf", ext: ".pdf" });
  assert.equal(parseLibraryId("documents/../x.pdf"), undefined);
  assert.equal(parseLibraryId("documents/.hidden.pdf"), undefined);
  assert.equal(parseLibraryId("documents/notes.env"), undefined);
  assert.equal(parseLibraryId("videos/Scene.mp4")?.kind, "videos");
  const f = (id: string, size: number, at: string) => ({ id, kind: "documents" as const, name: id.slice(10), ext: ".pdf", size, modifiedAt: at });
  const plan = planSync(
    [f("documents/a.pdf", 10, "2026-01-01T10:00:00.000Z"), f("documents/b.pdf", 5, "2026-01-02T10:00:00.000Z"), f("documents/same.pdf", 7, "2026-01-01T10:00:00.000Z")],
    [f("documents/b.pdf", 6, "2026-01-01T10:00:00.000Z"), f("documents/c.pdf", 1, "2026-01-03T10:00:00.000Z"), f("documents/same.pdf", 7, "2026-01-01T10:00:00.500Z")],
  );
  assert.deepEqual(plan.push.map((x) => x.id), ["documents/a.pdf", "documents/b.pdf"]);
  assert.deepEqual(plan.pull.map((x) => x.id), ["documents/c.pdf"]);
  assert.throws(() => saveLibraryFile("documents/bad.exe", Buffer.from("x")), /not an acceptable/);
});

test("the web session: cookie login, CSRF header, logout, and the app page", { skip: NO_DB }, async () => {
  const headers = JSON_HEADERS;
  assert.equal((await fetch(`${origin}/api/auth/me`)).status, 401);
  const bad = await fetch(`${origin}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ email: lea.email, password: "nope" }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${origin}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ email: lea.email, password: lea.password }) });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^heig_session=.+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
  const session = cookie.split(";")[0];
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: session } })).status, 200);

  // A state-changing request with the cookie alone is refused: a cross-site page could trigger it.
  const upload = (extra: Record<string, string>) => fetch(`${origin}/api/library/files/documents/notes.md`, { method: "PUT", headers: { Cookie: session, ...extra }, body: "# Notes" });
  assert.equal((await upload({})).status, 403);
  assert.equal((await upload({ "X-Requested-With": "heig-kit" })).status, 200);
  assert.equal(readFileSync(path.join(base, "out", "documents", "notes.md"), "utf-8"), "# Notes");

  const other = await bearer(lea);
  const out = await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Cookie: session, "X-Requested-With": "heig-kit" } });
  assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
  // Logging out ends every session of the account, not only this browser's: the cookie and the other tokens are dead.
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: session } })).status, 401);
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: other })).status, 401);
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: await bearer(lea) })).status, 200, "a new login works");

  // Any other path is the web application, with its security headers.
  const page = await fetch(`${origin}/calendar`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>app<\/title>/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
});

test("library files: bearer upload with kept modification time, range streaming, inline and download", { skip: NO_DB }, async () => {
  const auth = await bearer(lea);
  const mtime = "2026-02-03T04:05:06.000Z";
  const put = await fetch(`${origin}/api/library/files/videos/Scene.mp4`, { method: "PUT", headers: { ...auth, "X-File-Mtime": mtime }, body: "0123456789" });
  assert.equal(put.status, 200);
  assert.equal(((await put.json()) as { modifiedAt: string }).modifiedAt, mtime);
  assert.equal((await fetch(`${origin}/api/library/files/videos/evil.sh`, { method: "PUT", headers: auth, body: "x" })).status, 400);

  const files = (await (await fetch(`${origin}/api/library/files`, { headers: auth })).json()) as { files: { id: string; size: number }[] };
  assert.ok(files.files.some((f) => f.id === "videos/Scene.mp4" && f.size === 10));
  const items = (await (await fetch(`${origin}/api/library`, { headers: auth })).json()) as { items: { kind: string; name: string }[] };
  assert.ok(items.items.some((i) => i.kind === "video" && i.name === "Scene"));

  const part = await fetch(`${origin}/api/library/files/videos/Scene.mp4`, { headers: { ...auth, Range: "bytes=2-4" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await part.text(), "234");
  assert.equal(part.headers.get("content-security-policy"), null, "videos are embeddable");
  const md = await fetch(`${origin}/api/library/files/documents/notes.md`, { headers: auth });
  assert.match(md.headers.get("content-security-policy") ?? "", /sandbox/);
  const dl = await fetch(`${origin}/api/library/files/documents/notes.md?download=1`, { headers: auth });
  assert.match(dl.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal((await fetch(`${origin}/api/library/files/documents/notes.md`, { method: "DELETE", headers: auth })).status, 204);
  assert.equal((await fetch(`${origin}/api/library/files/documents/notes.md`, { headers: auth })).status, 404);
});

test("the remote client never doubles the slash of the server address", async () => {
  const { RemoteClient } = await import("../src/remote/client.js");
  for (const given of ["http://127.0.0.1:8766", "http://127.0.0.1:8766/", "http://127.0.0.1:8766//"]) {
    assert.equal(new RemoteClient(new URL(given), "t").href("/api/auth/me"), "http://127.0.0.1:8766/api/auth/me");
  }
});

test("a new account: its first password, then edu-ID with the two-step code, before anything else", { skip: NO_DB }, async () => {
  const ada = await newAccount(db!, "ada.nouvelle@heig-vd.ch");
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: ada.email, password: ada.password }) });
  assert.equal(login.status, 200);
  assert.equal(((await login.json()) as { setup: string }).setup, "terms");
  let cookie = login.headers.get("set-cookie")!.split(";")[0];
  const call = (method: string, path: string, body?: unknown) => fetch(`${origin}${path}`, { method, headers: { ...JSON_HEADERS, Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });

  // First the conditions of use: read, then accepted by the person, in the browser, for the version shown.
  assert.equal((await call("GET", "/api/calendar")).status, 403);
  assert.equal((await call("POST", "/api/auth/password", { password: "le choix de ada 2026" })).status, 403, "the conditions come before the password");
  const terms = (await (await call("GET", "/api/auth/terms")).json()) as { version: string; repository: string; markdown: string };
  assert.match(terms.markdown, /Argon2id/);
  assert.equal(terms.repository, "https://github.com/Cyprien-png/HEIG-Kit");
  assert.equal((await call("POST", "/api/auth/terms", { version: terms.version })).status, 400, "the box is not ticked");
  assert.equal((await call("POST", "/api/auth/terms", { accept: "true", version: terms.version })).status, 400);
  assert.equal((await call("POST", "/api/auth/terms", { accept: true, version: "1999-01-01" })).status, 409);
  const byAgent = await fetch(`${origin}/api/auth/terms`, { method: "POST", headers: { ...JSON_HEADERS, ...(await bearer(ada)) }, body: JSON.stringify({ accept: true, version: terms.version }) });
  assert.equal(byAgent.status, 403, "an agent never accepts for the person");
  const agreed = await call("POST", "/api/auth/terms", { accept: true, version: terms.version });
  assert.equal(agreed.status, 200);
  const account = (await agreed.json()) as { setup: string; terms: { accepted: boolean; acceptedAt?: string } };
  assert.equal(account.setup, "password");
  assert.equal(account.terms.accepted, true);
  assert.ok(account.terms.acceptedAt);

  // Nothing works before the first password is replaced, and the answer says what to do.
  for (const path of ["/api/calendar", "/api/corrections", "/api/library", "/api/profile"]) {
    const refused = await call("GET", path);
    assert.equal(refused.status, 403, path);
    assert.equal(((await refused.json()) as { setup: string }).setup, "password", path);
  }
  assert.equal((await call("POST", "/api/auth/campus", { email: "ada@edu", password: "x" })).status, 403, "edu-ID comes after the password");
  assert.equal((await call("POST", "/api/auth/password", { password: "court" })).status, 400);
  assert.equal((await call("POST", "/api/auth/password", { password: ada.password })).status, 400, "the same password again");
  const changed = await call("POST", "/api/auth/password", { password: "le choix de ada 2026" });
  assert.equal(changed.status, 200);
  assert.equal(((await changed.json()) as { setup: string }).setup, "access");
  const old = cookie;
  cookie = changed.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: old } })).status, 401, "the sessions opened with the first password are closed");
  assert.equal((await fetch(`${origin}/api/auth/login`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: ada.email, password: ada.password }) })).status, 401);

  // Then the kind of access, chosen by the person in the browser: without edu-ID the account is ready at once, and
  // everything that comes from GAPS and Cyberlearn, calendar included, is closed to it.
  assert.equal((await call("GET", "/api/corrections")).status, 403);
  assert.equal((await call("POST", "/api/auth/campus", { email: "ada@edu", password: "x" })).status, 403, "edu-ID comes after the choice");
  assert.equal((await call("POST", "/api/auth/access", { access: "tout" })).status, 400);
  const local = await call("POST", "/api/auth/access", { access: "local" });
  assert.deepEqual([local.status, ((await local.json()) as { setup: null; access: string }).access], [200, "local"]);
  assert.equal((await call("GET", "/api/corrections")).status, 200);
  assert.equal((await call("GET", "/api/decks")).status, 200);
  for (const path of ["/api/calendar", "/api/calendars", "/api/campus/grades", "/api/campus/schedule", "/api/me/sync"]) {
    const closed = await call("GET", path);
    assert.equal(closed.status, 403, path);
    assert.equal(((await closed.json()) as { access: string }).access, "local", path);
  }
  assert.equal((await call("POST", "/api/calendar/events", { title: "TE", start: "2026-12-01" })).status, 403);
  assert.equal((await call("POST", "/api/auth/campus", { email: "ada@edu", password: "x" })).status, 403, "no edu-ID login for an account without edu-ID");
  // Its agents get the same refusal from the tools, and cannot change the choice.
  const asAgent = { ...JSON_HEADERS, ...(await bearer(ada)) };
  assert.equal((await fetch(`${origin}/api/campus/grades`, { headers: asAgent })).status, 403);
  assert.equal((await fetch(`${origin}/api/auth/access`, { method: "POST", headers: asAgent, body: JSON.stringify({ access: "campus" }) })).status, 403);
  // She changes her mind: edu-ID is then asked before anything else.
  const withCampus = await call("POST", "/api/auth/access", { access: "campus" });
  assert.equal(((await withCampus.json()) as { setup: string }).setup, "campus");

  // Then edu-ID, until GAPS accepts a login.
  const blocked = await call("GET", "/api/calendar");
  assert.equal(blocked.status, 403);
  assert.equal(((await blocked.json()) as { setup: string }).setup, "campus");
  const needs = async (res: Response, status: number) => {
    assert.equal(res.status, status);
    return ((await res.json()) as { needs?: string }).needs;
  };
  assert.equal(await needs(await call("POST", "/api/auth/campus", {}), 409), "credentials");
  campus = async () => {
    throw new BadCredentialsError();
  };
  assert.equal(await needs(await call("POST", "/api/auth/campus", { email: "ada.nouvelle@heig-vd.ch", password: "faux" }), 401), "credentials");
  assert.equal((await getUser(db!, ada.user.id))!.hasCampusCredentials, false, "refused credentials are not kept");

  const seen: (string | undefined)[] = [];
  campus = async (code) => {
    seen.push(code);
    if (code !== "123456") throw new MfaRequiredError({} as never, code !== undefined);
  };
  assert.equal(await needs(await call("POST", "/api/auth/campus", { email: "ada.nouvelle@heig-vd.ch", password: "secret edu-ID" }), 409), "code");
  assert.equal((await getUser(db!, ada.user.id))!.hasCampusCredentials, false, "nothing is kept before GAPS accepted the login");
  assert.equal(await needs(await call("POST", "/api/auth/campus", { mfa_code: "000000" }), 409), "code");
  const connected = await call("POST", "/api/auth/campus", { mfa_code: "123 456" });
  assert.equal(connected.status, 200);
  const me = (await connected.json()) as { setup: null; campus: { state: string; stored: boolean } };
  assert.equal(me.setup, null);
  assert.deepEqual([me.campus.state, me.campus.stored], ["ok", true]);
  assert.deepEqual(seen, [undefined, "000000", "123456"]);
  assert.equal((await call("GET", "/api/corrections")).status, 200);

  // The credentials are sealed: only the key derived from the account's password opens them, and no route returns them.
  const key = app.vault.key(ada.user.id)!;
  assert.deepEqual(await readCampusCredentials(db!, ada.user.id, key), { email: "ada.nouvelle@heig-vd.ch", password: "secret edu-ID" });
  assert.equal(await readCampusCredentials(db!, ada.user.id, app.vault.key(lea.user.id) ?? Buffer.alloc(32)), undefined);
  assert.equal(JSON.stringify(await (await call("GET", "/api/auth/me")).json()).includes("secret"), false);
  assert.ok(userCacheDir(ada.user.id).startsWith(process.env.HEIG_TEST_CACHE!));

  // Later, when the server has forgotten the key: a token without it needs the account's own password for a new login…
  campus = async () => undefined;
  const bare = { ...JSON_HEADERS, ...(await bearer(ada)) };
  const bareCall = (body: unknown) => fetch(`${origin}/api/auth/campus`, { method: "POST", headers: bare, body: JSON.stringify(body) });
  app.vault.forget(ada.user.id);
  assert.equal(await needs(await bareCall({}), 409), "account_password");
  assert.equal(await needs(await bareCall({ account_password: "pas le bon" }), 409), "account_password");
  assert.equal((await bareCall({ account_password: "le choix de ada 2026" })).status, 200);
  // …while the session of the browser carries the key (wrapped for the server alone): nothing to type again.
  app.vault.forget(ada.user.id);
  assert.equal((await call("POST", "/api/auth/campus", {})).status, 200);

  // Changing the password later asks for the current one.
  assert.equal(await needs(await call("POST", "/api/auth/password", { password: "encore un autre choix" }), 409), "current");
  assert.equal((await call("POST", "/api/auth/password", { password: "encore un autre choix", current: "faux" })).status, 401);
  const again = await call("POST", "/api/auth/password", { password: "encore un autre choix", current: "le choix de ada 2026" });
  assert.equal(again.status, 200);
  assert.deepEqual(await readCampusCredentials(db!, ada.user.id, app.vault.key(ada.user.id)!), { email: "ada.nouvelle@heig-vd.ch", password: "secret edu-ID" }, "sealed again with the new password");

  // Going without edu-ID afterwards erases what the server kept of it; the account stays usable for the rest.
  cookie = again.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await call("POST", "/api/auth/access", { access: "local" })).status, 200);
  const after = (await getUser(db!, ada.user.id))!;
  assert.deepEqual([after.access, after.hasCampusCredentials, after.campusState, after.campusVerifiedAt], ["local", false, "missing", undefined]);
  assert.equal((await call("GET", "/api/campus/grades")).status, 403);
  assert.equal((await call("GET", "/api/decks")).status, 200);
});

test("what is personal is closed: another account's token gets a plain refusal", { skip: NO_DB }, async () => {
  const asLea = { ...(await bearer(lea)), "Content-Type": "application/json" };
  const asNoe = { ...(await bearer(noe)), "Content-Type": "application/json" };
  const created = await fetch(`${origin}/api/corrections`, { method: "POST", headers: asLea, body: JSON.stringify({ title: "Série 3", course: "MAD" }) });
  assert.equal(created.status, 200);
  const correction = (await created.json()) as { id: string; captureUrl: string };

  assert.equal((await fetch(`${origin}/api/corrections/${correction.id}`, { headers: asLea })).status, 200);
  const refused = await fetch(`${origin}/api/corrections/${correction.id}`, { headers: asNoe });
  assert.ok([403, 404].includes(refused.status), `another account reads it: ${refused.status}`);
  assert.equal((await fetch(`${origin}/api/corrections/${correction.id}`, { method: "DELETE", headers: asNoe })).status >= 400, true);
  assert.equal((await fetch(`${origin}/api/corrections/${correction.id}`, { headers: asLea })).status, 200, "still there");
  assert.deepEqual(((await (await fetch(`${origin}/api/corrections`, { headers: asNoe })).json()) as { corrections: unknown[] }).corrections, []);
  assert.equal(((await (await fetch(`${origin}/api/corrections`, { headers: asLea })).json()) as { corrections: unknown[] }).corrections.length, 1);

  // No parameter names an account: asking for another one changes nothing.
  for (const extra of ["?user=" + lea.user.id, "?user_id=" + lea.user.id]) {
    assert.deepEqual(((await (await fetch(`${origin}/api/corrections${extra}`, { headers: asNoe })).json()) as { corrections: unknown[] }).corrections, []);
  }
  const forged = await fetch(`${origin}/api/corrections`, { headers: { ...asNoe, "X-User-Id": String(lea.user.id), Cookie: `heig_session=${asLea.Authorization.slice(7)}` } });
  assert.deepEqual(((await forged.json()) as { corrections: unknown[] }).corrections, [], "the bearer token decides, nothing else");

  // The phone's link opens this correction of this account, and nothing else.
  const capture = { Authorization: `Bearer ${new URL(correction.captureUrl).hash.slice(3)}` };
  assert.equal((await fetch(`${origin}/api/corrections/${correction.id}`, { headers: capture })).status, 200);
  assert.equal((await fetch(`${origin}/api/corrections`, { headers: capture })).status, 403);
  const other = (await (await fetch(`${origin}/api/corrections`, { method: "POST", headers: asNoe, body: JSON.stringify({ title: "À Noé" }) })).json()) as { id: string };
  assert.equal((await fetch(`${origin}/api/corrections/${other.id}`, { headers: capture })).status, 403);
  // A link forged for a correction of another account: the token is valid, the row is not its owner's.
  const crossed = { Authorization: `Bearer ${await app.auth.issueCaptureToken(correction.id, noe.user.id)}` };
  assert.ok([403, 404].includes((await fetch(`${origin}/api/corrections/${correction.id}`, { headers: crossed })).status));
});

test("the status and the journal are for administrators; the journal says who asked what", { skip: NO_DB }, async () => {
  const asLea = await bearer(lea);
  const asNoe = await bearer(noe);
  assert.equal(lea.user.role, "admin", "the first account of a server is its administrator");
  for (const path of ["/api/status/requests", "/api/status/runs", "/api/status/jobs", "/api/admin/users", "/api/admin/activity", `/api/admin/activity?user=${lea.user.id}`]) {
    const refused = await fetch(`${origin}${path}`, { headers: asNoe });
    assert.equal(refused.status, 403, path);
    assert.match(((await refused.json()) as { error: string }).error, /administrators/);
    assert.equal((await fetch(`${origin}${path}`, { headers: asLea })).status, 200, path);
  }
  assert.equal((await fetch(`${origin}/api/status/sync`, { method: "POST", headers: asNoe, body: "{}" })).status, 403);

  // Indexing the courses into the shared knowledge base: an administrator starts it, it runs as them in the background.
  assert.equal((await fetch(`${origin}/api/status/ingest`, { method: "POST", headers: asNoe })).status, 403);
  assert.equal((await fetch(`${origin}/api/status/ingest`, { method: "POST", headers: asLea })).status, 202);
  const ingestRun = async () => (await db!.system.query<{ ok: boolean | null; message: string | null; user_id: string | null }>("SELECT ok, message, user_id FROM sync_runs WHERE kind = 'ingest' ORDER BY started_at DESC LIMIT 1")).rows[0];
  for (let i = 0; i < 300 && (await ingestRun())?.ok == null; i++) await new Promise((r) => setTimeout(r, 50));
  // No edu-ID to reach from the tests: the run ends with its reason, recorded for the status page.
  const ended = await ingestRun();
  assert.equal(ended.ok, false);
  assert.ok(ended.message);
  assert.equal(app.syncer.ingestBusy, false);
  const report = (await (await fetch(`${origin}/api/status`, { headers: asLea })).json()) as { ingestion: { running: boolean; last?: { kind: string; ok: boolean } } };
  assert.deepEqual([report.ingestion.running, report.ingestion.last?.kind, report.ingestion.last?.ok], [false, "ingest", false]);

  await fetch(`${origin}/api/corrections`, { method: "POST", headers: { ...asNoe, "Content-Type": "application/json" }, body: JSON.stringify({ title: "Journal" }) });
  type Entry = { method: string; path: string; status: number; userId?: number; note?: string };
  const journal = async (query: string) => ((await (await fetch(`${origin}/api/admin/activity${query}`, { headers: asLea })).json()) as { user?: { email: string }; entries: Entry[] });
  const ofNoe = await journal(`?user=${noe.user.id}`);
  assert.equal(ofNoe.user?.email, noe.email);
  assert.ok(ofNoe.entries.length > 0 && ofNoe.entries.every((e) => e.userId === noe.user.id));
  assert.ok(ofNoe.entries.some((e) => e.method === "POST" && e.path === "/api/corrections" && e.status === 200));
  assert.ok(ofNoe.entries.some((e) => e.status === 403 && e.note === "admin only"), "what was refused is kept too");
  const actions = await journal(`?user=${noe.user.id}&actions=1`);
  assert.ok(actions.entries.every((e) => e.method !== "GET" || e.status >= 400));
  assert.equal((await fetch(`${origin}/api/admin/activity?user=9999`, { headers: asLea })).status, 404);

  const { users } = (await (await fetch(`${origin}/api/admin/users`, { headers: asLea })).json()) as { users: { email: string; role: string; requestsWeek: number; refusedWeek: number }[] };
  const row = users.find((u) => u.email === noe.email)!;
  assert.equal(row.role, "student");
  assert.ok(row.requestsWeek > 0 && row.refusedWeek > 0);
  assert.equal(JSON.stringify(users).includes("hash"), false);

  // Each account refreshes its own data, without the status page.
  const mine = await fetch(`${origin}/api/me/sync`, { headers: asNoe });
  assert.equal(mine.status, 200);
  assert.equal(((await mine.json()) as { campus: { state: string } }).campus.state, "ok");
});

test("shared items over HTTP: the author's name, 403 for someone else's, 409 for a copy", { skip: NO_DB }, async () => {
  const asLea = { ...(await bearer(lea)), "Content-Type": "application/json" };
  const asNoe = { ...(await bearer(noe)), "Content-Type": "application/json" };
  const put = (headers: Record<string, string>, id: string, body: string) => fetch(`${origin}/api/library/files/${id}`, { method: "PUT", headers, body });

  assert.equal((await put(asLea, "documents/RXI-couche-transport.md", "# Couche transport")).status, 200);
  const taken = await put(asNoe, "documents/RXI-couche-transport.md", "# Écrasé");
  assert.equal(taken.status, 403);
  assert.match(((await taken.json()) as { error: string }).error, /created by Lea Premiere/);
  assert.equal(readFileSync(path.join(base, "out", "documents", "RXI-couche-transport.md"), "utf-8"), "# Couche transport");
  assert.equal((await put(asNoe, "documents/RXI-couche-transport.pdf", "pdf")).status, 403, "another file of the same item");
  assert.equal((await fetch(`${origin}/api/library/files/documents/RXI-couche-transport.md`, { method: "DELETE", headers: asNoe })).status, 403);
  assert.equal((await fetch(`${origin}/api/library/items/document/RXI-couche-transport`, { method: "PATCH", headers: asNoe, body: JSON.stringify({ tags: ["révision"] }) })).status, 403);
  // Reading is for everyone, with the author's name.
  assert.equal((await fetch(`${origin}/api/library/files/documents/RXI-couche-transport.md`, { headers: asNoe })).status, 200);
  const { items } = (await (await fetch(`${origin}/api/library`, { headers: asNoe })).json()) as { items: { name: string; author?: string; mine: boolean; editable: boolean }[] };
  const item = items.find((i) => i.name === "RXI-couche-transport")!;
  assert.deepEqual([item.author, item.mine, item.editable], ["Lea Premiere", false, false]);

  const deck = (body: unknown, headers = asNoe) => fetch(`${origin}/api/decks`, { method: "POST", headers, body: JSON.stringify(body) });
  const first = (await (await deck({ title: "Couche transport", course: "RXI", cards: [{ front: "TCP ?", back: "Fiable" }] }, asLea)).json()) as { id: number };
  const copy = await deck({ title: "La couche transport", course: "RXI" });
  assert.equal(copy.status, 409);
  const refusal = (await copy.json()) as { error: string; similar: { ref: string; author: string }[] };
  assert.deepEqual(refusal.similar.map((s) => [s.ref, s.author]), [[`deck ${first.id}`, "Lea Premiere"]]);
  assert.match(refusal.error, /new_because/);
  const own = await deck({ title: "La couche transport", course: "RXI", checked: [`deck ${first.id}`], new_because: "It has a single card and the user revises the whole chapter." });
  assert.equal(own.status, 200);
  // Deleting is reserved to administrators, even for one's own deck or document.
  const mine = (await own.json()) as { id: number; editable: boolean; deletable: boolean };
  assert.deepEqual([mine.editable, mine.deletable], [true, false]);
  const refused = await fetch(`${origin}/api/decks/${mine.id}`, { method: "DELETE", headers: asNoe });
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { error: string }).error, /only an administrator/);
  assert.equal((await put(asNoe, "documents/RXI-notes-de-noe.md", "# Notes")).status, 200);
  assert.equal((await fetch(`${origin}/api/library/files/documents/RXI-notes-de-noe.md`, { method: "DELETE", headers: asNoe })).status, 403);
  assert.equal(readFileSync(path.join(base, "out", "documents", "RXI-notes-de-noe.md"), "utf-8"), "# Notes");
  assert.equal((await fetch(`${origin}/api/library/files/documents/RXI-notes-de-noe.md`, { method: "DELETE", headers: asLea })).status, 204);
  assert.equal((await fetch(`${origin}/api/decks/${mine.id}`, { method: "DELETE", headers: asLea })).status, 204);
  assert.equal((await fetch(`${origin}/api/decks/${first.id}`, { method: "DELETE", headers: asNoe })).status, 403);
  assert.equal((await fetch(`${origin}/api/decks/${first.id}/cards`, { method: "POST", headers: asNoe, body: JSON.stringify({ cards: [{ front: "UDP ?", back: "Sans connexion" }] }) })).status, 403);

  // The past written tests and the course repositories are the administrators' alone.
  const exam = "MAD/2021-2022/TE1/enonce.md";
  const putExam = (headers: Record<string, string>, body: string) => fetch(`${origin}/api/past-exams/files/${exam}`, { method: "PUT", headers, body });
  assert.equal((await putExam(asNoe, "# Faux")).status, 403);
  assert.equal((await putExam(asLea, "# TE1 2022")).status, 200);
  assert.equal((await putExam(asNoe, "# Écrasé")).status, 403);
  assert.equal((await fetch(`${origin}/api/past-exams/files/${exam}`, { method: "DELETE", headers: asNoe })).status, 403);
  assert.equal(await (await fetch(`${origin}/api/past-exams/files/${exam}?download=1`, { headers: asNoe })).text(), "# TE1 2022", "everyone reads it");
  assert.equal((await fetch(`${origin}/api/past-exams/files/${exam}`, { method: "DELETE", headers: asLea })).status, 204);
  const repo = { url: "https://github.com/heig-vd/cours-exemple", course: "MAD" };
  assert.equal((await fetch(`${origin}/api/kb/repos`, { method: "POST", headers: asNoe, body: JSON.stringify(repo) })).status, 403);
  assert.equal((await fetch(`${origin}/api/kb/repos?url=${encodeURIComponent(repo.url)}`, { method: "DELETE", headers: asNoe })).status, 403);
  assert.equal((await fetch(`${origin}/api/kb/repos/update`, { method: "POST", headers: asNoe })).status, 403);
  assert.equal((await fetch(`${origin}/api/kb/repos`, { headers: asNoe })).status, 200);
  assert.equal((await fetch(`${origin}/api/kb/repos`, { method: "POST", headers: asLea, body: JSON.stringify(repo) })).status, 200);
  assert.equal((await fetch(`${origin}/api/kb/repos?url=${encodeURIComponent(repo.url)}`, { method: "DELETE", headers: asLea })).status, 200);
});
