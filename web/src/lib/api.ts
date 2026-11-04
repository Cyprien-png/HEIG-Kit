/** Calls to the server's API with the session cookie; a 401 sends the user to the login page. */
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; capture?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "heig-kit");
  headers.set("Accept", "application/json");
  if (init.capture) headers.set("Authorization", `Bearer ${init.capture}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, credentials: "same-origin" });
  if (res.status === 401 && !init.capture) {
    onUnauthorized?.();
    throw new ApiError(401, "Session expirée");
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Not JSON.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? await res.json() : await res.text()) as T;
}

export interface Query<T> {
  data?: T;
  error?: string;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (update: T | ((previous: T | undefined) => T | undefined)) => void;
}

/** Loads a path when it (or `deps`) changes; `null` skips the load. */
export function useApi<T>(path: string | null, deps: unknown[] = [], options: { refreshMs?: number; capture?: string } = {}): Query<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(path !== null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (path === null) return;
    const id = ++latest.current;
    try {
      const result = await api<T>(path, { capture: options.capture });
      if (id !== latest.current) return;
      setData(result);
      setError(undefined);
    } catch (e) {
      if (id !== latest.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, options.capture, ...deps]);

  useEffect(() => {
    setLoading(path !== null);
    void reload();
    if (!options.refreshMs || path === null) return;
    const timer = setInterval(() => void reload(), options.refreshMs);
    return () => clearInterval(timer);
  }, [reload, options.refreshMs, path]);

  return { data, error, loading, reload, setData: (update) => setData((prev) => (typeof update === "function" ? (update as (p: T | undefined) => T | undefined)(prev) : update)) };
}
