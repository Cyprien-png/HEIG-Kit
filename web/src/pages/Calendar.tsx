import { ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, PlusIcon } from "@heroicons/react/24/outline";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { CourseChip } from "../components/CourseChip";
import { Badge, Button, Card, Empty, ErrorBox, Field, IconButton, Input, Loading, Modal, Segmented, Select, Textarea, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { useIsDark } from "../lib/auth";
import { courseColor, parseLessonCode } from "../lib/courses";
import { F, addDays, dateTime, day, fromLocalInput, isoDay, minutesOfDay, mondayOf, time, toLocalInput, today } from "../lib/format";
import type { CalendarEvent, EventKind } from "../lib/types";
import { EventRow } from "./Dashboard";

type View = "week" | "month" | "agenda";
const KIND_LABEL: Record<EventKind, string> = { lesson: "cours", deadline: "rendu", exam: "examen", event: "événement" };
const KIND_TONE = { lesson: "neutral", deadline: "warn", exam: "bad", event: "info" } as const;

function useStoredView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      const saved = localStorage.getItem("heig-calendar-view") as View | null;
      if (saved) return saved;
    } catch {
      // Private window.
    }
    return window.innerWidth < 768 ? "agenda" : "week";
  });
  const set = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("heig-calendar-view", v);
    } catch {
      // Private window.
    }
  };
  return [view, set];
}

export function Calendar() {
  const [view, setView] = useStoredView();
  const [anchor, setAnchor] = useState(today());
  const [selected, setSelected] = useState<CalendarEvent>();
  const [editing, setEditing] = useState<CalendarEvent | "new">();

  const range = useMemo(() => {
    if (view === "week") {
      const monday = mondayOf(anchor);
      return { from: monday, to: addDays(monday, 7), label: `Semaine du ${day(monday + "T12:00:00")}` };
    }
    if (view === "month") {
      const first = `${anchor.slice(0, 7)}-01`;
      const start = mondayOf(first);
      return { from: start, to: addDays(start, 42), label: F.monthYear.format(new Date(`${first}T12:00:00`)) };
    }
    return { from: anchor, to: addDays(anchor, 21), label: `3 semaines dès le ${day(anchor + "T12:00:00")}` };
  }, [view, anchor]);

  const events = useApi<{ events: CalendarEvent[] }>(`/api/calendar?from=${range.from}&to=${range.to}`, [], { refreshMs: 300_000 });
  const list = events.data?.events ?? [];

  const move = (direction: 1 | -1) => {
    if (view === "week") setAnchor(addDays(anchor, 7 * direction));
    else if (view === "month") {
      const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + direction);
      setAnchor(d.toISOString().slice(0, 10));
    } else setAnchor(addDays(anchor, 7 * direction));
  };

  const onSaved = () => {
    setEditing(undefined);
    setSelected(undefined);
    void events.reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton label="Précédent" onClick={() => move(-1)}>
            <ChevronLeftIcon className="h-5 w-5" />
          </IconButton>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(today())}>
            Aujourd'hui
          </Button>
          <IconButton label="Suivant" onClick={() => move(1)}>
            <ChevronRightIcon className="h-5 w-5" />
          </IconButton>
          <h1 className="text-lg md:text-xl font-semibold tracking-tight ml-2 capitalize">{range.label}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={view} onChange={setView} options={[{ value: "week", label: "Semaine" }, { value: "month", label: "Mois" }, { value: "agenda", label: "Agenda" }]} />
          <Button variant="primary" size="md" onClick={() => setEditing("new")}>
            <PlusIcon className="h-4 w-4" /> <span className="hidden sm:inline">Ajouter</span>
          </Button>
        </div>
      </div>

      {events.error && <ErrorBox error={events.error} retry={events.reload} />}
      {events.loading && !events.data ? <Loading /> : view === "week" ? <WeekView from={range.from} events={list} onSelect={setSelected} /> : view === "month" ? <MonthView from={range.from} month={anchor.slice(0, 7)} events={list} onSelect={setSelected} onDay={(d) => { setAnchor(d); setView("agenda"); }} /> : <AgendaView events={list} onSelect={setSelected} />}

      <EventSheet event={selected} onClose={() => setSelected(undefined)} onEdit={() => setEditing(selected)} onChanged={onSaved} />
      {editing && <EventEditor event={editing === "new" ? undefined : editing} defaultDay={anchor} onClose={() => setEditing(undefined)} onSaved={onSaved} />}
    </div>
  );
}

