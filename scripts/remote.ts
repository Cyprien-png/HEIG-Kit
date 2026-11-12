/**
 * Connects this installation to a remote HEIG-Kit server (docs/server.md): the knowledge base, calendar, flashcards,
 * corrections and the library then live there. The address is HEIG_REMOTE_URL in .env.
 *
 *   npm run remote -- login            opens the server's login page (OAuth 2.1, PKCE) and keeps the tokens
 *                                      (.cache/remote-token.json); the password is typed on the server's page only
 *   npm run remote -- status           whether the server answers with the saved token
 *   npm run remote -- ingest           asks the server to index your Cyberlearn courses into its shared knowledge base
 *                                      (administrators; with your own edu-ID connection, in the background)
 *   npm run remote -- logout           forgets the token
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { REMOTE_TOKEN_FILE, RemoteClient, remoteLogin, remoteUrl } from "../src/remote/client.js";

/** Shows the login page in the person's browser; the address is printed too, for a machine without one. */
function openBrowser(loginUrl: string): void {
  console.error(`Log in with your HEIG-Kit account in the browser. If it does not open, go to:\n\n  ${loginUrl}\n`);
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  spawn(command, [loginUrl], { stdio: "ignore", detached: true })
    .on("error", () => undefined)
    .unref();
}

async function main(): Promise<void> {
  const [action = "status"] = process.argv.slice(2);
  const url = remoteUrl();
  if (!url) throw new Error("Set HEIG_REMOTE_URL in .env (the public address of your server), then run this again");

  if (action === "login") {
    await remoteLogin(url, openBrowser);
    const me = await (await RemoteClient.fromEnv())!.get<{ name: string; email: string }>("/api/auth/me");
    console.log(`Logged in to ${url.origin} as ${me.name} (${me.email}); tokens kept in ${REMOTE_TOKEN_FILE} and renewed on their own.`);
    return;
  }
  if (action === "logout") {
    await rm(REMOTE_TOKEN_FILE, { force: true });
    console.log("Token removed.");
    return;
  }
  if (action === "ingest") {
    await (await RemoteClient.fromEnv())!.request("POST", "/api/status/ingest");
    console.log(`Indexation started on ${url.origin}: follow it on the status page of the web application.`);
    return;
  }
  if (action !== "status") throw new Error("Usage: npm run remote -- login | status | ingest | logout");

  const me = await (await RemoteClient.fromEnv())!.get<{ name: string; email: string; role: string }>("/api/auth/me");
  console.log(`${url.origin}: connected as ${me.name} (${me.email}, ${me.role})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
