import {
  AcademicCapIcon,
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  EllipsisHorizontalIcon,
  FolderIcon,
  HomeIcon,
  MoonIcon,
  RectangleStackIcon,
  SignalIcon,
  SunIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { type ComponentType, type ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useSession, useTheme } from "../lib/auth";
import { Modal, cx } from "./ui";

interface Item {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const MAIN: Item[] = [
  { to: "/", label: "Accueil", icon: HomeIcon },
  { to: "/calendar", label: "Calendrier", icon: CalendarDaysIcon },
  { to: "/courses", label: "Cours", icon: BookOpenIcon },
  { to: "/cards", label: "Cartes", icon: RectangleStackIcon },
  { to: "/corrections", label: "Corrections", icon: CheckBadgeIcon },
  { to: "/profile", label: "Profil", icon: UserCircleIcon },
  { to: "/grades", label: "Notes", icon: ChartBarIcon },
  { to: "/studies", label: "Études", icon: AcademicCapIcon },
  { to: "/library", label: "Bibliothèque", icon: FolderIcon },
  { to: "/status", label: "Statut", icon: SignalIcon },
];
const BOTTOM = MAIN.slice(0, 4);

export function Shell({ children }: { children: ReactNode }) {
  const { username, logout } = useSession();
  const [theme, setTheme] = useTheme();
  const [more, setMore] = useState(false);
  const location = useLocation();
  const moreActive = !BOTTOM.some((i) => (i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to)));

  const ThemeIcon = theme === "dark" ? MoonIcon : SunIcon;
  const cycleTheme = () => setTheme(theme === "system" ? "dark" : theme === "dark" ? "light" : "system");

  return (
    <div className="min-h-full md:grid md:grid-cols-[13.5rem_1fr] xl:grid-cols-[15rem_1fr]">
      <aside className="hidden md:flex flex-col border-r border-line bg-surface sticky top-0 h-screen">
        <div className="px-4 h-14 flex items-center gap-2 border-b border-line">
          <span className="h-7 w-7 rounded-md bg-ink text-canvas grid place-items-center font-mono text-xs font-bold">HK</span>
          <span className="font-semibold tracking-tight">HEIG-Kit</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {MAIN.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => cx("flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm font-medium transition-colors", isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-2 flex items-center justify-between gap-2">
          <div className="min-w-0 px-1.5">
            <div className="text-xs text-ink-3">Connecté</div>
            <div className="text-sm font-medium truncate">{username}</div>
          </div>
          <div className="flex items-center">
            <button onClick={cycleTheme} title={`Thème : ${theme}`} className="h-8 w-8 grid place-items-center rounded-md text-ink-2 hover:bg-surface-2">
              <ThemeIcon className="h-4.5 w-4.5" />
            </button>
            <button onClick={() => void logout()} title="Se déconnecter" className="h-8 w-8 grid place-items-center rounded-md text-ink-2 hover:bg-surface-2">
              <ArrowRightStartOnRectangleIcon className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex flex-col min-h-full">
        <header className="md:hidden sticky top-0 z-30 h-12 pt-safe bg-surface/90 backdrop-blur border-b border-line flex items-center justify-between px-4">
          <span className="font-semibold tracking-tight">HEIG-Kit</span>
          <button onClick={cycleTheme} className="h-8 w-8 grid place-items-center rounded-md text-ink-2">
            <ThemeIcon className="h-5 w-5" />
          </button>
        </header>
        <main className="flex-1 w-full max-w-[1500px] mx-auto px-4 md:px-6 xl:px-8 py-5 md:py-7 pb-24 md:pb-10">{children}</main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-safe">
        <div className="grid grid-cols-5">
          {BOTTOM.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => cx("flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-medium", isActive ? "text-accent" : "text-ink-3")}>
              <item.icon className="h-6 w-6" />
              {item.label}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className={cx("flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-medium", moreActive ? "text-accent" : "text-ink-3")}>
            <EllipsisHorizontalIcon className="h-6 w-6" />
            Plus
          </button>
        </div>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title="Plus">
        <div className="grid grid-cols-2 gap-2">
          {MAIN.slice(4).map((item) => (
            <NavLink key={item.to} to={item.to} onClick={() => setMore(false)} className={({ isActive }) => cx("flex items-center gap-2.5 rounded-lg border px-3 h-12 text-sm font-medium", isActive ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2")}>
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
          <button onClick={() => void logout()} className="flex items-center gap-2.5 rounded-lg border border-line px-3 h-12 text-sm font-medium text-ink-2 col-span-2">
            <ArrowRightStartOnRectangleIcon className="h-5 w-5" /> Se déconnecter ({username})
          </button>
        </div>
      </Modal>
    </div>
  );
}