const HOUR_START = 7;
const HOUR_END = 21;
const HOUR_PX = 52;

function WeekView({ from, events, onSelect }: { from: string; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const dark = useIsDark();
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const visibleDays = days.slice(0, 6).filter((d, i) => i < 5 || events.some((e) => isoDay(e.startsAt) === d));
  const timed = events.filter((e) => !e.allDay && e.endsAt);
  const allDay = events.filter((e) => e.allDay || !e.endsAt);
  const now = new Date();
  const nowDay = isoDay(now);
  const nowTop = ((minutesOfDay(now) - HOUR_START * 60) / 60) * HOUR_PX;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid border-b border-line" style={{ gridTemplateColumns: `3.25rem repeat(${visibleDays.length}, minmax(0, 1fr))` }}>
            <div />
            {visibleDays.map((d) => (
              <div key={d} className={cx("px-2 py-2 text-center border-l border-line", d === nowDay && "bg-accent-soft/40")}>
                <div className="text-[11px] uppercase tracking-wide text-ink-3">{F.weekday.format(new Date(`${d}T12:00:00`))}</div>
                <div className={cx("text-lg font-semibold tabular-nums leading-6", d === nowDay && "text-accent")}>{F.dayNumber.format(new Date(`${d}T12:00:00`))}</div>
                <div className="mt-1 space-y-1">
                  {allDay.filter((e) => isoDay(e.startsAt) === d).map((e) => (
                    <button key={e.key} onClick={() => onSelect(e)} className={cx("w-full text-left rounded-md px-1.5 py-0.5 text-[11px] font-medium truncate border-l-2", e.kind === "exam" ? "bg-bad-soft text-bad border-bad" : e.kind === "deadline" ? "bg-warn-soft text-warn border-warn" : "bg-info-soft text-info border-info")}>
                      {e.endsAt ? "" : `${time(e.startsAt)} `}{e.course ? `${e.course} · ` : ""}{e.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="grid relative" style={{ gridTemplateColumns: `3.25rem repeat(${visibleDays.length}, minmax(0, 1fr))`, height: (HOUR_END - HOUR_START) * HOUR_PX }}>
            <div className="relative">
              {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                <div key={i} className="absolute right-2 -translate-y-1/2 font-mono text-[11px] text-ink-3 tabular-nums" style={{ top: i * HOUR_PX }}>
                  {i === 0 ? "" : `${String(HOUR_START + i).padStart(2, "0")}:00`}
                </div>
              ))}
            </div>
            {visibleDays.map((d) => {
              const dayEvents = timed.filter((e) => isoDay(e.startsAt) === d);
              return (
                <div key={d} className={cx("relative border-l border-line", d === nowDay && "bg-accent-soft/20")}>
                  {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                    <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} />
                  ))}
                  {d === nowDay && nowTop > 0 && nowTop < (HOUR_END - HOUR_START) * HOUR_PX && <div className="absolute inset-x-0 h-px bg-bad z-10" style={{ top: nowTop }}><span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-bad" /></div>}
                  {dayEvents.map((e) => {
                    const start = minutesOfDay(e.startsAt);
                    const end = minutesOfDay(e.endsAt!);
                    const top = ((start - HOUR_START * 60) / 60) * HOUR_PX;
                    const height = Math.max(((end - start) / 60) * HOUR_PX, 22);
                    const code = parseLessonCode(e.title);
                    const color = courseColor(e.course);
                    const overlapping = dayEvents.filter((o) => o !== e && minutesOfDay(o.startsAt) < end && minutesOfDay(o.endsAt!) > start);
                    const index = overlapping.filter((o) => o.key < e.key).length;
                    const width = 100 / (overlapping.length + 1);
                    return (
                      <button
                        key={e.key}
                        onClick={() => onSelect(e)}
                        style={{ top, height, left: `calc(${index * width}% + 2px)`, width: `calc(${width}% - 4px)`, backgroundColor: color.soft, borderColor: color.bg, color: dark ? color.textDark : color.text }}
                        className={cx("absolute rounded-md border-l-[3px] px-1.5 py-1 text-left overflow-hidden hover:brightness-95 dark:hover:brightness-110 transition", e.kind === "exam" && "ring-1 ring-bad")}
                      >
                        <div className="text-[12px] font-semibold leading-4 truncate">{e.kind === "lesson" ? code.label : e.title}</div>
                        {height > 34 && <div className="text-[11px] opacity-80 truncate">{e.location}{e.overridden ? " · modifié" : ""}</div>}
                        {height > 50 && <div className="text-[11px] opacity-70 font-mono">{time(e.startsAt)}–{time(e.endsAt!)}</div>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function MonthView({ from, month, events, onSelect, onDay }: { from: string; month: string; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void; onDay: (d: string) => void }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const weeks = days.slice(35).some((d) => d.startsWith(month)) ? 6 : 5;
  const nowDay = today();
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line text-[11px] uppercase tracking-wide text-ink-3">
        {["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.slice(0, weeks * 7).map((d) => {
          const inMonth = d.startsWith(month);
          const dayEvents = events.filter((e) => isoDay(e.startsAt) === d);
          const lessons = dayEvents.filter((e) => e.kind === "lesson");
          const others = dayEvents.filter((e) => e.kind !== "lesson");
          return (
            <div key={d} className={cx("min-h-[5.5rem] md:min-h-[7rem] border-b border-r border-line p-1 md:p-1.5", !inMonth && "bg-surface-2/50 text-ink-3")}>
              <button onClick={() => onDay(d)} className={cx("h-6 w-6 grid place-items-center rounded-full text-xs font-semibold tabular-nums", d === nowDay && "bg-accent text-accent-ink")}>
                {Number(d.slice(8))}
              </button>
              <div className="mt-1 space-y-0.5">
                {others.slice(0, 3).map((e) => (
                  <button key={e.key} onClick={() => onSelect(e)} className={cx("w-full text-left rounded px-1 py-0.5 text-[11px] font-medium truncate border-l-2", e.kind === "exam" ? "bg-bad-soft text-bad border-bad" : e.kind === "deadline" ? "bg-warn-soft text-warn border-warn" : "bg-info-soft text-info border-info")}>
                    {e.course ? `${e.course} · ` : ""}{e.title}
                  </button>
                ))}
                {others.length > 3 && <div className="text-[11px] text-ink-3 px-1">+{others.length - 3}</div>}
                {lessons.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 px-0.5 pt-0.5">
                    {[...new Set(lessons.map((l) => l.course))].map((c) => (
                      <span key={c} title={c} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: courseColor(c).bg }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AgendaView({ events, onSelect }: { events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(isoDay(e.startsAt), [...(byDay.get(isoDay(e.startsAt)) ?? []), e]);
  if (byDay.size === 0) return <Empty title="Rien dans cette période" />;
  const nowDay = today();
  return (
    <div className="space-y-3">
      {[...byDay.entries()].map(([d, list]) => (
        <Card key={d} padded={false}>
          <div className={cx("px-4 py-2 border-b border-line text-sm font-semibold capitalize flex items-center gap-2", d === nowDay && "text-accent")}>
            {F.dayLong.format(new Date(`${d}T12:00:00`))}
            {d === nowDay && <Badge tone="accent">aujourd'hui</Badge>}
          </div>
          <ul className="px-4 divide-y divide-line">
            {list.map((e) => (
              <button key={e.key} onClick={() => onSelect(e)} className="w-full text-left hover:bg-surface-2 -mx-4 px-4">
                <EventRow e={e} />
              </button>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function EventSheet({ event, onClose, onEdit, onChanged }: { event?: CalendarEvent; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const history = useApi<{ versions: CalendarEvent[] }>(event ? `/api/calendar/events/${encodeURIComponent(event.key)}/history` : null, [event?.key]);
  const [busy, setBusy] = useState(false);
  if (!event) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const remove = () => confirm("Retirer cet événement du calendrier ?") && run(() => api(`/api/calendar/events/${encodeURIComponent(event.key)}`, { method: "DELETE" }));
  const reset = () => run(() => api(`/api/calendar/events/${encodeURIComponent(event.key)}/reset`, { method: "POST" }));
  const sourceLabel = { gaps: "GAPS", cyberlearn: "Cyberlearn", manual: "ajouté à la main" }[event.source];
  return (
    <Modal open onClose={onClose} title={event.kind === "lesson" ? parseLessonCode(event.title).label : event.title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <CourseChip code={event.course} />
          <Badge tone={KIND_TONE[event.kind]}>{KIND_LABEL[event.kind]}</Badge>
          <Badge>{event.key.startsWith("manual:") ? "manuel" : sourceLabel}</Badge>
          {event.overridden && <Badge tone="info">modifié à la main</Badge>}
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-ink-3">Quand</dt>
          <dd className="font-medium">
            {event.allDay ? day(event.startsAt) : dateTime(event.startsAt)}
            {event.endsAt && !event.allDay ? ` → ${isoDay(event.endsAt) === isoDay(event.startsAt) ? time(event.endsAt) : dateTime(event.endsAt)}` : ""}
          </dd>
          {event.location && (
            <>
              <dt className="text-ink-3">Lieu</dt>
              <dd>{event.location}</dd>
            </>
          )}
          {event.details && (
            <>
              <dt className="text-ink-3">Détails</dt>
              <dd className="whitespace-pre-wrap text-ink-2">{event.details}</dd>
            </>
          )}
          {event.url && (
            <>
              <dt className="text-ink-3">Lien</dt>
              <dd>
                <a href={event.url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 break-all">
                  Ouvrir sur Cyberlearn
                </a>
              </dd>
            </>
          )}
          <dt className="text-ink-3">Clé</dt>
          <dd className="font-mono text-[12px] text-ink-2 break-all">{event.key}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onEdit} disabled={busy}>
            Modifier
          </Button>
          {event.overridden && (
            <Button onClick={reset} disabled={busy}>
              <ArrowPathIcon className="h-4 w-4" /> Revenir à la source
            </Button>
          )}
          <Button variant="danger" onClick={remove} disabled={busy}>
            Retirer
          </Button>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2 flex items-center gap-1">
            <ClockIcon className="h-3.5 w-3.5" /> Historique
          </h3>
          {history.loading ? <Loading /> : (
            <ol className="space-y-1.5 text-xs">
              {(history.data?.versions ?? []).map((v, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-ink-3 tabular-nums shrink-0">{dateTime(v.fetchedAt)}</span>
                  <span className="text-ink-2">
                    {v.source === "manual" ? (v.author === "agent" ? "agent" : "vous") : v.source === "gaps" ? "GAPS" : "Cyberlearn"} · {v.deleted ? "supprimé" : `${dateTime(v.startsAt)}${v.location ? ` @ ${v.location}` : ""}`}
                    {i === 0 && <span className="text-accent"> (version affichée)</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

function EventEditor({ event, defaultDay, onClose, onSaved }: { event?: CalendarEvent; defaultDay: string; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<EventKind>(event?.kind ?? "event");
  const [title, setTitle] = useState(event?.title ?? "");
  const [course, setCourse] = useState(event?.course ?? "");
  const [start, setStart] = useState(toLocalInput(event?.startsAt) || `${defaultDay}T08:30`);
  const [end, setEnd] = useState(toLocalInput(event?.endsAt));
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [location, setLocation] = useState(event?.location ?? "");
  const [details, setDetails] = useState(event?.details ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(undefined), [title, start]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { kind, title: title.trim(), course: course.trim() || null, startsAt: fromLocalInput(start), endsAt: end ? fromLocalInput(end) : null, allDay, location: location.trim() || null, details: details.trim() || null };
      if (event) await api(`/api/calendar/events/${encodeURIComponent(event.key)}`, { method: "PATCH", json: body });
      else await api("/api/calendar/events", { method: "POST", json: { ...body, course: body.course ?? undefined, endsAt: body.endsAt ?? undefined, location: body.location ?? undefined, details: body.details ?? undefined } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={event ? "Modifier l'événement" : "Nouvel événement"}>
      <form onSubmit={submit} className="space-y-3">
        {event && !event.key.startsWith("manual:") && <p className="text-xs text-ink-2 bg-surface-2 rounded-lg px-3 py-2">Cet événement vient de {event.source === "gaps" ? "GAPS" : "Cyberlearn"}. Votre version sera affichée jusqu'à ce que la source change à nouveau.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className="w-full">
              {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Cours">
            <Input value={course} onChange={(e) => setCourse(e.target.value.toUpperCase())} placeholder="MAD" />
          </Field>
        </div>
        <Field label="Titre">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="TE 2, rendu du labo 3…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Fin (optionnel)">
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-accent" /> Toute la journée
        </label>
        <Field label="Lieu">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="B01" />
        </Field>
        <Field label="Détails">
          <Textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
