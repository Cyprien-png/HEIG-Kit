import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "./api";

interface Session {
  username?: string;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session>({ ready: false, login: async () => {}, logout: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setUsername(undefined));
    api<{ username: string }>("/api/auth/me")
      .then((me) => setUsername(me.username))
      .catch(() => setUsername(undefined))
      .finally(() => setReady(true));
  }, []);

  const login = async (user: string, password: string) => {
    const me = await api<{ username: string }>("/api/auth/login", { method: "POST", json: { username: user, password } });
    setUsername(me.username);
  };
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUsername(undefined);
  };
  return <Ctx.Provider value={{ username, ready, login, logout }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

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
