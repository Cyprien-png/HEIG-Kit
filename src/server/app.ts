import type { Db } from "../rag/db.js";
import { type CourseRepos, LocalRepos, describeGithubRun } from "../app/repos.js";
import { RequestLog } from "../app/requests.js";
import { Syncer } from "../app/sync.js";
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
}

export function createApp(config: ServerConfig, db: Db, queue?: JobQueue, auth = new Auth(config)): App {
  const syncer = new Syncer(db, config.syncMinutes);
  return { config, auth, db, queue, limiter: new LoginLimiter(), requests: new RequestLog(db), syncer, repos: new LocalRepos(async () => describeGithubRun(await syncer.runOne("github"))) };
}
