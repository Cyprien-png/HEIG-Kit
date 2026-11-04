import { ArrowRightIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { excerpt } from "../components/Markdown";
import { Radar, type RadarAxis } from "../components/Radar";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { parseLessonCode } from "../lib/courses";
import { addDays, day, isoDay, time, today } from "../lib/format";
import type { CalendarEvent, Correction, Deck, PlanUnit, ProfileSummary, Snapshot, StatusReport, StudyStats } from "../lib/types";

const KIND_TONE = { lesson: "neutral", deadline: "warn", exam: "bad", event: "info" } as const;
const KIND_LABEL = { lesson: "cours", deadline: "rendu", exam: "examen", event: "événement" } as const;

export function EventRow({ e, showDay }: { e: CalendarEvent; showDay?: boolean }) {
  const title = e.kind === "lesson" ? parseLessonCode(e.title).label : e.title;
  return (
    <li className="flex items-start gap-3 py-2">
      <div className="w-[4.5rem] shrink-0 font-mono text-[13px] tabular-nums text-ink-2 pt-0.5">
        {showDay && <div className="text-[11px] uppercase text-ink-3">{day(e.startsAt)}</div>}
        {e.allDay ? "journée" : time(e.startsAt)}
        {e.endsAt && !e.allDay && <div className="text-ink-3">{time(e.endsAt)}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <CourseChip code={e.course} />
          <span className="text-sm font-medium min-w-0 break-words">{title}</span>
          {e.kind !== "lesson" && <Badge tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Badge>}
          {e.overridden && <Badge tone="info">modifié</Badge>}
        </div>
        {(e.location || e.details) && <div className="text-xs text-ink-2 mt-0.5 truncate">{[e.location, e.kind !== "lesson" && excerpt(e.details, 90)].filter(Boolean).join(" · ")}</div>}
      </div>
    </li>
  );
}

/** The units followed this semester (S1 from September to January, S2 otherwise), from the study plan. */
export function semesterCourses(plan: PlanUnit[] | undefined, now = new Date()): string[] {
  if (!plan?.length) return [];
  const followed = plan.filter((u) => u.status === "followed");
  const year = [...new Set(followed.map((u) => u.year))].sort().at(-1);
  const month = now.getMonth() + 1;
  const period = month >= 9 || month <= 1 ? "S1" : "S2";
  return followed.filter((u) => u.year === year && u.credits.some((c) => c.period === period && c.credits > 0)).map((u) => u.unit.code);
}

/** Strengths and weaknesses per course on a common scale: counts weighted by severity, relative to the largest. */
export function radarAxes(courses: string[], profile: ProfileSummary | undefined): RadarAxis[] {
  const weight = (list: { count: number; severity: number }[]) => list.reduce((s, t) => s + t.count * Math.max(1, t.severity), 0);
  const raw = courses.map((code) => {
    const c = profile?.courses.find((x) => x.course?.toUpperCase() === code.toUpperCase());
    return { label: code, strong: c ? weight(c.strengths) : 0, weak: c ? weight([...c.weaknesses, ...c.mistakes]) : 0 };
  });
  const max = Math.max(1, ...raw.flatMap((a) => [a.strong, a.weak]));
  return raw.map((a) => ({ label: a.label, strong: a.strong / max, weak: a.weak / max }));
}

export function Dashboard() {
  const from = today();
  const events = useApi<{ events: CalendarEvent[] }>(`/api/calendar?from=${from}&to=${addDays(from, 8)}&visible=true`, [], { refreshMs: 120_000 });
  const decks = useApi<{ decks: Deck[]; stats: StudyStats }>("/api/decks");
  const corrections = useApi<{ corrections: Correction[] }>("/api/corrections");
  const status = useApi<StatusReport>("/api/status", [], { refreshMs: 60_000 });
  const profile = useApi<ProfileSummary>("/api/profile");
  const plan = useApi<Snapshot<PlanUnit[]>>("/api/campus/plan");

  const all = events.data?.events ?? [];
  const todayEvents = all.filter((e) => isoDay(e.startsAt) === from);
  const deadlines = all.filter((e) => isoDay(e.startsAt) !== from && e.kind === "deadline");
  const open = (corrections.data?.corrections ?? []).filter((c) => c.state !== "corrected");
  const problems = status.data ? status.data.services.filter((s) => s.state === "down").length + (status.data.login.needsCode ? 1 : 0) : 0;

  const axes = useMemo(() => {
    const courses = semesterCourses(plan.data?.data);
    const fallback = (profile.data?.courses ?? []).map((c) => c.course).filter((c): c is string => Boolean(c));
    return radarAxes(courses.length ? courses : fallback, profile.data);
  }, [plan.data, profile.data]);
  const hasProfile = axes.some((a) => a.strong > 0 || a.weak > 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl md:text-2xl font-semibold tracking-tight capitalize">{new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Zurich" }).format(new Date())}</h1>

      {status.data?.login.needsCode && (
        <div className="rounded-xl border border-warn/40 bg-warn-soft text-warn px-4 py-3 text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" /> edu-ID demande un code de connexion : les données ne se mettent plus à jour.
          </span>
          <Link to="/status">
            <Button size="sm" variant="secondary">Reconnecter</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 md:gap-3">
        <Stat compact label="À réviser" value={decks.data?.stats.due ?? "–"} tone={decks.data && decks.data.stats.due > 0 ? "accent" : "neutral"} to="/study" />
        <Stat compact label="Rendus" value={deadlines.length} tone={deadlines.length > 0 ? "warn" : "neutral"} to="/calendar" />
        <Stat compact label="Corrections" value={open.length} to="/corrections" />
        <Stat compact label="Serveur" value={status.loading ? "…" : problems === 0 ? "OK" : problems} tone={problems === 0 ? "ok" : "bad"} to="/status" />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Card title="Points forts et faibles" className="lg:col-span-2" actions={<Link to="/profile" className="text-xs text-accent inline-flex items-center gap-1">Profil <ArrowRightIcon className="h-3 w-3" /></Link>}>
          {profile.loading || plan.loading ? (
            <Loading />
          ) : axes.length >= 3 ? (
            <Link to="/profile" className="block">
              <Radar axes={axes} />
              <div className="flex items-center justify-center gap-4 text-xs text-ink-2 mt-1">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ok" /> points forts</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-bad" /> points faibles</span>
              </div>
              {!hasProfile && <p className="text-xs text-ink-3 text-center mt-2">Encore vide : faites corriger vos exercices pour le remplir.</p>}
            </Link>
          ) : (
            <Empty title="Pas encore de profil" hint="Faites corriger vos exercices : chaque correction note vos points forts et vos erreurs par cours." action={<Link to="/profile"><Button size="sm">Profil</Button></Link>} />
          )}
        </Card>

        <Card title="Aujourd'hui" className="lg:col-span-3" actions={<Link to="/calendar" className="text-xs text-accent inline-flex items-center gap-1">Calendrier <ArrowRightIcon className="h-3 w-3" /></Link>} padded={false}>
          {events.loading ? <Loading /> : events.error ? <div className="p-4"><ErrorBox error={events.error} retry={events.reload} /></div> : todayEvents.length === 0 ? <Empty title="Rien aujourd'hui" hint="Pas de cours ni de rendu." /> : (
            <ul className="divide-y divide-line px-4">
              {todayEvents.map((e) => <EventRow key={e.key} e={e} />)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
