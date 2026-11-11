/**
 * Whose edu-ID account a GAPS or Cyberlearn login uses, and where its session is kept. On a single-user installation:
 * the credentials of `.env` and the `.cache` folder. On a shared server: the account of the current request
 * (src/identity.ts), its own folder, and its credentials only while it has just typed its password
 * (src/accounts/vault.ts). There is no way to ask for the access of another account.
 */
import path from "node:path";
import { loadConfig } from "./config.js";
import { type Identity, requireIdentity } from "./identity.js";
import { CACHE_DIR } from "./paths.js";

export interface CampusAccess {
  /** Folder of the session cookies, the Cyberlearn token, an interrupted two-step login and the timetable cache. */
  dir: string;
  /** The edu-ID credentials; throws `CampusLocked` when they cannot be read right now. */
  credentials(): { email: string; password: string };
  gapsStudentId?: string;
}

/** The edu-ID session ended and the credentials are sealed: the person must come back and unlock them. */
export class CampusLocked extends Error {
  constructor(message = "The edu-ID session of this account has ended. Open the HEIG-Kit web application and reconnect edu-ID (your password, then the two-step code if edu-ID asks for one).") {
    super(message);
  }
}

const local: CampusAccess = {
  dir: CACHE_DIR,
  credentials: () => loadConfig(),
  get gapsStudentId() {
    return process.env.GAPS_STUDENT_ID?.trim() || undefined;
  },
};

let provider: ((identity: Identity) => CampusAccess) | undefined;

/** The remote server gives each account its own access; from then on the `.env` credentials are never used by it. */
export function setCampusProvider(give: ((identity: Identity) => CampusAccess) | undefined): void {
  provider = give;
}

export function campusAccess(): CampusAccess {
  return provider ? provider(requireIdentity()) : local;
}

export interface CampusFiles {
  /** The timetable, kept 12 hours. */
  schedule: string;
  /** Cookies of the edu-ID session. */
  session: string;
  /** edu-ID two-step login page of a login waiting for a code. */
  pendingMfa: string;
  /** Cyberlearn mobile app token, valid until revoked: grants access to the account like a password. */
  cyberlearnToken: string;
  debug: string;
}

export function campusFiles(access: CampusAccess = campusAccess()): CampusFiles {
  const file = (name: string) => path.join(access.dir, name);
  return { schedule: file("schedule.json"), session: file("session.json"), pendingMfa: file("mfa-pending.json"), cyberlearnToken: file("cyberlearn-token.json"), debug: file("debug") };
}
