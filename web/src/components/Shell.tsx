import {
  PencilSquareIcon,
  AcademicCapIcon,
  ArchiveBoxIcon,
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  Cog6ToothIcon,
  FolderIcon,
  HomeIcon,
  QuestionMarkCircleIcon,
  RectangleStackIcon,
  SignalIcon,
  Squares2X2Icon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { type ComponentType, type ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useSession, useTheme } from "../lib/auth";
import { Drawer, Segmented, cx } from "./ui";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Routes that light this item up besides its own. */
  under?: string[];
  hint?: string;
}

/** The four places of the app, in the order of the bottom bar. */
export const TABS: NavItem[] = [
  { to: "/", label: "Accueil", icon: HomeIcon },
  { to: "/calendar", label: "Calendrier", icon: CalendarDaysIcon },
  { to: "/revision", label: "Révision", icon: BookOpenIcon, under: ["/cards", "/study", "/quiz", "/exams", "/past-exams", "/courses", "/documents", "/library", "/copies", "/corrections", "/profile"] },
  { to: "/etudes", label: "Études", icon: AcademicCapIcon, under: ["/studies", "/grades"] },
];

/** What the Révision and Études hubs lead to (also the sections of the desktop sidebar). */
export const REVISION: NavItem[] = [
  { to: "/cards", label: "Cartes", icon: RectangleStackIcon, hint: "Répétition espacée, recto-verso" },
  { to: "/quiz", label: "Quiz", icon: QuestionMarkCircleIcon, hint: "Vrai ou faux, à glisser" },
  { to: "/exams", label: "Tests blancs", icon: ClipboardDocumentCheckIcon, hint: "TE blancs par cours, faits ou à faire, notes" },
  { to: "/past-exams", label: "Anciens TE", icon: ArchiveBoxIcon, hint: "Les TE des années précédentes, par branche et année" },
  { to: "/courses", label: "Cours", icon: Squares2X2Icon, hint: "Supports indexés et recherche" },
  { to: "/library", label: "Bibliothèque", icon: FolderIcon, hint: "Documents et vidéos générés" },
  { to: "/copies", label: "Copies", icon: PencilSquareIcon, hint: "PDF remplis sur l'écran, envoyés en correction" },
  { to: "/corrections", label: "Corrections", icon: CheckBadgeIcon, hint: "Vos exercices photographiés" },
  { to: "/profile", label: "Profil", icon: UserCircleIcon, hint: "Points forts, points faibles" },
];
export const ETUDES: NavItem[] = [
  { to: "/studies", label: "Plan d'études", icon: AcademicCapIcon, hint: "Modules, unités, absences" },
  { to: "/grades", label: "Notes", icon: ChartBarIcon, hint: "Contrôle continu par module, bulletin" },
];

/** Routes shown without the phone's header and bottom bar: a card fills the screen and has its own way out. */
const FILLS = /^\/calendar(\/|$)/;
const IMMERSIVE = /^\/(study|quiz\/play|copies\/[^/]+)(\/|$)/;

