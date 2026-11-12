import { CampusConnector } from "../accounts/connect.js";
import { identityOf, listUsers, markCampus, setupStep, userCacheDir } from "../accounts/users.js";
import { Vault } from "../accounts/vault.js";
import { type CourseRepos, LocalRepos, describeGithubRun } from "../app/repos.js";
import { RequestLog } from "../app/requests.js";
import { type SyncAccounts, Syncer } from "../app/sync.js";
import { CampusLocked, setCampusProvider } from "../campus.js";
import { requireCampusAccess } from "../accounts/access.js";
import { requireExplicitIdentity } from "../identity.js";
import { setSecretFileKey } from "../secretfile.js";
import type { Db } from "../rag/db.js";
import { Auth, LoginLimiter } from "./auth.js";
import type { ServerConfig } from "./config.js";
import type { JobQueue, JobRecord } from "./jobs.js";
import { Pusher } from "./push.js";
import type { PushPost } from "../webpush.js";
import { type Notice, notify, setNotifier } from "../app/notify.js";

/** What an account is told when one of its renderings ends. */
function jobNotice(job: JobRecord): Notice {
  const video = job.kind !== "document";
  const file = job.files[0];
  const url = file ? `/library/${file.split("/").map(encodeURIComponent).join("/")}` : "/library";
  if (job.state === "failed") return { kind: "document", title: video ? "La génération de la vidéo a échoué" : "La génération du document a échoué", body: job.name, url: "/library", tag: `job-${job.id}` };
  return { kind: "document", title: video ? "Votre vidéo est prête" : "Votre document est prêt", body: job.name, url, tag: `job-${job.id}` };
}

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
  /** Notifications to the devices of the accounts. */
  pusher: Pusher;
}

export interface AppOptions {
  auth?: Auth;
  /** Replaces the calls to the push services (tests). */
  push?: PushPost;
  /** Replaces the real login on GAPS (tests). */
  campusLogin?: (mfaCode?: string) => Promise<unknown>;
}

/**
 * From here on the process is a shared server: nothing runs as the local owner any more, every piece of work has the
 * account of its request (src/identity.ts), and campus logins use that account's own session and credentials.
 */
export function createApp(config: ServerConfig, db: Db, queue?: JobQueue, options: AppOptions = {}): App {
  requireExplicitIdentity();
  const auth = options.auth ?? new Auth(config);
  // The sessions and tokens of the accounts are encrypted on the disk, with a key that is not on it.
  setSecretFileKey(auth.secretFileKey);
  const vault = new Vault();
  setInterval(() => vault.sweep(), 60_000).unref();
  setCampusProvider((identity) => {
    // An account without edu-ID has no way to GAPS or Cyberlearn, whatever asks for it.
    requireCampusAccess(identity);
    return campusOf(identity.id);
  });
  const campusOf = (id: number) => ({
    dir: userCacheDir(id),
    credentials: () => {
      const held = vault.credentials(id);
      if (!held) throw new CampusLocked();
      return held;
    },
  });
  const accounts: SyncAccounts = {
    // Accounts that never connected, or whose session is known to have ended, wait for their owner.
    list: async () => (await listUsers(db)).filter((u) => !u.disabledAt && !setupStep(u) && u.access === "campus" && u.campusState === "ok").map(identityOf),
    report: (identity, state) => markCampus(db, identity.id, state),
  };
  const syncer = new Syncer(db, config.syncMinutes, undefined, accounts);
  // edu-ID locks an account after repeated wrong passwords: five tries per account and quarter of an hour, no more.
  const connector = new CampusConnector(db, vault, new LoginLimiter(5, 1000), options.campusLogin);
  const pusher = new Pusher(db, auth.webPushSecret, config.publicUrl, options.push);
  setNotifier((to, notice) => void pusher.send(to, notice).catch((error: unknown) => console.error(`Notification not sent: ${error instanceof Error ? error.message : error}`)));
  if (queue) queue.onFinished = (job) => notify(job.userId, jobNotice(job));
  return {
    pusher,
    config,
    auth,
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
