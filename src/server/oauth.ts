/**
 * OAuth 2.1 authorization server in front of /mcp, for clients that cannot carry a fixed bearer token: claude.ai
 * connectors and the Claude phone app. It implements what the MCP authorization specification asks for: protected
 * resource and authorization server metadata (RFC 9728, RFC 8414), dynamic client registration (RFC 7591), the
 * authorization code flow with PKCE (S256 only) on a login page served here, and refresh tokens with rotation.
 * The access tokens are the same JWTs as those of POST /auth/login, so /mcp and /api do not change.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, json, readBody } from "./api/util.js";
import type { App } from "./app.js";

const CODE_MINUTES = 10;
/** Access tokens of connectors are short: the refresh token (as long as HEIG_JWT_DAYS) renews them. */
const ACCESS_DAYS = 7;
const MAX_CLIENTS = 200;
const MAX_FORM_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  secretHash?: string;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Redirect URIs must be https, or http on the local machine (development tools such as the MCP inspector). */
export function validRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** PKCE: the verifier the client kept hashes to the challenge it sent when authorizing. */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return same(createHash("sha256").update(verifier).digest("base64url"), challenge);
}

export function authorizationServerMetadata(publicUrl: URL) {
  const issuer = publicUrl.origin;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["heig-kit"],
  };
}

export function protectedResourceMetadata(publicUrl: URL) {
  const issuer = publicUrl.origin;
  return { resource: `${issuer}/mcp`, resource_name: "HEIG-Kit", authorization_servers: [issuer], bearer_methods_supported: ["header"], scopes_supported: ["heig-kit"] };
}

/** The header /mcp answers with when the token is missing or wrong, pointing clients to the metadata. */
export const challengeHeader = (publicUrl: URL) => `Bearer resource_metadata="${publicUrl.origin}/.well-known/oauth-protected-resource"`;

interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  state?: string;
  challenge: string;
  scope?: string;
}

class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class OAuth {
  constructor(private readonly app: App) {}

