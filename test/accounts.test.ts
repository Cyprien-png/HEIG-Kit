import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { type Kdf, GENERATED_PASSWORD_LENGTH, generatePassword, hashPassword, passwordProblem, seal, unseal, verifyPassword } from "../src/accounts/password.js";
import { REPOSITORY_URL, TERMS_MARKDOWN, TERMS_VERSION } from "../src/accounts/terms.js";
import { acceptTerms, authenticate, changePassword, createUser, deleteUser, findUser, listUsers, nameFromEmail, readCampusCredentials, resetPassword, saveCampusCredentials, setupStep, updateUser } from "../src/accounts/users.js";
import { listCalendars } from "../src/app/calendar.js";
import { listCorrections } from "../src/app/corrections.js";
import { runAs } from "../src/identity.js";
import type { Db } from "../src/rag/db.js";
import { testDb } from "./helpers/db.js";

/** Light settings: the tests check the logic, not the cost. */
const FAST: Kdf = { m: 256, t: 1, p: 1 };

let db: Db | undefined;
before(async () => {
  db = await testDb("heigkit_test_accounts");
});
after(async () => {
  await db?.end();
});

test("a password is verified without being stored, and gives the key of the vault", async () => {
  const { hash, vaultKey } = await hashPassword("correct horse battery", FAST);
  assert.match(hash, /^argon2id\$m=256,t=1,p=1\$/);
  assert.equal(hash.includes("correct"), false);
  assert.deepEqual(await verifyPassword("correct horse battery", hash), vaultKey);
  assert.equal(await verifyPassword("correct horse batterx", hash), undefined);
  assert.equal(await verifyPassword("anything", null), undefined);
  // Same password, another salt: another hash and another key.
  const again = await hashPassword("correct horse battery", FAST);
  assert.notEqual(again.hash, hash);
  assert.notDeepEqual(again.vaultKey, vaultKey);
});

test("what a key sealed only that key opens", async () => {
  const { vaultKey } = await hashPassword("premier mot de passe", FAST);
  const other = (await hashPassword("second mot de passe", FAST)).vaultKey;
  const sealed = seal(vaultKey, "secret edu-ID");
  assert.equal(sealed.toString("latin1").includes("secret"), false);
  assert.equal(unseal(vaultKey, sealed), "secret edu-ID");
  assert.equal(unseal(other, sealed), undefined);
  sealed[14] ^= 1;
  assert.equal(unseal(vaultKey, sealed), undefined);
});

test("generated passwords have 18 characters of every kind; chosen ones are checked", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const password = generatePassword();
    assert.equal(password.length, GENERATED_PASSWORD_LENGTH);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[2-9]/);
    assert.match(password, /[-_!?+=]/);
    assert.doesNotMatch(password, /[0O1lI]/);
    seen.add(password);
  }
  assert.equal(seen.size, 50);
  assert.match(passwordProblem("trop court")!, /12/);
  assert.ok(passwordProblem("aaaaaaaaaaaaaaaa"));
  assert.ok(passwordProblem("jean.dupont-2026", { email: "jean.dupont@heig-vd.ch" }));
  assert.equal(passwordProblem("un bon mot de passe"), undefined);
});

test("names come from prenom.nom addresses", () => {
  assert.deepEqual(nameFromEmail("cyprien.exemple@heig-vd.ch"), { firstName: "Cyprien", lastName: "Exemple" });
  assert.deepEqual(nameFromEmail("jean-pierre.de-la-tour@heig-vd.ch"), { firstName: "Jean-Pierre", lastName: "De-La-Tour" });
  assert.deepEqual(nameFromEmail("anna.maria.rossi1@heig-vd.ch"), { firstName: "Anna", lastName: "Maria Rossi" });
  assert.deepEqual(nameFromEmail("admin@example.org"), { firstName: "Admin", lastName: "" });
});

