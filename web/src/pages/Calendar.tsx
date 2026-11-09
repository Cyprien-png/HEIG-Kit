import { ArrowPathIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, Squares2X2Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorBox, IconButton, Loading, Modal, Segmented, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { F, addDays, day, mondayOf, today } from "../lib/format";
import type { Calendar as CalendarLayer, CalendarEvent } from "../lib/types";
import { CalendarEditor, CalendarsPanel } from "./calendar/CalendarsPanel";
import { EventEditor } from "./calendar/EventEditor";
import { EventSheet } from "./calendar/EventSheet";
import { AgendaView, MonthView, WeekView } from "./calendar/views";

type View = "week" | "month" | "agenda";

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

/** The calendar page: it fills the viewport (no page scroll), with the calendars (layers) beside the week, month or agenda. */
export function Calendar() {
  const [view, setView] = useStoredView();
  const [anchor, setAnchor] = useState(today());
  const [selected, setSelected] = useState<CalendarEvent>();
  const [editing, setEditing] = useState<CalendarEvent | "new">();
  const [editingCalendar, setEditingCalendar] = useState<CalendarLayer | "new">();
  const [layersOpen, setLayersOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const [syncOutcome, setSyncOutcome] = useState<"ok" | "failed">();
  const outcomeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(outcomeTimer.current), []);
  /** Shows a check or a cross on the refresh button for a few seconds. */
  const flashOutcome = (outcome: "ok" | "failed") => {
    clearTimeout(outcomeTimer.current);
    setSyncOutcome(outcome);
    outcomeTimer.current = setTimeout(() => setSyncOutcome(undefined), 2500);
  };

  const range = useMemo(() => {
    if (view === "week") {
      const monday = mondayOf(anchor);
      return { from: monday, to: addDays(monday, 7), label: `semaine du ${day(monday + "T12:00:00")}` };
    }
    if (view === "month") {
      const first = `${anchor.slice(0, 7)}-01`;
      const start = mondayOf(first);
      return { from: start, to: addDays(start, 42), label: F.monthYear.format(new Date(`${first}T12:00:00`)) };
    }
    return { from: anchor, to: addDays(anchor, 21), label: `dès le ${day(anchor + "T12:00:00")}` };
  }, [view, anchor]);

  const layers = useApi<{ calendars: CalendarLayer[] }>("/api/calendars");
  const events = useApi<{ events: CalendarEvent[] }>(`/api/calendar?from=${range.from}&to=${range.to}`, [], { refreshMs: 300_000 });
  const calendars = useMemo(() => layers.data?.calendars ?? [], [layers.data]);
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of events.data?.events ?? []) map.set(e.calendarId, (map.get(e.calendarId) ?? 0) + 1);
    return map;
  }, [events.data]);
  const shown = useMemo(() => (events.data?.events ?? []).filter((e) => byId.get(e.calendarId)?.visible !== false), [events.data, byId]);

  const move = useCallback(
    (direction: 1 | -1) => {
      if (view === "month") {
        const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + direction);
        setAnchor(d.toISOString().slice(0, 10));
      } else setAnchor(addDays(anchor, 7 * direction));
    },
    [view, anchor],
  );

  // Keyboard: arrows move, T goes back to today, N adds an event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selected || editing || editingCalendar || layersOpen || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "t" || e.key === "T") setAnchor(today());
      else if (e.key === "n" || e.key === "N") setEditing("new");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, selected, editing, editingCalendar, layersOpen]);

  const reloadAll = () => {
    void layers.reload();
    void events.reload();
  };
  /** Fetches GAPS and Cyberlearn again on the server, then shows the fresh events: the page never shows a stale copy by mistake. */
  const refresh = async () => {
    setSyncing(true);
    setSyncError(undefined);
    setSyncOutcome(undefined);
    try {
      for (const kind of ["gaps", "cyberlearn"]) {
        const { run } = await api<{ run: { ok: boolean; message?: string } }>("/api/status/sync", { method: "POST", json: { kind } });
        if (!run.ok) throw new Error(run.message ?? `La synchronisation ${kind} a échoué`);
      }
      flashOutcome("ok");
    } catch (e) {
      flashOutcome("failed");
      const message = e instanceof Error ? e.message : String(e);
      setSyncError(/two-step|code/i.test(message) ? "edu-ID demande un code de connexion : reconnectez-vous depuis la page Statut." : message);
    } finally {
      setSyncing(false);
      reloadAll();
    }
  };
  const onSaved = () => {
    setEditing(undefined);
    setSelected(undefined);
    void events.reload();
  };
  const toggle = async (calendar: CalendarLayer, visible: boolean) => {
    await api(`/api/calendars/${calendar.id}`, { method: "PATCH", json: { visible } });
    void layers.reload();
  };
  const solo = async (calendar: CalendarLayer) => {
    const alone = calendars.every((c) => c.visible === (c.id === calendar.id));
    await Promise.all(calendars.map((c) => api(`/api/calendars/${c.id}`, { method: "PATCH", json: { visible: alone ? true : c.id === calendar.id } })));
    void layers.reload();
  };

  const panel = (
    <CalendarsPanel
      calendars={calendars}
      counts={counts}
      onToggle={(c, v) => void toggle(c, v)}
      onSolo={(c) => void solo(c)}
      onEdit={(c) => {
        setLayersOpen(false);
        setEditingCalendar(c);
      }}
      onCreate={() => {
        setLayersOpen(false);
        setEditingCalendar("new");
      }}
    />
  );

  const viewProps = { events: shown, calendars: byId, onSelect: setSelected };

  return (
    <div className="page-fill flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          <IconButton label="Précédent" onClick={() => move(-1)}>
            <ChevronLeftIcon className="h-5 w-5" />
          </IconButton>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(today())}>
            Aujourd'hui
          </Button>
          <IconButton label="Suivant" onClick={() => move(1)}>
            <ChevronRightIcon className="h-5 w-5" />
          </IconButton>
          <h1 className="text-base md:text-xl font-semibold tracking-tight ml-1 truncate">{range.label.charAt(0).toUpperCase() + range.label.slice(1)}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={view} onChange={setView} options={[{ value: "week", label: "Semaine" }, { value: "month", label: "Mois" }, { value: "agenda", label: "Agenda" }]} />
          <IconButton
            label={syncing ? "Synchronisation en cours" : syncOutcome === "ok" ? "Calendrier à jour" : syncOutcome === "failed" ? "La synchronisation a échoué" : "Actualiser depuis GAPS et Cyberlearn"}
            onClick={() => void refresh()}
            disabled={syncing}
          >
            {syncOutcome === "ok" ? <CheckIcon className="h-5 w-5 text-ok" /> : syncOutcome === "failed" ? <XMarkIcon className="h-5 w-5 text-bad" /> : <ArrowPathIcon className={cx("h-5 w-5", syncing && "animate-spin")} />}
          </IconButton>
          <IconButton label="Calendriers" className="lg:hidden" onClick={() => setLayersOpen(true)}>
            <Squares2X2Icon className="h-5 w-5" />
          </IconButton>
          <Button variant="primary" size="md" onClick={() => setEditing("new")}>
            <PlusIcon className="h-4 w-4" /> <span className="hidden sm:inline">Ajouter</span>
          </Button>
        </div>
      </div>

      {(events.error || layers.error) && <ErrorBox error={events.error ?? layers.error ?? ""} retry={reloadAll} />}
      {syncError && <ErrorBox error={syncError} retry={() => void refresh()} />}

      <div className="flex-1 min-h-0 flex gap-4">
        <aside className="hidden lg:flex w-52 xl:w-56 shrink-0 flex-col min-h-0 pt-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 px-1.5 mb-1.5">Calendriers</h2>
          {layers.loading && !layers.data ? <Loading /> : panel}
        </aside>
        <div className="flex-1 min-w-0 min-h-0">
          {events.loading && !events.data ? (
            <Loading />
          ) : view === "week" ? (
            <WeekView from={range.from} {...viewProps} />
          ) : view === "month" ? (
            <MonthView
              from={range.from}
              month={anchor.slice(0, 7)}
              {...viewProps}
              onDay={(d) => {
                setAnchor(d);
                setView("agenda");
              }}
            />
          ) : (
            <AgendaView {...viewProps} />
          )}
        </div>
      </div>

      <Modal open={layersOpen} onClose={() => setLayersOpen(false)} title="Calendriers">
        {panel}
      </Modal>
      <EventSheet event={selected} calendars={byId} onClose={() => setSelected(undefined)} onEdit={() => setEditing(selected)} onChanged={onSaved} />
      {editing && <EventEditor event={editing === "new" ? undefined : editing} calendars={calendars} defaultDay={anchor} onClose={() => setEditing(undefined)} onSaved={onSaved} />}
      {editingCalendar && (
        <CalendarEditor
          calendar={editingCalendar === "new" ? undefined : editingCalendar}
          onClose={() => setEditingCalendar(undefined)}
          onSaved={() => {
            setEditingCalendar(undefined);
            reloadAll();
          }}
        />
      )}
    </div>
  );
}
