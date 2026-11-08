/**
 * Connects this installation to a remote HEIG-Kit server (docs/server.md): the knowledge base, calendar, flashcards,
 * corrections and the library then live there. The address is HEIG_REMOTE_URL in .env.
 *
 *   npm run remote -- login            asks the account of the server and keeps the token (.cache/remote-token.json)
 *   npm run remote -- status           whether the server answers with the saved token
 *   npm run remote -- logout           forgets the token
 */
import { rm } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { REMOTE_TOKEN_FILE, RemoteClient, readRemoteToken, remoteLogin, remoteUrl } from "../src/remote/client.js";

async function ask(question: string, secret = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  if (secret) {
    // Keep the password off the terminal.
    const output = process.stderr;
    const original = output.write.bind(output);
    process.stderr.write(question);
    output.write = ((chunk: string | Uint8Array) => (typeof chunk === "string" && chunk !== "\n" && chunk !== "\r\n" ? true : original(chunk))) as typeof output.write;
    try {
      return (await rl.question("")).trim();
    } finally {
      output.write = original;
      process.stderr.write("\n");
      rl.close();
    }
  }
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const [action = "status"] = process.argv.slice(2);
  const url = remoteUrl();
  if (!url) throw new Error("Set HEIG_REMOTE_URL in .env (the public address of your server), then run this again");

  if (action === "login") {
    const username = process.env.HEIG_REMOTE_USERNAME?.trim() || (await ask(`Account of ${url.origin} (HEIG_AUTH_USERNAME on the server): `));
    const password = process.env.HEIG_REMOTE_PASSWORD?.trim() || (await ask("Password: ", true));
    const saved = await remoteLogin(url, username, password);
    console.log(`Logged in to ${url.origin}; token valid until ${new Date(saved.expiresAt).toLocaleDateString("fr-CH")}, kept in ${REMOTE_TOKEN_FILE}`);
    return;
  }
  if (action === "logout") {
    await rm(REMOTE_TOKEN_FILE, { force: true });
    console.log("Token removed.");
    return;
  }
  if (action !== "status") throw new Error("Usage: npm run remote -- login | status | logout");

  const saved = await readRemoteToken();
  if (!saved || saved.url !== url.href) throw new Error(`Not logged in to ${url.origin}: npm run remote -- login`);
  const client = new RemoteClient(url, saved.token);
  const me = await client.get<{ username: string }>("/api/auth/me");
  console.log(`${url.origin}: connected as ${me.username}, token valid until ${new Date(saved.expiresAt).toLocaleDateString("fr-CH")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
