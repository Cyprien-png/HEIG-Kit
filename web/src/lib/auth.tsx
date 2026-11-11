import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setSetupRequiredHandler, setUnauthorizedHandler } from "./api";
import type { Account } from "./types";

interface Session {
  /** The account of the session; undefined when nobody is logged in. */
  me?: Account;
  ready: boolean;
  login: (email: string, password: string) => Promise<Account>;
  logout: () => Promise<void>;
  /** Reads the account again (after a step of its setup, or when the server says something changed). */
  refresh: () => Promise<void>;
  setMe: (me: Account) => void;
}

const Ctx = createContext<Session>({ ready: false, login: async () => Promise.reject(new Error("no session")), logout: async () => {}, refresh: async () => {}, setMe: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Account>();
  const [ready, setReady] = useState(false);

  const refresh = useCallback(
    () =>
      api<Account>("/api/auth/me")
        .then(setMe)
        .catch(() => setMe(undefined)),
    [],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(undefined));
    setSetupRequiredHandler(() => void refresh());
    void refresh().finally(() => setReady(true));
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const account = await api<Account>("/api/auth/login", { method: "POST", json: { email, password } });
    setMe(account);
    return account;
  };
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMe(undefined);
  };
  return <Ctx.Provider value={{ me, ready, login, logout, refresh, setMe }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** Where to go once logged in and set up: back to an authorization asked by an application (Claude, the CLI), if any. */
export function pendingAuthorization(search: string): string | undefined {
  const next = new URLSearchParams(search).get("next");
  return next?.startsWith("/oauth/authorize?") ? next : undefined;
}

/** Light, dark or the system's choice, remembered in this browser. */
export function useTheme(): [string, (t: string) => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("heig-theme") ?? "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("heig-theme", theme);
    } catch {
      // Private window.
    }
  }, [theme]);
  return [theme, setTheme];
}

export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const forced = document.documentElement.getAttribute("data-theme");
      setDark(forced ? forced === "dark" : mq.matches);
    };
    update();
    mq.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return dark;
}