  /** Serves the OAuth paths; false when the path is not one of them. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, client: string): Promise<{ handled: boolean; note?: string }> {
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
      if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/oauth-authorization-server/mcp") {
        json(res, 200, authorizationServerMetadata(this.app.config.publicUrl), { "Cache-Control": "public, max-age=3600" });
      } else if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
        json(res, 200, protectedResourceMetadata(this.app.config.publicUrl), { "Cache-Control": "public, max-age=3600" });
      } else if (path === "/oauth/register") {
        if (method !== "POST") return this.methodNotAllowed(res, "POST");
        await this.register(req, res);
      } else if (path === "/oauth/authorize") {
        if (method === "GET") await this.authorizePage(res, url.searchParams);
        else if (method === "POST") return { handled: true, note: await this.authorizeSubmit(req, res, client) };
        else return this.methodNotAllowed(res, "GET, POST");
      } else if (path === "/oauth/token") {
        if (method !== "POST") return this.methodNotAllowed(res, "POST");
        return { handled: true, note: await this.token(req, res) };
      } else {
        return { handled: false };
      }
      return { handled: true };
    } catch (error) {
      if (error instanceof OAuthError) {
        json(res, error.status, { error: error.code, error_description: error.message }, NO_STORE);
        return { handled: true, note: error.code };
      }
      throw error;
    }
  }

  private methodNotAllowed(res: ServerResponse, allow: string): { handled: boolean } {
    json(res, 405, { error: "method not allowed" }, { Allow: allow });
    return { handled: true };
  }

  // Clients

  async client(id: string): Promise<OAuthClient | undefined> {
    const { rows } = await this.app.db.query<{ id: string; name: string; redirect_uris: string[]; secret_hash: string | null }>("SELECT id, name, redirect_uris, secret_hash FROM oauth_clients WHERE id = $1", [id]);
    return rows[0] ? { id: rows[0].id, name: rows[0].name, redirectUris: rows[0].redirect_uris, secretHash: rows[0].secret_hash ?? undefined } : undefined;
  }

  /** RFC 7591: anyone can register a client; what it gets is only the right to ask the user to log in. */
  private async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = (await readBody(req, MAX_FORM_BYTES)).toString("utf-8");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error();
    } catch {
      throw new OAuthError("invalid_client_metadata", "expected a JSON object");
    }
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === "string" && u.length <= 500 && validRedirectUri(u))) {
      throw new OAuthError("invalid_redirect_uri", "redirect_uris must be https URLs (or http on localhost)");
    }
    const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "Client MCP";
    const authMethod = body.token_endpoint_auth_method ?? "client_secret_basic";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(authMethod as string)) throw new OAuthError("invalid_client_metadata", "unsupported token_endpoint_auth_method");
    const grants = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code"];
    if (!grants.every((g) => g === "authorization_code" || g === "refresh_token")) throw new OAuthError("invalid_client_metadata", "only authorization_code and refresh_token are supported");
    const { rows } = await this.app.db.query<{ n: string }>("SELECT count(*) AS n FROM oauth_clients");
    if (Number(rows[0].n) >= MAX_CLIENTS) throw new OAuthError("too_many_clients", "too many registered clients", 429);

    const id = secret();
    const clientSecret = authMethod === "none" ? undefined : secret();
    await this.app.db.query("INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash) VALUES ($1, $2, $3, $4)", [id, name, JSON.stringify(uris), clientSecret ? sha256(clientSecret) : null]);
    console.error(`OAuth client registered: ${name} (${(uris as string[]).join(", ")})`);
    json(
      res,
      201,
      {
        client_id: id,
        ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: authMethod,
      },
      NO_STORE,
    );
  }

  // Authorization

  /** Checks an authorization request; errors about the client or its redirect URI are shown here, never redirected. */
  private async parseAuthorize(params: URLSearchParams): Promise<AuthorizeRequest> {
    const clientId = params.get("client_id") ?? "";
    const client = clientId ? await this.client(clientId) : undefined;
    if (!client) throw new OAuthError("invalid_client", "unknown client_id; the client must register first");
    const redirectUri = params.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
    if (!client.redirectUris.includes(redirectUri)) throw new OAuthError("invalid_request", "redirect_uri is not one of the client's registered URIs");
    if (params.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "response_type must be code");
    const challenge = params.get("code_challenge") ?? "";
    if ((params.get("code_challenge_method") ?? "S256") !== "S256" || !/^[A-Za-z0-9\-_]{43}$/.test(challenge)) throw new OAuthError("invalid_request", "PKCE with S256 is required");
    const state = params.get("state") ?? undefined;
    if (state && state.length > 1000) throw new OAuthError("invalid_request", "state is too long");
    const scope = params.get("scope")?.trim() || undefined;
    return { client, redirectUri, state, challenge, scope };
  }

  private async authorizePage(res: ServerResponse, params: URLSearchParams, error?: string, status = 200): Promise<void> {
    let request: AuthorizeRequest;
    try {
      request = await this.parseAuthorize(params);
    } catch (e) {
      if (!(e instanceof OAuthError)) throw e;
      return page(res, 400, "Demande invalide", `<p class="error">${escape(e.message)}</p><p class="muted">Code : <code>${escape(e.code)}</code>. Le client doit s'enregistrer sur ce serveur et utiliser une adresse de retour enregistrée.</p>`);
    }
    const hidden = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"]
      .filter((name) => params.has(name))
      .map((name) => `<input type="hidden" name="${name}" value="${escape(params.get(name)!)}">`)
      .join("");
    const host = escape(new URL(request.redirectUri).host);
    page(
      res,
      status,
      "Autoriser l'accès",
      `<p><strong>${escape(request.client.name)}</strong> <span class="muted">(${host})</span> demande l'accès à votre HEIG-Kit : calendrier, cours, cartes, corrections, profil.</p>
      <form method="post" action="/oauth/authorize">${hidden}
        <label>Nom d'utilisateur<input name="username" autocomplete="username" required autofocus></label>
        <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>
        ${error ? `<p class="error">${escape(error)}</p>` : ""}
        <button type="submit">Autoriser</button>
      </form>
      <p class="muted">Le compte est celui du fichier <code>.env</code> du serveur. L'accès peut être révoqué en changeant <code>HEIG_JWT_VERSION</code>.</p>`,
    );
  }

  private async authorizeSubmit(req: IncomingMessage, res: ServerResponse, client: string): Promise<string | undefined> {
    const form = new URLSearchParams((await readBody(req, MAX_FORM_BYTES)).toString("utf-8"));
    if (!this.app.limiter.allowed(client)) {
      console.error(`OAuth login refused (too many failures) from ${client}`);
      await this.authorizePage(res, form, "Trop de tentatives : réessayez dans un quart d'heure.", 429);
      return "too many attempts";
    }
    if (!this.app.auth.checkCredentials(form.get("username"), form.get("password"))) {
      this.app.limiter.fail(client);
      console.error(`OAuth login failed from ${client}`);
      await this.authorizePage(res, form, "Identifiants refusés.", 401);
      return "invalid credentials";
    }
    let request: AuthorizeRequest;
    try {
      request = await this.parseAuthorize(form);
    } catch (e) {
      if (!(e instanceof OAuthError)) throw e;
      return void page(res, 400, "Demande invalide", `<p class="error">${escape(e.message)}</p>`);
    }
    this.app.limiter.succeed(client);
    const code = secret();
    await this.app.db.query("INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, scope, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      sha256(code),
      request.client.id,
      request.redirectUri,
      request.challenge,
      request.scope ?? null,
      new Date(Date.now() + CODE_MINUTES * 60_000),
    ]);
    const target = new URL(request.redirectUri);
    target.searchParams.set("code", code);
    if (request.state) target.searchParams.set("state", request.state);
    console.error(`OAuth access authorized for ${request.client.name} from ${client}`);
    res.writeHead(302, { Location: target.href, ...NO_STORE }).end();
    return undefined;
  }

  // Tokens

  private async token(req: IncomingMessage, res: ServerResponse): Promise<string | undefined> {
    const raw = (await readBody(req, MAX_FORM_BYTES)).toString("utf-8");
    const form = /json/i.test(req.headers["content-type"] ?? "") ? jsonForm(raw) : new URLSearchParams(raw);
    const basic = /^Basic (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (basic) {
      const [id, ...rest] = Buffer.from(basic, "base64").toString("utf-8").split(":");
      form.set("client_id", decodeURIComponent(id));
      form.set("client_secret", decodeURIComponent(rest.join(":")));
    }
    const client = await this.client(form.get("client_id") ?? "");
    if (!client) throw new OAuthError("invalid_client", "unknown client", 401);
    if (client.secretHash && !same(sha256(form.get("client_secret") ?? ""), client.secretHash)) throw new OAuthError("invalid_client", "client authentication failed", 401);

    const grant = form.get("grant_type");
    let scope: string | undefined;
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const { rows } = await this.app.db.query<{ client_id: string; redirect_uri: string; code_challenge: string; scope: string | null; expires_at: Date; used_at: Date | null }>(
        "UPDATE oauth_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL RETURNING client_id, redirect_uri, code_challenge, scope, expires_at, used_at",
        [sha256(code)],
      );
      const row = rows[0];
      if (!row || row.client_id !== client.id || row.expires_at < new Date()) throw new OAuthError("invalid_grant", "unknown, used or expired code");
      if ((form.get("redirect_uri") ?? row.redirect_uri) !== row.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri does not match");
      if (!pkceMatches(form.get("code_verifier"), row.code_challenge)) throw new OAuthError("invalid_grant", "code_verifier does not match the challenge");
      scope = row.scope ?? undefined;
    } else if (grant === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      const { rows } = await this.app.db.query<{ client_id: string; scope: string | null; expires_at: Date; revoked_at: Date | null }>("SELECT client_id, scope, expires_at, revoked_at FROM oauth_refresh_tokens WHERE token_hash = $1", [sha256(presented)]);
      const row = rows[0];
      if (!row || row.client_id !== client.id) throw new OAuthError("invalid_grant", "unknown refresh token");
      if (row.revoked_at) {
        // A rotated token presented again means it leaked: everything of this client is revoked.
        await this.app.db.query("UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE client_id = $1 AND revoked_at IS NULL", [client.id]);
        console.error(`OAuth refresh token reused by client ${client.name}: its tokens are revoked`);
        throw new OAuthError("invalid_grant", "refresh token already used");
      }
      if (row.expires_at < new Date()) throw new OAuthError("invalid_grant", "refresh token expired");
      await this.app.db.query("UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1", [sha256(presented)]);
      scope = row.scope ?? undefined;
    } else {
      throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
    }

    const { token, expiresAt } = await this.app.auth.issueToken(ACCESS_DAYS);
    const refresh = secret();
    await this.app.db.query("INSERT INTO oauth_refresh_tokens (token_hash, client_id, scope, expires_at) VALUES ($1, $2, $3, $4)", [sha256(refresh), client.id, scope ?? null, new Date(Date.now() + this.app.config.tokenDays * 86_400_000)]);
    await this.app.db.query("UPDATE oauth_clients SET last_used_at = now() WHERE id = $1", [client.id]);
    await this.app.db.query("DELETE FROM oauth_codes WHERE expires_at < now() - interval '1 day'");
    json(res, 200, { access_token: token, token_type: "Bearer", expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000), refresh_token: refresh, ...(scope ? { scope } : {}) }, NO_STORE);
    return undefined;
  }
}

