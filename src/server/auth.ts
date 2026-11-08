import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { ServerConfig } from "./config.js";

const ISSUER = "heig-kit";
const MCP_AUDIENCE = "heig-kit-mcp";
const FILE_AUDIENCE = "heig-kit-file";
const CAPTURE_AUDIENCE = "heig-kit-capture";

const digest = (text: string) => createHash("sha256").update(text).digest();

/** Access tokens and download links, each with its own key: a link can never be used as an access token. */
export class Auth {
  private readonly accessKey: Uint8Array;
  private readonly fileKey: Uint8Array;
  private readonly captureKey: Uint8Array;

  constructor(private readonly config: Pick<ServerConfig, "username" | "password" | "jwtSecret" | "tokenVersion" | "tokenDays" | "linkMinutes">) {
    this.accessKey = createHmac("sha256", config.jwtSecret).update("access").digest();
    this.fileKey = createHmac("sha256", config.jwtSecret).update("file").digest();
    this.captureKey = createHmac("sha256", config.jwtSecret).update("capture").digest();
  }

  /** Compares digests in constant time; both fields are always compared, so timing tells nothing about the username. */
  checkCredentials(username: unknown, password: unknown): boolean {
    if (typeof username !== "string" || typeof password !== "string") return false;
    const user = timingSafeEqual(digest(username), digest(this.config.username));
    const pass = timingSafeEqual(digest(password), digest(this.config.password));
    return user && pass;
  }

  /** An access token for `days` (default HEIG_JWT_DAYS; OAuth connectors get shorter ones and refresh them). */
  async issueToken(days = this.config.tokenDays): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + Math.min(days, this.config.tokenDays) * 86_400_000);
    const token = await new SignJWT({ ver: this.config.tokenVersion })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(this.config.username)
      .setIssuer(ISSUER)
      .setAudience(MCP_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.accessKey);
    return { token, expiresAt };
  }

  /** Whether an Authorization header holds a valid access token. */
  async verifyHeader(header: string | undefined): Promise<boolean> {
    const token = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
    return token ? this.verifyAccessToken(token) : false;
  }

  /** Whether a token (from a header or the session cookie) is a valid access token. */
  async verifyAccessToken(token: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, { issuer: ISSUER, audience: MCP_AUDIENCE, algorithms: ["HS256"] });
      return payload.ver === this.config.tokenVersion && payload.sub === this.config.username;
    } catch {
      return false;
    }
  }

  /** A token for a single file, valid a few minutes. */
  async issueFileToken(file: string): Promise<string> {
    return new SignJWT({ ver: this.config.tokenVersion, file })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setAudience(FILE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(new Date(Date.now() + this.config.linkMinutes * 60_000))
      .sign(this.fileKey);
  }

  /** A token letting a phone add photos to one correction, for a few hours. */
  async issueCaptureToken(correctionId: string, hours = 6): Promise<string> {
    return new SignJWT({ ver: this.config.tokenVersion })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(correctionId)
      .setIssuer(ISSUER)
      .setAudience(CAPTURE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(new Date(Date.now() + hours * 3_600_000))
      .sign(this.captureKey);
  }

  /** The correction a capture token gives access to, or undefined. */
  async verifyCaptureToken(token: string): Promise<string | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.captureKey, { issuer: ISSUER, audience: CAPTURE_AUDIENCE, algorithms: ["HS256"] });
      return payload.ver === this.config.tokenVersion && typeof payload.sub === "string" ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  }

  /** The file a download token gives access to, or undefined. */
  async verifyFileToken(token: string): Promise<string | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.fileKey, { issuer: ISSUER, audience: FILE_AUDIENCE, algorithms: ["HS256"] });
      return payload.ver === this.config.tokenVersion && typeof payload.file === "string" ? payload.file : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Slows down password guessing: limits failures per client and overall. Valid tokens are not affected. */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly perClient = 5,
    private readonly overall = 20,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private count(key: string): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    if (entry.resetAt <= this.now()) {
      this.failures.delete(key);
      return 0;
    }
    return entry.count;
  }

  allowed(client: string): boolean {
    return this.count(`client:${client}`) < this.perClient && this.count("all") < this.overall;
  }

  fail(client: string): void {
    for (const key of [`client:${client}`, "all"]) {
      const count = this.count(key);
      const resetAt = this.failures.get(key)?.resetAt ?? this.now() + this.windowMs;
      this.failures.set(key, { count: count + 1, resetAt });
    }
  }

  succeed(client: string): void {
    this.failures.delete(`client:${client}`);
  }
}
