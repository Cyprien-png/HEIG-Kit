import { type FormEvent, useEffect, useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { fromLocalInput, toLocalInput } from "../../lib/format";
import type { Calendar, CalendarEvent, EventKind } from "../../lib/types";
import { KIND_LABEL } from "./shared";

/** The built-in calendar an event of a kind goes to when none is chosen (mirrors the server). */
const defaultSlug = (kind: EventKind) => (kind === "exam" ? "exams" : kind === "deadline" ? "deadlines" : "schedule");

export function EventEditor({ event, calendars, defaultDay, defaultCalendar, onClose, onSaved }: { event?: CalendarEvent; calendars: Calendar[]; defaultDay: string; defaultCalendar?: number; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<EventKind>(event?.kind ?? "event");
  const [calendarId, setCalendarId] = useState<number | "">(event?.calendarId ?? defaultCalendar ?? "");
  const [title, setTitle] = useState(event?.title ?? "");
  const [course, setCourse] = useState(event?.course ?? "");
  const [start, setStart] = useState(toLocalInput(event?.startsAt) || `${defaultDay}T18:00`);
  const [end, setEnd] = useState(toLocalInput(event?.endsAt));
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [location, setLocation] = useState(event?.location ?? "");
  const [details, setDetails] = useState(event?.details ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(undefined), [title, start]);

  const target = calendarId === "" ? calendars.find((c) => c.slug === defaultSlug(kind)) : calendars.find((c) => c.id === calendarId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { kind, title: title.trim(), course: course.trim() || null, startsAt: fromLocalInput(start), endsAt: end ? fromLocalInput(end) : null, allDay, location: location.trim() || null, details: details.trim() || null, calendarId: calendarId === "" ? undefined : calendarId };
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
          <Field label="Calendrier">
            <Select value={calendarId} onChange={(e) => setCalendarId(e.target.value === "" ? "" : Number(e.target.value))} className="w-full">
              <option value="">Selon le type ({calendars.find((c) => c.slug === defaultSlug(kind))?.name ?? "…"})</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className="w-full">
              {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label="Titre">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="TE 2, rendu du labo 3, réviser les relations…" />
          </Field>
          <Field label="Cours">
            <Input value={course} onChange={(e) => setCourse(e.target.value.toUpperCase())} placeholder="MAD" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Fin (optionnel)">
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-accent" /> Toute la journée
          </label>
          {target && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: target.color }} /> {target.name}
            </span>
          )}
        </div>
        <Field label="Lieu">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="B01, chez moi…" />
        </Field>
        <Field label="Détails" hint="Markdown : listes, **gras**, formules $…$">
          <Textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)} className="font-mono text-[13px]" />
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
