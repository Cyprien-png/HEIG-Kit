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

const base = mkdtempSync(path.join(os.tmpdir(), "heig-api-"));
process.env.HEIG_OUTPUT_DIR = path.join(base, "out");
mkdirSync(path.join(base, "out", "documents"), { recursive: true });
mkdirSync(path.join(base, "out", "videos"), { recursive: true });
process.env.HEIG_WEB_DIR = path.join(base, "web");
mkdirSync(process.env.HEIG_WEB_DIR);
writeFileSync(path.join(process.env.HEIG_WEB_DIR, "index.html"), "<!doctype html><title>app</title>");

const ENV = { HEIG_AUTH_USERNAME: "me", HEIG_AUTH_PASSWORD: "correct-horse-battery", HEIG_JWT_SECRET: "x".repeat(40), HEIG_PUBLIC_URL: "http://127.0.0.1" };
const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as App["db"];
let server: Server;
let origin: string;

before(async () => {
  const config = loadServerConfig(ENV);
  const probe = createRemoteServer(createApp(config, fakeDb, undefined, new Auth(config)), async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  probe.close();
  origin = `http://127.0.0.1:${port}`;
  const app = createApp({ ...config, publicUrl: new URL(origin) }, fakeDb, undefined, new Auth(config));
  server = createRemoteServer(app, async () => new McpServer({ name: "t", version: "1" }));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(() => {
  server?.close();
  rmSync(base, { recursive: true, force: true });
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

test("the web session: cookie login, CSRF header, logout, and the app page", async () => {
  const headers = { "Content-Type": "application/json" };
  assert.equal((await fetch(`${origin}/api/auth/me`)).status, 401);
  const bad = await fetch(`${origin}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ username: "me", password: "nope" }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${origin}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ username: "me", password: ENV.HEIG_AUTH_PASSWORD }) });
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

  const out = await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Cookie: session, "X-Requested-With": "heig-kit" } });
  assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);

  // Any other path is the web application, with its security headers.
  const page = await fetch(`${origin}/calendar`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>app<\/title>/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
});

test("library files: bearer upload with kept modification time, range streaming, inline and download", async () => {
  const login = await fetch(`${origin}/auth/login`, { method: "POST", body: JSON.stringify({ username: "me", password: ENV.HEIG_AUTH_PASSWORD }) });
  const { access_token: token } = (await login.json()) as { access_token: string };
  const auth = { Authorization: `Bearer ${token}` };
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
