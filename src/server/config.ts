import { folderFromEnv } from "../paths.js";

/** Settings of the remote server (`npm run server`), all from .env. Its accounts are in the database (`npm run users`). */
export interface ServerConfig {
  jwtSecret: string;
  /** Change it to revoke every token and download link at once. */
  tokenVersion: string;
  tokenDays: number;
  linkMinutes: number;
  publicUrl: URL;
  host: string;
  port: number;
  /** Folder shared with the isolated render worker. Without it, rendering is refused. */
  jobsDir?: string;
  /** Behind a reverse proxy, the client address is the last entry of X-Forwarded-For. */
  trustProxy: boolean;
  /** How often GAPS and Cyberlearn are fetched for the web app's calendar and data; 0 disables the sync. */
  syncMinutes: number;
}

function positive(name: string, value: string | undefined, fallback: number, zeroAllowed = false): number {
  if (!value?.trim()) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (number === 0 && !zeroAllowed)) throw new Error(`${name} must be a positive number`);
  return number;
}

/** Reads the settings. Throws on anything unsafe: the server must not start with a weak or missing secret. */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name} in .env (see .env.example)`);
    return value;
  };
  const jwtSecret = required("HEIG_JWT_SECRET");
  if (jwtSecret.length < 32) throw new Error("HEIG_JWT_SECRET must have at least 32 characters (openssl rand -hex 32)");
  if (new Set(jwtSecret).size < 8) throw new Error("HEIG_JWT_SECRET is too simple (openssl rand -hex 32)");

  const publicUrl = new URL(required("HEIG_PUBLIC_URL"));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname);
  if (publicUrl.protocol !== "https:" && !local) throw new Error("HEIG_PUBLIC_URL must use https: tokens and data would otherwise travel in clear");

  return {
    jwtSecret,
    tokenVersion: env.HEIG_JWT_VERSION?.trim() || "1",
    tokenDays: positive("HEIG_JWT_DAYS", env.HEIG_JWT_DAYS, 90),
    linkMinutes: positive("HEIG_LINK_MINUTES", env.HEIG_LINK_MINUTES, 15),
    publicUrl,
    host: env.HEIG_HTTP_HOST?.trim() || "127.0.0.1",
    port: positive("HEIG_HTTP_PORT", env.HEIG_HTTP_PORT, 8766),
    jobsDir: env.HEIG_JOBS_DIR?.trim() ? folderFromEnv(env.HEIG_JOBS_DIR, "") : undefined,
    trustProxy: env.HEIG_TRUST_PROXY === "1" || env.HEIG_TRUST_PROXY === "true",
    syncMinutes: positive("HEIG_SYNC_MINUTES", env.HEIG_SYNC_MINUTES, 60, true),
  };
}
