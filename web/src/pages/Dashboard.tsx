import { ArrowRightIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { excerpt } from "../components/Markdown";
import { Badge, Button, Card, Dot, Empty, ErrorBox, Loading, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { parseLessonCode } from "../lib/courses";
import { addDays, day, isoDay, relative, time, today } from "../lib/format";
import type { CalendarEvent, Correction, Deck, StatusReport, StudyStats } from "../lib/types";

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
          <span className="text-sm font-medium truncate">{title}</span>
          {e.kind !== "lesson" && <Badge tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Badge>}
          {e.overridden && <Badge tone="info">modifié</Badge>}
        </div>
        {(e.location || e.details) && <div className="text-xs text-ink-2 mt-0.5 truncate">{[e.location, e.kind !== "lesson" && excerpt(e.details, 90)].filter(Boolean).join(" · ")}</div>}
      </div>
    </li>
  );
}

export function Dashboard() {
  const from = today();
  const events = useApi<{ events: CalendarEvent[] }>(`/api/calendar?from=${from}&to=${addDays(from, 8)}&visible=true`, [], { refreshMs: 120_000 });
  const decks = useApi<{ decks: Deck[]; stats: StudyStats }>("/api/decks");
  const corrections = useApi<{ corrections: Correction[] }>("/api/corrections");
  const status = useApi<StatusReport>("/api/status", [], { refreshMs: 60_000 });

  const all = events.data?.events ?? [];
  const todayEvents = all.filter((e) => isoDay(e.startsAt) === from);
  const upcoming = all.filter((e) => isoDay(e.startsAt) !== from && e.kind !== "lesson");
  const exams = all.filter((e) => e.kind === "exam");
  const open = (corrections.data?.corrections ?? []).filter((c) => c.state !== "corrected");
  const recent = (corrections.data?.corrections ?? []).filter((c) => c.state === "corrected").slice(0, 3);
  const problems = status.data ? status.data.services.filter((s) => s.state === "down").length + (status.data.login.needsCode ? 1 : 0) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight capitalize">{new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Zurich" }).format(new Date())}</h1>
        <p className="text-sm text-ink-2 mt-0.5">
          {todayEvents.filter((e) => e.kind === "lesson").length} cours aujourd'hui · {upcoming.filter((e) => e.kind === "deadline").length} rendus cette semaine · {exams.length} examen{exams.length > 1 ? "s" : ""} à venir
        </p>
      </div>

      {status.data?.login.needsCode && (
        <div className="rounded-xl border border-warn/40 bg-warn-soft text-warn px-4 py-3 text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" /> edu-ID demande un code de connexion : les données ne se mettent plus à jour.
          </span>
          <Link to="/status">
            <Button size="sm" variant="secondary">
              Reconnecter
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Cartes à réviser" value={decks.data?.stats.due ?? "–"} hint={decks.data ? `${decks.data.stats.fresh} nouvelles · ${decks.data.stats.reviewedToday} vues aujourd'hui` : undefined} tone={decks.data && decks.data.stats.due > 0 ? "accent" : "neutral"} to="/study" />
        <Stat label="Rendus (8 jours)" value={upcoming.filter((e) => e.kind === "deadline").length} hint={upcoming.find((e) => e.kind === "deadline") ? `prochain ${relative(upcoming.find((e) => e.kind === "deadline")!.startsAt)}` : "rien d'urgent"} tone={upcoming.some((e) => e.kind === "deadline") ? "warn" : "neutral"} to="/calendar" />
        <Stat label="Corrections en attente" value={open.length} hint={open[0] ? open[0].title : "aucune"} to="/corrections" />
        <Stat label="Serveur" value={status.loading ? "…" : problems === 0 ? "OK" : `${problems} alerte${problems > 1 ? "s" : ""}`} hint={status.data ? `synchro ${relative(status.data.login.lastGapsOk)}` : status.error} tone={problems === 0 ? "ok" : "bad"} to="/status" />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Card title="Aujourd'hui" className="lg:col-span-2" actions={<Link to="/calendar" className="text-xs text-accent inline-flex items-center gap-1">Calendrier <ArrowRightIcon className="h-3 w-3" /></Link>} padded={false}>
          {events.loading ? <Loading /> : events.error ? <div className="p-4"><ErrorBox error={events.error} retry={events.reload} /></div> : todayEvents.length === 0 ? <Empty title="Rien aujourd'hui" hint="Pas de cours ni de rendu." /> : (
            <ul className="divide-y divide-line px-4">
              {todayEvents.map((e) => <EventRow key={e.key} e={e} />)}
            </ul>
          )}
        </Card>

        <Card title="À venir (8 jours)" className="lg:col-span-3" padded={false}>
          {events.loading ? <Loading /> : upcoming.length === 0 ? <Empty title="Rien à rendre" hint="Aucun rendu ni examen dans les huit prochains jours." /> : (
            <ul className="divide-y divide-line px-4">
              {upcoming.slice(0, 8).map((e) => <EventRow key={e.key} e={e} showDay />)}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Paquets de cartes" actions={<Link to="/cards" className="text-xs text-accent">Tout voir</Link>} padded={false}>
          {decks.loading ? <Loading /> : !decks.data || decks.data.decks.length === 0 ? <Empty title="Pas encore de cartes" hint="Demandez à l'agent : « crée-moi des cartes de révision sur le chapitre 1 de MAD »." /> : (
            <ul className="divide-y divide-line">
              {decks.data.decks.slice(0, 5).map((d) => (
                <li key={d.id}>
                  <Link to={`/cards/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <CourseChip code={d.course} link={false} />
                    <span className="flex-1 text-sm font-medium truncate">{d.title}</span>
                    <span className="text-xs text-ink-2 tabular-nums">{d.due > 0 ? <span className="text-accent font-semibold">{d.due} dues</span> : `${d.cards} cartes`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Dernières corrections" actions={<Link to="/corrections" className="text-xs text-accent">Tout voir</Link>} padded={false}>
          {corrections.loading ? <Loading /> : recent.length === 0 && open.length === 0 ? <Empty title="Aucune correction" hint="Demandez à l'agent de corriger vos exercices : il vous donnera un QR code à scanner." /> : (
            <ul className="divide-y divide-line">
              {[...open, ...recent].slice(0, 5).map((c) => {
                const ex = c.result?.exercises ?? [];
                const ok = ex.filter((e) => e.verdict === "correct").length;
                return (
                  <li key={c.id}>
                    <Link to={`/corrections/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <Dot tone={c.state === "corrected" ? "ok" : c.state === "received" ? "warn" : "neutral"} />
                      <CourseChip code={c.course} link={false} />
                      <span className="flex-1 text-sm font-medium truncate">{c.title}</span>
                      <span className="text-xs text-ink-2 tabular-nums">{c.state === "corrected" ? `${ok}/${ex.length} justes` : c.state === "received" ? "à corriger" : "photos attendues"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
