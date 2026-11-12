import { createHmac, timingSafeEqual } from "node:crypto";
import { seal, unseal } from "../accounts/password.js";
import { SignJWT, jwtVerify } from "jose";
import type { ServerConfig } from "./config.js";

const ISSUER = "heig-kit";
const MCP_AUDIENCE = "heig-kit-mcp";
const FILE_AUDIENCE = "heig-kit-file";
const CAPTURE_AUDIENCE = "heig-kit-capture";

/** Who an access token was issued to. The account itself is read again at each request (role, state, revocation). */
export interface TokenSubject {
  userId: number;
  /** The account's token version when the token was issued: a later version revokes it. */
  version: number;
  /** The key of the account's sealed edu-ID credentials, when the token carries it (see `wrapVaultKey`). */
  vaultKey?: Buffer;
}

export interface Holder {
  id: number;
  tokenVersion: number;
}

const accountId = (value: unknown): number | undefined => {
  const id = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/**
 * Access tokens, download links and capture links, each with its own key: one can never be used as another. An access
 * token names one account (`sub`) and nothing in a request can name another: that is where the separation starts.
 */
export class Auth {
  private readonly accessKey: Uint8Array;
  private readonly fileKey: Uint8Array;
  private readonly captureKey: Uint8Array;
  private readonly formKey: Buffer;
  private readonly wrapKey: Buffer;
  private readonly filesAtRestKey: Buffer;
  private readonly pushKey: Buffer;

  constructor(private readonly config: Pick<ServerConfig, "jwtSecret" | "tokenVersion" | "tokenDays" | "linkMinutes">) {
    const key = (purpose: string) => createHmac("sha256", config.jwtSecret).update(purpose).digest();
    this.accessKey = key("access");
    this.fileKey = key("file");
    this.captureKey = key("capture");
    this.formKey = key("form");
    this.wrapKey = key("vault key wrap");
    this.filesAtRestKey = key("campus files at rest");
    this.pushKey = key("web push");
  }

  /**
   * The key of an account's sealed edu-ID credentials, encrypted for this server alone, to travel in the account's own
   * tokens. The server stores neither the key nor its wrapped form: opening the credentials takes the database, the
   * server's secret and a token the person holds, all three. So a request of the person is enough for the server to
   * log in to edu-ID again in their name, and nobody can without one.
   */
  wrapVaultKey(userId: number, vaultKey: Buffer): string {
    return seal(this.wrapKey, `${userId}:${vaultKey.toString("base64")}`).toString("base64url");
  }

  /** The key a wrapped form holds, when it was made by this server for this account. */
  unwrapVaultKey(userId: number, wrapped: unknown): Buffer | undefined {
    if (typeof wrapped !== "string" || wrapped.length > 400 || !/^[A-Za-z0-9_-]+$/.test(wrapped)) return undefined;
    const text = unseal(this.wrapKey, Buffer.from(wrapped, "base64url"));
    const [owner, key] = text?.split(":") ?? [];
    return owner === String(userId) && key ? Buffer.from(key, "base64") : undefined;
  }

  /** An access token of an account for `days` (default HEIG_JWT_DAYS; OAuth connectors get shorter ones and refresh them). */
  async issueToken(holder: Holder, days = this.config.tokenDays, vaultKey?: Buffer): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + Math.min(days, this.config.tokenDays) * 86_400_000);
    const token = await new SignJWT({ ver: this.config.tokenVersion, uv: holder.tokenVersion, ...(vaultKey ? { vk: this.wrapVaultKey(holder.id, vaultKey) } : {}) })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(String(holder.id))
      .setIssuer(ISSUER)
      .setAudience(MCP_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.accessKey);
    return { token, expiresAt };
  }

  /** The account an Authorization header names, when its token is valid. */
  async verifyHeader(header: string | undefined): Promise<TokenSubject | undefined> {
    const token = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
    return token ? this.verifyAccessToken(token) : undefined;
  }

  /** The account a token (from a header or the session cookie) names, when it is a valid access token. */
  async verifyAccessToken(token: string): Promise<TokenSubject | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, { issuer: ISSUER, audience: MCP_AUDIENCE, algorithms: ["HS256"] });
      const userId = accountId(payload.sub);
      if (payload.ver !== this.config.tokenVersion || userId === undefined || typeof payload.uv !== "number") return undefined;
      return { userId, version: payload.uv, vaultKey: this.unwrapVaultKey(userId, payload.vk) };
    } catch {
      return undefined;
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

  /** A token letting a phone add photos to one correction of one account, for a few hours. */
  async issueCaptureToken(correctionId: string, userId: number, hours = 6): Promise<string> {
    return new SignJWT({ ver: this.config.tokenVersion, uid: String(userId) })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(correctionId)
      .setIssuer(ISSUER)
      .setAudience(CAPTURE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(new Date(Date.now() + hours * 3_600_000))
      .sign(this.captureKey);
  }

  /** The correction a capture token gives access to and the account it belongs to, or undefined. */
  async verifyCaptureToken(token: string): Promise<{ correctionId: string; userId: number } | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.captureKey, { issuer: ISSUER, audience: CAPTURE_AUDIENCE, algorithms: ["HS256"] });
      const userId = accountId(payload.uid);
      return payload.ver === this.config.tokenVersion && typeof payload.sub === "string" && userId !== undefined ? { correctionId: payload.sub, userId } : undefined;
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

  /** What the server's identity towards the push services is derived from (src/webpush.ts). */
  get webPushSecret(): Buffer {
    return this.pushKey;
  }

  /** The key that encrypts the edu-ID sessions and Cyberlearn tokens the server keeps on its disk (src/secretfile.ts). */
  get secretFileKey(): Buffer {
    return this.filesAtRestKey;
  }

  /** Ties a form of the server's own pages to the session that displayed it (CSRF). */
  formToken(session: string, purpose: string): string {
    return createHmac("sha256", this.formKey).update(`${purpose}\n${session}`).digest("base64url");
  }

  checkFormToken(given: unknown, session: string, purpose: string): boolean {
    if (typeof given !== "string") return false;
    const expected = Buffer.from(this.formToken(session, purpose));
    const actual = Buffer.from(given);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
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
