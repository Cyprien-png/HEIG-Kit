import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import type { CookieJar } from "tough-cookie";
import { Session } from "../src/http.js";
import { readSecretFile, setSecretFileKey, writeSecretFile } from "../src/secretfile.js";
import { Auth } from "../src/server/auth.js";

const dir = process.env.HEIG_TEST_CACHE!;
/** The cookies of a session (kept private by the class). */
const jarOf = (session: Session) => (session as unknown as { jar: CookieJar }).jar;
after(() => setSecretFileKey(undefined));

test("a personal installation keeps its session files plain, readable by their owner only", async () => {
  setSecretFileKey(undefined);
  const file = path.join(dir, "plain", "cyberlearn-token.json");
  await writeSecretFile(file, '{"token":"abc123"}');
  assert.equal(readFileSync(file, "utf-8"), '{"token":"abc123"}');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(await readSecretFile(file), '{"token":"abc123"}');
});

test("a shared server encrypts them: the disk holds nothing readable without its key", async () => {
  const key = randomBytes(32);
  setSecretFileKey(key);
  const file = path.join(dir, "users", "7", "cyberlearn-token.json");
  await writeSecretFile(file, '{"token":"moodle-secret-token"}');
  const stored = readFileSync(file);
  assert.equal(stored.includes("moodle-secret-token"), false);
  assert.equal(stored.includes("token"), false);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(await readSecretFile(file), '{"token":"moodle-secret-token"}');

  // Two writes of the same text never look alike, and an altered file is refused.
  await writeSecretFile(file, '{"token":"moodle-secret-token"}');
  assert.notDeepEqual(readFileSync(file), stored);
  const altered = Buffer.from(readFileSync(file));
  altered[altered.length - 1] ^= 1;
  writeFileSync(file, altered);
  await assert.rejects(readSecretFile(file), /another key/);

  // Another key (the server's secret changed, or a copy read elsewhere) opens nothing; no key neither.
  await writeSecretFile(file, '{"token":"moodle-secret-token"}');
  setSecretFileKey(randomBytes(32));
  await assert.rejects(readSecretFile(file), /another key/);
  setSecretFileKey(undefined);
  await assert.rejects(readSecretFile(file), /another key/);
  await assert.rejects(readSecretFile(path.join(dir, "users", "7", "missing.json")));
  assert.throws(() => setSecretFileKey(randomBytes(16)));
});

test("files written before the encryption are read once, and encrypted on the spot", async () => {
  const file = path.join(dir, "users", "8", "session.json");
  setSecretFileKey(undefined);
  await writeSecretFile(file, '{"cookies":[{"key":"SESSION","value":"edu-id-cookie"}]}');
  setSecretFileKey(randomBytes(32));
  assert.match(await readSecretFile(file), /edu-id-cookie/);
  assert.equal(readFileSync(file).includes("edu-id-cookie"), false);
  assert.match(await readSecretFile(file), /edu-id-cookie/);
});

test("the cookies of a session go through it, with the key the server derives from its secret", async () => {
  const config = { jwtSecret: "0123456789abcdef".repeat(3), tokenVersion: "1", tokenDays: 90, linkMinutes: 15 };
  setSecretFileKey(new Auth(config).secretFileKey);
  const cookieFile = path.join(dir, "users", "9", "session.json");
  const session = await Session.open({ cookieFile });
  await jarOf(session).setCookie("shib=very-secret-cookie; Path=/; Secure", "https://login.eduid.ch/");
  await session.save();
  assert.equal(readFileSync(cookieFile).includes("very-secret-cookie"), false);
  const again = await Session.open({ cookieFile });
  assert.match(await jarOf(again).getCookieString("https://login.eduid.ch/"), /very-secret-cookie/);
  // The same secret gives the same key after a restart; another secret starts from an empty session, without failing.
  assert.deepEqual(new Auth(config).secretFileKey, new Auth(config).secretFileKey);
  setSecretFileKey(new Auth({ ...config, jwtSecret: "fedcba9876543210".repeat(3) }).secretFileKey);
  assert.equal(await jarOf(await Session.open({ cookieFile })).getCookieString("https://login.eduid.ch/"), "");
});
