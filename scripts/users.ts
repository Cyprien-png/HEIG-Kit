/**
 * The accounts of a shared server (docs/accounts.md), managed from the server itself: nobody creates an account over
 * the network.
 *
 *   npm run users -- add prenom.nom@heig-vd.ch [--role admin] [--first-name …] [--last-name …]
 *                                      creates the account and prints its first password (18 random characters), once
 *   npm run users -- list              accounts, roles, state of their password and of their edu-ID connection
 *   npm run users -- set <account> [--email …] [--first-name …] [--last-name …] [--role admin|student]
 *   npm run users -- role <account> admin|student
 *   npm run users -- reset <account>   a new random password, to replace at the next login
 *   npm run users -- disable <account> | enable <account>
 *   npm run users -- delete <account> --yes     the account and everything personal it owns
 *
 * <account> is an address or the number shown by `list`.
 */
import { parseArgs } from "node:util";
import { ROLES, type User, createUser, deleteUser, findUser, listUsers, resetPassword, setupStep, updateUser } from "../src/accounts/users.js";
import { migrate, openDb } from "../src/rag/db.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    role: { type: "string" },
    email: { type: "string" },
    "first-name": { type: "string" },
    "last-name": { type: "string" },
    yes: { type: "boolean", default: false },
  },
});
const [action = "list", ref, extra] = positionals;
const USAGE = "Usage: npm run users -- add <email> | list | set <account> … | role <account> admin|student | reset <account> | disable <account> | enable <account> | delete <account> --yes";

const address = () => (process.env.HEIG_PUBLIC_URL?.trim() ? `Address: ${process.env.HEIG_PUBLIC_URL.trim()}` : "Address: the HEIG_PUBLIC_URL of the server");

function state(user: User): string {
  if (user.disabledAt) return "disabled";
  const step = setupStep(user);
  if (step === "terms") return "conditions of use not accepted yet";
  if (step === "password") return "first password not replaced yet";
  if (step === "access") return "access not chosen yet";
  if (user.access === "local") return "ready, without edu-ID";
  if (step === "campus") return "edu-ID not connected yet";
  return user.campusState === "expired" ? "edu-ID session ended" : "ready";
}

const line = (user: User) => `${String(user.id).padStart(3)}  ${user.role.padEnd(7)} ${user.email.padEnd(38)} ${user.name}  (${state(user)})`;

function firstPassword(user: User, password: string): void {
  console.log(`\n  Account : ${user.email}\n  Password: ${password}\n  ${address()}\n`);
  console.log("Shown once: give it to the person through a private channel. At their first login they must read and accept the");
  console.log("conditions of use, replace this password, then choose whether the account works with their edu-ID account or without it.");
}

const db = openDb();
try {
  await migrate(db).catch((error: unknown) => {
    throw new Error(`Database unreachable: is it started (npm run rag:start)? (${error instanceof Error ? error.message : error})`);
  });
  switch (action) {
    case "list": {
      const users = await listUsers(db);
      console.log(users.length ? users.map(line).join("\n") : "No account yet: npm run users -- add prenom.nom@heig-vd.ch (the first one is an administrator)");
      break;
    }
    case "add": {
      if (!ref) throw new Error(USAGE);
      const created = await createUser(db, { email: ref, role: values.role, firstName: values["first-name"], lastName: values["last-name"] });
      console.log(`${created.user.role === "admin" ? "Administrator" : "Account"} created: ${created.user.name} (${created.user.role}).`);
      if (created.tookOver) console.log("First account of this server: it takes over the data that was already here (calendar, cards, corrections, profile).");
      firstPassword(created.user, created.password);
      break;
    }
    case "set":
    case "role": {
      if (!ref || (action === "role" && !extra)) throw new Error(USAGE);
      const user = await findUser(db, ref);
      const patch = action === "role" ? { role: extra } : { email: values.email, firstName: values["first-name"], lastName: values["last-name"], role: values.role };
      if (action === "set" && Object.values(patch).every((v) => v === undefined)) throw new Error(`Nothing to change: --email, --first-name, --last-name, --role (${ROLES.join(", ")})`);
      console.log(line(await updateUser(db, user.id, patch)));
      break;
    }
    case "reset": {
      if (!ref) throw new Error(USAGE);
      const { user, password } = await resetPassword(db, (await findUser(db, ref)).id);
      console.log("New password. The tokens of this account are revoked and its edu-ID connection erased: it stays closed until edu-ID is connected again.");
      firstPassword(user, password);
      break;
    }
    case "disable":
    case "enable": {
      if (!ref) throw new Error(USAGE);
      console.log(line(await updateUser(db, (await findUser(db, ref)).id, { disabled: action === "disable" })));
      break;
    }
    case "delete": {
      if (!ref) throw new Error(USAGE);
      const user = await findUser(db, ref);
      if (!values.yes) throw new Error(`This deletes ${user.email} with its calendar, cards progress, corrections, work copies and profile. What it shared stays. Add --yes to confirm.`);
      await deleteUser(db, user.id);
      console.log(`${user.email} deleted.`);
      break;
    }
    default:
      throw new Error(USAGE);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end();
}