test("accounts: the first one takes over the installation, then creation, login, roles, reset, deletion", async (t) => {
  if (!db) return t.skip("no local database");
  assert.deepEqual(await listUsers(db), []);
  const first = await createUser(db, { email: "Lea.Owner@heig-vd.ch" }, FAST);
  assert.equal(first.tookOver, true);
  assert.equal(first.user.id, 1);
  assert.equal(first.user.role, "admin");
  assert.equal(first.user.email, "lea.owner@heig-vd.ch");
  assert.equal(first.user.name, "Lea Owner");
  assert.equal(first.password.length, 18);
  // The conditions of use come first: the version shown, nothing else.
  assert.equal(setupStep(first.user), "terms");
  await assert.rejects(acceptTerms(db, first.user.id, "1999-01-01"), /relisez/);
  const agreed = await acceptTerms(db, first.user.id, TERMS_VERSION);
  assert.ok(agreed.termsAcceptedAt);
  assert.equal(setupStep(agreed), "password");
  // A new version of the text asks again.
  assert.equal(setupStep({ ...agreed, termsVersion: "1999-01-01" }), "terms");
  for (const needle of [REPOSITORY_URL, "Argon2id", "RFC 9106", "HKDF-SHA-256", "AES-256-GCM", "injection de prompt", "aucunement responsables", "open source"]) assert.ok(TERMS_MARKDOWN.includes(needle), needle);

  const second = await createUser(db, { email: "noe.second@heig-vd.ch", lastName: "Seconde" }, FAST);
  assert.equal(second.tookOver, false);
  assert.equal(second.user.role, "student");
  assert.equal(second.user.name, "Noe Seconde");
  await assert.rejects(createUser(db, { email: "NOE.second@heig-vd.ch" }, FAST), /already exists/);
  await assert.rejects(createUser(db, { email: "pas une adresse" }, FAST), /not an e-mail/);
  // A new account has its own built-in calendars and nothing else.
  assert.equal((await runAs({ id: second.user.id, role: "student" }, () => listCalendars(db!))).length, 3);

  assert.equal(await authenticate(db, "noe.second@heig-vd.ch", "faux"), undefined);
  assert.equal(await authenticate(db, "personne@heig-vd.ch", second.password), undefined);
  const login = await authenticate(db, "Noe.Second@heig-vd.ch", second.password);
  assert.equal(login?.user.id, second.user.id);

  // The first password must be replaced, by a different and acceptable one.
  await assert.rejects(changePassword(db, login!.user, "court", login!.vaultKey, FAST), /12/);
  await assert.rejects(changePassword(db, login!.user, second.password, login!.vaultKey, FAST), /différent/);
  await acceptTerms(db, second.user.id, TERMS_VERSION);
  const changed = await changePassword(db, login!.user, "mon nouveau secret", login!.vaultKey, FAST);
  assert.equal(setupStep(changed.user), "campus");
  assert.equal(changed.user.tokenVersion, login!.user.tokenVersion + 1);
  assert.equal(await authenticate(db, "noe.second@heig-vd.ch", second.password), undefined);

  // The edu-ID credentials are sealed with the account's password and follow a password change.
  await saveCampusCredentials(db, second.user.id, changed.vaultKey, { email: "noe.second@heig-vd.ch", password: "edu-ID secret" });
  const stored = (await db.system.query("SELECT campus_sealed FROM users WHERE id = $1", [second.user.id])).rows[0].campus_sealed as Buffer;
  assert.equal(stored.toString("latin1").includes("edu-ID"), false);
  assert.equal(setupStep((await findUser(db, "noe.second@heig-vd.ch"))), undefined);
  assert.deepEqual(await readCampusCredentials(db, second.user.id, changed.vaultKey), { email: "noe.second@heig-vd.ch", password: "edu-ID secret" });
  assert.equal(await readCampusCredentials(db, second.user.id, first.user.id === 1 ? (await hashPassword("autre", FAST)).vaultKey : changed.vaultKey), undefined);
  const again = await changePassword(db, changed.user, "encore un autre secret", changed.vaultKey, FAST);
  assert.deepEqual(await readCampusCredentials(db, second.user.id, again.vaultKey), { email: "noe.second@heig-vd.ch", password: "edu-ID secret" });
  assert.equal(await readCampusCredentials(db, second.user.id, changed.vaultKey), undefined);

  // A reset by the administrator: new random password, and the sealed credentials are gone with the old one.
  const reset = await resetPassword(db, second.user.id, FAST);
  assert.equal(reset.user.mustChangePassword, true);
  assert.equal(reset.user.hasCampusCredentials, false);
  assert.ok(await authenticate(db, "noe.second@heig-vd.ch", reset.password));
  assert.equal(await authenticate(db, "noe.second@heig-vd.ch", "encore un autre secret"), undefined);

  // Roles: a server keeps an administrator.
  await assert.rejects(updateUser(db, 1, { role: "student" }), /only administrator/);
  await assert.rejects(updateUser(db, 1, { disabled: true }), /only administrator/);
  await assert.rejects(updateUser(db, second.user.id, { role: "chef" }), /role must be/);
  const promoted = await updateUser(db, second.user.id, { role: "admin", firstName: "Noé" });
  assert.equal(promoted.role, "admin");
  assert.equal(promoted.name, "Noé Seconde");
  assert.equal(promoted.tokenVersion, reset.user.tokenVersion + 1);
  assert.equal((await updateUser(db, 1, { role: "student" })).role, "student");
  const disabled = await updateUser(db, 1, { disabled: true });
  assert.ok(disabled.disabledAt);
  assert.equal(await authenticate(db, "lea.owner@heig-vd.ch", first.password), undefined);

  // Deleting an account deletes what was personal to it.
  const third = await createUser(db, { email: "tim.third@heig-vd.ch" }, FAST);
  await runAs({ id: third.user.id, role: "student" }, () => db!.query("INSERT INTO corrections (id, title) VALUES (gen_random_uuid(), 'à moi')"));
  await deleteUser(db, third.user.id);
  assert.equal((await db.system.query("SELECT count(*) AS n FROM corrections")).rows[0].n, "0");
  await assert.rejects(deleteUser(db, 1), /first account/);
  assert.deepEqual((await listUsers(db)).map((u) => u.id), [1, second.user.id]);
  assert.deepEqual(await runAs({ id: second.user.id, role: "admin" }, () => listCorrections(db!)), []);
});
