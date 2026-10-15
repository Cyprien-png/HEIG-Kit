import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ROOT } from "../../paths.js";
import { type Module, runScript } from "../module.js";
import { ask } from "../prompt.js";

const ENV = path.join(ROOT, ".env");

const CREDENTIALS_NOTICE = `
HEIG-Kit signs in to GAPS and Cyberlearn with your SWITCH edu-ID, like you do in a browser:
  - your email and password are stored in .env in this folder only (readable by you only, never committed);
  - they are sent to SWITCH edu-ID only, when a session must be opened;
  - the session cookies and the Cyberlearn access token are kept in .cache/ so that you rarely log in again;
  - with two-step login enabled, you will be asked for the code of your authenticator app when needed.
`;

function readEnv(): Record<string, string> {
  return existsSync(ENV) ? dotenv.parse(readFileSync(ENV)) : {};
}

/** Sets values in .env, keeping its other lines (comments, other settings). */
function writeEnv(values: Record<string, string>): void {
  const lines = existsSync(ENV) ? readFileSync(ENV, "utf-8").split("\n") : readFileSync(path.join(ROOT, ".env.example"), "utf-8").split("\n");
  for (const [key, value] of Object.entries(values)) {
    // Single quotes keep $, # and spaces literal; double quotes when the value itself contains a single quote.
    const quoted = value.includes("'") ? `"${value.replace(/(["\\])/g, "\\$1")}"` : `'${value}'`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${quoted}`;
    else lines.push(`${key}=${quoted}`);
  }
  writeFileSync(ENV, lines.join("\n"), { mode: 0o600 });
  chmodSync(ENV, 0o600);
}

export const campus: Module = {
  id: "campus",
  title: "GAPS and Cyberlearn",
  summary: "timetable, deadlines, course contents and homework (skills heig:planning, heig:deadlines, heig:courses)",
  async install(options) {
    const env = readEnv();
    if (!env.HEIG_EMAIL || !env.HEIG_PASSWORD || env.HEIG_PASSWORD === "change-me") {
      if (!options.interactive) throw new Error("Set HEIG_EMAIL and HEIG_PASSWORD in .env (see .env.example), then run the setup again");
      console.log(CREDENTIALS_NOTICE);
      const email = await ask("SWITCH edu-ID email: ");
      const password = await ask("SWITCH edu-ID password: ", true);
      if (!email || !password) throw new Error("Email and password are required");
      writeEnv({ HEIG_EMAIL: email, HEIG_PASSWORD: password });
      console.log("  credentials saved in .env");
    }
    console.log("  checking the login by downloading your timetable…");
    runScript("src/cli.ts", "schedule", "--refresh", "--table");
  },
  async check() {
    const env = readEnv();
    return [
      {
        label: "edu-ID credentials in .env",
        ok: Boolean(env.HEIG_EMAIL && env.HEIG_PASSWORD && env.HEIG_PASSWORD !== "change-me"),
        hint: "npm run setup -- campus",
      },
      { label: "timetable downloaded", ok: existsSync(path.join(ROOT, ".cache", "schedule.json")), hint: "npm run schedule" },
    ];
  },
};
