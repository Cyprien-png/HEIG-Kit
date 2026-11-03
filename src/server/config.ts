import { folderFromEnv } from "../paths.js";

/** Settings of the remote server (`npm run server`), all from .env. */
export interface ServerConfig {
  username: string;
  password: string;
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
}

function positive(name: string, value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number`);
  return number;
}

/** Reads the settings. Throws on anything unsafe: the server must not start with a weak or missing secret. */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name} in .env (see .env.example)`);
    return value;
  };
  const password = required("HEIG_AUTH_PASSWORD");
  if (password.length < 12) throw new Error("HEIG_AUTH_PASSWORD must have at least 12 characters");
  const jwtSecret = required("HEIG_JWT_SECRET");
  if (jwtSecret.length < 32) throw new Error("HEIG_JWT_SECRET must have at least 32 characters (openssl rand -hex 32)");
  if (jwtSecret === password) throw new Error("HEIG_JWT_SECRET must differ from HEIG_AUTH_PASSWORD");

  const publicUrl = new URL(required("HEIG_PUBLIC_URL"));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname);
  if (publicUrl.protocol !== "https:" && !local) throw new Error("HEIG_PUBLIC_URL must use https: tokens and data would otherwise travel in clear");

  return {
    username: required("HEIG_AUTH_USERNAME"),
    password,
    jwtSecret,
    tokenVersion: env.HEIG_JWT_VERSION?.trim() || "1",
    tokenDays: positive("HEIG_JWT_DAYS", env.HEIG_JWT_DAYS, 90),
    linkMinutes: positive("HEIG_LINK_MINUTES", env.HEIG_LINK_MINUTES, 15),
    publicUrl,
    host: env.HEIG_HTTP_HOST?.trim() || "127.0.0.1",
    port: positive("HEIG_HTTP_PORT", env.HEIG_HTTP_PORT, 8766),
    jobsDir: env.HEIG_JOBS_DIR?.trim() ? folderFromEnv(env.HEIG_JOBS_DIR, "") : undefined,
    trustProxy: env.HEIG_TRUST_PROXY === "1" || env.HEIG_TRUST_PROXY === "true",
  };
}
