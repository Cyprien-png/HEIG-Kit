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
  QuestionMarkCircleIcon,
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
  { to: "/quiz", label: "Quiz", icon: QuestionMarkCircleIcon },
  { to: "/corrections", label: "Corrections", icon: CheckBadgeIcon },
  { to: "/profile", label: "Profil", icon: UserCircleIcon },
  { to: "/grades", label: "Notes", icon: ChartBarIcon },
  { to: "/studies", label: "Études", icon: AcademicCapIcon },
  { to: "/library", label: "Bibliothèque", icon: FolderIcon },
  { to: "/status", label: "Statut", icon: SignalIcon },
];
const BOTTOM = MAIN.slice(0, 4);

/** Routes shown without the phone's header and bottom bar: a card fills the screen and has its own way out. */
const IMMERSIVE = /^\/(study|quiz\/play)(\/|$)/;

export function Shell({ children }: { children: ReactNode }) {
  const { username, logout } = useSession();
  const [theme, setTheme] = useTheme();
  const [more, setMore] = useState(false);
  const location = useLocation();
  const moreActive = !BOTTOM.some((i) => (i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to)));
  const immersive = IMMERSIVE.test(location.pathname);

  const ThemeIcon = theme === "dark" ? MoonIcon : SunIcon;
  const cycleTheme = () => setTheme(theme === "system" ? "dark" : theme === "dark" ? "light" : "system");

  return (
    <div className="h-full md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden md:flex flex-col border-r border-line bg-surface h-full min-h-0">
        <div className="px-4 h-14 flex items-center gap-2 border-b border-line shrink-0">
          <img src="/favicon.svg" alt="" className="h-7 w-7 rounded-md" />
          <span className="font-semibold tracking-tight">HEIG-Kit</span>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto py-3 px-2 space-y-0.5">
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
        <div className="border-t border-line p-2 flex items-center justify-between gap-2 shrink-0">
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

      <div className="h-full flex flex-col min-w-0 min-h-0">
        {/* The safe area is padding outside the 3rem row, so the band keeps its height under a translucent status bar. */}
        {!immersive && (
          <header className="md:hidden shrink-0 pt-safe bg-surface border-b border-line">
            <div className="h-12 flex items-center justify-between px-4">
              <span className="font-semibold tracking-tight">HEIG-Kit</span>
              <button onClick={cycleTheme} aria-label="Thème" className="h-8 w-8 grid place-items-center rounded-md text-ink-2">
                <ThemeIcon className="h-5 w-5" />
              </button>
            </div>
          </header>
        )}
        {/* The only scrolling area of the app; it never chains its scroll to the document. */}
        <main className={cx("flex-1 min-h-0 w-full min-w-0 overscroll-y-contain", immersive ? "overflow-hidden" : "overflow-y-auto overflow-x-clip px-4 md:px-6 xl:px-8 py-5 md:py-7")}>
          {immersive ? children : <div className="h-full max-w-[1500px] mx-auto">{children}</div>}
        </main>
        {!immersive && (
          <nav className="md:hidden shrink-0 bg-surface border-t border-line pb-safe">
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
        )}
      </div>

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
