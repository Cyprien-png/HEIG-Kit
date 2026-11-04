import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, json } from "./util.js";

/** Who is calling: the browser (cookie), an agent or the CLI (bearer token), or a phone capturing photos. */
export type Principal = { kind: "cookie" } | { kind: "bearer" } | { kind: "capture"; correctionId: string };

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  principal: Principal;
  client: string;
}

/** What a route returns: JSON (status 200), or `undefined` when it wrote the response itself. */
export type RouteResult = unknown;
export type Handler = (ctx: RouteContext) => Promise<RouteResult>;

export interface RouteOptions {
  /** Which callers may use the route; by default the browser and agents. */
  allow?: Principal["kind"][];
  /** No authentication at all (login, health). */
  public?: boolean;
}

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
  options: RouteOptions;
}

/** A small router: `/api/decks/:id/cards`, params as strings, JSON answers, HttpError to the client. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, options: RouteOptions = {}): this {
    const names: string[] = [];
    const pattern = new RegExp(
      `^${path
        .split("/")
        .map((part) => {
          if (part.startsWith(":")) {
            names.push(part.slice(1));
            return "([^/]+)";
          }
          if (part === "*") {
            names.push("rest");
            return "(.*)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/")}$`,
    );
    this.routes.push({ method, pattern, names, handler, options });
    return this;
  }

  get(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add("GET", path, handler, options);
  }
  post(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add("POST", path, handler, options);
  }
  put(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add("PUT", path, handler, options);
  }
  patch(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add("PATCH", path, handler, options);
  }
  delete(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add("DELETE", path, handler, options);
  }

  /** The route of a request, or the allowed methods when the path exists with other methods. */
  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | { allowed: string[] } | undefined {
    const allowed: string[] = [];
    for (const route of this.routes) {
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      if (route.method !== method && !(method === "HEAD" && route.method === "GET")) {
        allowed.push(route.method);
        continue;
      }
      const params: Record<string, string> = {};
      route.names.forEach((name, i) => {
        try {
          params[name] = decodeURIComponent(match[i + 1]);
        } catch {
          params[name] = match[i + 1];
        }
      });
      return { route, params };
    }
    return allowed.length > 0 ? { allowed } : undefined;
  }
}

/** Runs a matched route, turning its result into JSON and its errors into an answer. */
export async function runRoute(route: Route, ctx: RouteContext): Promise<void> {
  try {
    const result = await route.handler(ctx);
    if (ctx.res.headersSent || ctx.res.writableEnded) return;
    if (result === undefined) return void json(ctx.res, 204, {});
    json(ctx.res, 200, result);
  } catch (error) {
    if (ctx.res.headersSent) return void ctx.res.destroy();
    if (error instanceof HttpError) return void json(ctx.res, error.status, { error: error.message }, error.headers);
    console.error(error);
    json(ctx.res, 500, { error: "internal error" });
  }
}

export type { Route };
