import { readRemoteToken, remoteUrl } from "../../remote/client.js";
import { type Module, runScript } from "../module.js";

/** Connects this computer to a remote HEIG-Kit server: its knowledge base, calendar, flashcards, corrections, library. */
export const remote: Module = {
  id: "remote",
  title: "Remote server connection",
  summary: "use your HEIG-Kit server from this computer: HEIG_REMOTE_URL in .env, then a login (docs/app.md)",
  async install(options) {
    if (!remoteUrl()) throw new Error("Set HEIG_REMOTE_URL in .env (the public address of your server, e.g. https://heig.example.org), then run the setup again");
    if (!options.interactive) {
      throw new Error("Run `npm run remote -- login` in a terminal to log in to the server");
    }
    runScript("scripts/remote.ts", "login");
  },
  async check() {
    const url = remoteUrl();
    if (!url) return [{ label: "HEIG_REMOTE_URL set in .env", ok: false, hint: "optional: only to use a remote server from this computer" }];
    const saved = await readRemoteToken();
    const valid = Boolean(saved && saved.url === url.href && Date.parse(saved.expiresAt) > Date.now());
    return [{ label: `logged in to ${url.origin}`, ok: valid, hint: "npm run remote -- login" }];
  },
};
