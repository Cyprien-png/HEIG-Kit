import { ArrowPathIcon, BookOpenIcon, ClockIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { CourseChip } from "../../components/CourseChip";
import { Markdown } from "../../components/Markdown";
import { Badge, Button, Loading, Modal } from "../../components/ui";
import { api, useApi } from "../../lib/api";
import { parseLessonCode } from "../../lib/courses";
import { dateTime, day, isoDay, time } from "../../lib/format";
import type { Calendar, CalendarEvent } from "../../lib/types";
import { KIND_LABEL, KIND_TONE, detailsMarkdown, eventTitle, sourceLabel } from "./shared";

/** One calendar as a small colored chip. */
export function CalendarChip({ calendar }: { calendar?: Calendar }) {
  if (!calendar) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-1.5 h-6 text-xs font-medium text-ink-2">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: calendar.color }} />
      {calendar.name}
    </span>
  );
}

export function EventSheet({ event, calendars, onClose, onEdit, onChanged }: { event?: CalendarEvent; calendars: Map<number, Calendar>; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
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
  const calendar = calendars.get(event.calendarId);
  const details = detailsMarkdown(event);
  const when = event.allDay ? day(event.startsAt) : `${dateTime(event.startsAt)}${event.endsAt ? ` → ${isoDay(event.endsAt) === isoDay(event.startsAt) ? time(event.endsAt) : dateTime(event.endsAt)}` : ""}`;

  return (
    <Modal open onClose={onClose} title={eventTitle(event, parseLessonCode)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarChip calendar={calendar} />
          <CourseChip code={event.course} />
          <Badge tone={KIND_TONE[event.kind]}>{KIND_LABEL[event.kind]}</Badge>
          <Badge>{sourceLabel(event)}</Badge>
          {event.overridden && <Badge tone="info">modifié à la main</Badge>}
        </div>

        <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <ClockIcon className="h-4 w-4 text-ink-3 shrink-0" /> {when}
          </div>
          {event.location && (
            <div className="flex items-center gap-2 text-ink-2">
              <MapPinIcon className="h-4 w-4 text-ink-3 shrink-0" /> {event.location}
            </div>
          )}
        </div>

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

        {details && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-1.5 flex items-center gap-1">
              <BookOpenIcon className="h-3.5 w-3.5" /> {event.kind === "lesson" || (event.kind === "exam" && event.source === "gaps") ? "Au programme (Cyberlearn)" : "Détails"}
            </h3>
            <Markdown source={details} className="text-sm" />
          </section>
        )}
        {event.kind === "lesson" && !details && <p className="text-sm text-ink-3">Rien d'annoncé sur Cyberlearn pour cette leçon.</p>}

        {event.url && (
          <a href={event.url} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent underline underline-offset-2 break-all">
            Ouvrir sur Cyberlearn
          </a>
        )}

        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-3 flex items-center gap-1 select-none">
            <ClockIcon className="h-3.5 w-3.5" /> Historique
            <span className="font-mono normal-case tracking-normal text-ink-3 ml-1 break-all">{event.key}</span>
          </summary>
          <div className="mt-2">
            {history.loading ? <Loading /> : (
              <ol className="space-y-1.5 text-xs">
                {(history.data?.versions ?? []).map((v, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-ink-3 tabular-nums shrink-0">{dateTime(v.fetchedAt)}</span>
                    <span className="text-ink-2">
                      {v.source === "manual" ? (v.author === "agent" ? "agent" : "vous") : v.source === "gaps" ? "GAPS" : "Cyberlearn"} · {v.deleted ? "supprimé" : `${dateTime(v.startsAt)}${v.location ? ` @ ${v.location}` : ""}`}
                      {v.calendarId !== event.calendarId && ` · ${calendars.get(v.calendarId)?.name ?? "autre calendrier"}`}
                      {i === 0 && <span className="text-accent"> (version affichée)</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
}
