import { CampusConnector } from "../accounts/connect.js";
import { identityOf, listUsers, markCampus, setupStep, userCacheDir } from "../accounts/users.js";
import { Vault } from "../accounts/vault.js";
import { type CourseRepos, LocalRepos, describeGithubRun } from "../app/repos.js";
import { RequestLog } from "../app/requests.js";
import { type SyncAccounts, Syncer } from "../app/sync.js";
import { CampusLocked, setCampusProvider } from "../campus.js";
import { requireExplicitIdentity } from "../identity.js";
import type { Db } from "../rag/db.js";
import { Auth, LoginLimiter } from "./auth.js";
import type { ServerConfig } from "./config.js";
import type { JobQueue } from "./jobs.js";

/** Everything the API routes, the MCP tools and the background jobs of the remote server share. */
export interface App {
  config: ServerConfig;
  auth: Auth;
  db: Db;
  queue?: JobQueue;
  limiter: LoginLimiter;
  requests: RequestLog;
  syncer: Syncer;
  /** The GitHub repositories the server indexes itself (sync run `github`). */
  repos: CourseRepos;
  /** Keys and edu-ID credentials of the accounts that just logged in, in memory for a short while. */
  vault: Vault;
  connector: CampusConnector;
}

export interface AppOptions {
  auth?: Auth;
  /** Replaces the real login on GAPS (tests). */
  campusLogin?: (mfaCode?: string) => Promise<unknown>;
}

/**
 * From here on the process is a shared server: nothing runs as the local owner any more, every piece of work has the
 * account of its request (src/identity.ts), and campus logins use that account's own session and credentials.
 */
export function createApp(config: ServerConfig, db: Db, queue?: JobQueue, options: AppOptions = {}): App {
  requireExplicitIdentity();
  const vault = new Vault();
  setInterval(() => vault.sweep(), 60_000).unref();
  setCampusProvider((identity) => ({
    dir: userCacheDir(identity.id),
    credentials: () => {
      const held = vault.credentials(identity.id);
      if (!held) throw new CampusLocked();
      return held;
    },
  }));
  const accounts: SyncAccounts = {
    // Accounts that never connected, or whose session is known to have ended, wait for their owner.
    list: async () => (await listUsers(db)).filter((u) => !u.disabledAt && !setupStep(u) && u.campusState === "ok").map(identityOf),
    report: (identity, state) => markCampus(db, identity.id, state),
  };
  const syncer = new Syncer(db, config.syncMinutes, undefined, accounts);
  // edu-ID locks an account after repeated wrong passwords: five tries per account and quarter of an hour, no more.
  const connector = new CampusConnector(db, vault, new LoginLimiter(5, 1000), options.campusLogin);
  return {
    config,
    auth: options.auth ?? new Auth(config),
    db,
    queue,
    limiter: new LoginLimiter(),
    requests: new RequestLog(db),
    syncer,
    repos: new LocalRepos(async () => describeGithubRun(await syncer.runOne("github"))),
    vault,
    connector,
  };
}