function jsonForm(raw: string): URLSearchParams {
  const form = new URLSearchParams();
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") form.set(k, v);
  } catch {
    // An unreadable body is just an empty form.
  }
  return form;
}

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // form-action also governs the redirect that follows the form (Chrome, WebKit): the client's callback must be allowed.
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; base-uri 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  ...NO_STORE,
};

/** The login page of the authorization flow, in the style of the web application, without any script. */
function page(res: ServerResponse, status: number, title: string, body: string): void {
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · HEIG-Kit</title>
<style>
:root{--canvas:#f5f4f1;--surface:#fff;--line:#dcd8d2;--ink:#1c1a17;--ink-2:#57534c;--ink-3:#8f887f;--accent:#d90115;--accent-ink:#fff;--bad:#9f1239;--bad-soft:#ffe4e6;color-scheme:light}
@media(prefers-color-scheme:dark){:root{--canvas:#161412;--surface:#1e1b18;--line:#353028;--ink:#ede9e3;--ink-2:#b8b0a6;--ink-3:#7d756b;--accent:#ff5a66;--accent-ink:#1a0608;--bad:#fb7185;--bad-soft:#701a2b;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--canvas);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:400px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:24px;box-shadow:0 1px 2px rgb(15 23 42/.06),0 4px 16px rgb(15 23 42/.05)}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:16px}.mark{width:28px;height:28px;border-radius:6px;display:block}
h1{font-size:18px;margin:0 0 12px}p{margin:0 0 12px}label{display:block;font-size:13px;font-weight:500;color:var(--ink-2);margin:12px 0 4px}
input{display:block;width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
button{margin-top:16px;width:100%;height:42px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:600;cursor:pointer}
.error{background:var(--bad-soft);color:var(--bad);border-radius:8px;padding:8px 12px;font-size:14px;margin-top:12px}.muted{color:var(--ink-3);font-size:13px}code{font:13px ui-monospace,Menlo,monospace}
</style></head><body><main><div class="brand"><img class="mark" src="/favicon.svg" alt="">HEIG-Kit</div><h1>${escape(title)}</h1>${body}</main></body></html>`;
  res.writeHead(status, PAGE_HEADERS).end(html);
}