const isUnder = (pathname: string, item: NavItem) => (item.to === "/" ? pathname === "/" : [item.to, ...(item.under ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`)));

export function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  const username = me?.name;
  const admin = me?.role === "admin";
  const [theme, setTheme] = useTheme();
  const [settings, setSettings] = useState(false);
  const location = useLocation();
  const immersive = IMMERSIVE.test(location.pathname);
  const reconnect = me?.campus.state === "expired" && location.pathname !== "/account";

  const sideLink = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => cx("flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm font-medium transition-colors", isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
      <item.icon className="h-5 w-5 shrink-0" />
      {item.label}
    </NavLink>
  );

  return (
    <div className="h-full md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden md:flex flex-col border-r border-line bg-surface h-full min-h-0">
        <div className="px-4 h-14 flex items-center gap-2 border-b border-line shrink-0">
          <img src="/favicon.svg" alt="" className="h-7 w-7 rounded-md" />
          <span className="font-semibold tracking-tight">HEIG-Kit</span>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto py-3 px-2 space-y-0.5">
          {TABS.slice(0, 2).map(sideLink)}
          <div className="pt-3 pb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Révision</div>
          {REVISION.map(sideLink)}
          <div className="pt-3 pb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Études</div>
          {ETUDES.map(sideLink)}
        </nav>
        <div className="border-t border-line p-2 shrink-0">
          <button onClick={() => setSettings(true)} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
            <Cog6ToothIcon className="h-5 w-5 shrink-0" />
            <span className="flex-1 text-left truncate">{username}</span>
          </button>
        </div>
      </aside>

      <div className="h-full flex flex-col min-w-0 min-h-0">
        {/* The safe area is padding outside the 3rem row, so the band keeps its height under a translucent status bar. */}
        {!immersive && (
          <header className="md:hidden shrink-0 pt-safe bg-surface border-b border-line">
            <div className="h-12 flex items-center justify-between px-4">
              <span className="font-semibold tracking-tight">HEIG-Kit</span>
              <button onClick={() => setSettings(true)} aria-label="Réglages" className="h-9 w-9 -mr-1.5 grid place-items-center rounded-lg text-ink-2 hover:bg-surface-2">
                <Cog6ToothIcon className="h-5.5 w-5.5" />
              </button>
            </div>
          </header>
        )}
        {/* The only scrolling area of the app; it never chains its scroll to the document. */}
        <main className={cx("flex-1 min-h-0 w-full min-w-0 overscroll-y-contain", immersive ? "overflow-hidden" : "overflow-y-auto overflow-x-clip px-4 md:px-6 xl:px-8 pt-5 pb-12 md:pt-7 md:pb-16")}>
          {immersive ? (
            children
          ) : (
            // The calendar fills the height exactly; every other page grows, and the padding of <main> then follows its
            // last card instead of being swallowed above it.
            <div className={cx(FILLS.test(location.pathname) ? "h-full" : "min-h-full", "max-w-[1500px] mx-auto")}>
              {reconnect && (
                <NavLink to="/account" className="mb-4 rounded-xl border border-warn/40 bg-warn-soft text-warn px-4 py-3 text-sm flex items-center gap-2">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
                  <span className="flex-1">Votre session edu-ID a pris fin : horaires, notes et échéances ne se mettent plus à jour.</span>
                  <span className="font-medium underline">Reconnecter</span>
                </NavLink>
              )}
              {children}
            </div>
          )}
        </main>
        {!immersive && (
          <nav className="md:hidden shrink-0 bg-surface border-t border-line pb-safe">
            <div className="grid grid-cols-4">
              {TABS.map((item) => {
                const active = isUnder(location.pathname, item);
                return (
                  <NavLink key={item.to} to={item.to} className={cx("flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-medium", active ? "text-accent" : "text-ink-3")}>
                    <item.icon className="h-6 w-6" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          </nav>
        )}
      </div>

      <Drawer open={settings} onClose={() => setSettings(false)} title="Réglages">
        <div className="space-y-5">
          <div>
            <div className="text-xs font-medium text-ink-2 mb-1.5">Thème</div>
            <Segmented value={theme} onChange={setTheme} options={[{ value: "system", label: "Système" }, { value: "light", label: "Clair" }, { value: "dark", label: "Sombre" }]} />
          </div>
          <NavLink to="/account" onClick={() => setSettings(false)} className={({ isActive }) => cx("flex items-center gap-2.5 rounded-lg px-2.5 h-10 text-sm font-medium", isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
            <UserCircleIcon className="h-5 w-5" /> Mon compte
          </NavLink>
          {admin && (
            <>
              <NavLink to="/status" onClick={() => setSettings(false)} className={({ isActive }) => cx("flex items-center gap-2.5 rounded-lg px-2.5 h-10 text-sm font-medium", isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
                <SignalIcon className="h-5 w-5" /> Statut du serveur
              </NavLink>
              <NavLink to="/journal" onClick={() => setSettings(false)} className={({ isActive }) => cx("flex items-center gap-2.5 rounded-lg px-2.5 h-10 text-sm font-medium", isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
                <ClipboardDocumentListIcon className="h-5 w-5" /> Journal des comptes
              </NavLink>
            </>
          )}
          <div className="border-t border-line pt-4">
            <div className="text-xs text-ink-3 mb-2">Connecté en tant que <span className="font-medium text-ink">{username}</span> ({me?.email})</div>
            <button onClick={() => void logout()} className="flex items-center gap-2.5 rounded-lg border border-line px-3 h-10 text-sm font-medium text-ink-2 hover:bg-surface-2 w-full">
              <ArrowRightStartOnRectangleIcon className="h-5 w-5" /> Se déconnecter
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
