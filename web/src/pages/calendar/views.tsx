import { Badge, Card, Empty, cx } from "../../components/ui";

/** A card whose content is a flex column filling the height available (the `Card` wraps its content in a plain block). */
const Panel = ({ children }: { children: React.ReactNode }) => <section className="bg-surface border border-line rounded-xl shadow-card h-full flex flex-col overflow-hidden">{children}</section>;
import { useIsDark } from "../../lib/auth";
import { parseLessonCode } from "../../lib/courses";
import { F, addDays, isoDay, minutesOfDay, time, today } from "../../lib/format";
import type { Calendar, CalendarEvent } from "../../lib/types";
import { useSize } from "../../lib/useSize";
import { EventRow } from "../Dashboard";
import { type EventStyle, eventStyle, eventTitle } from "./shared";

interface ViewProps {
  events: CalendarEvent[];
  calendars: Map<number, Calendar>;
  onSelect: (e: CalendarEvent) => void;
}

const MIN_HOUR_PX = 30;

/** A small event block of the all-day row or the month grid. */
function Pill({ e, style, onClick, prefix }: { e: CalendarEvent; style: EventStyle; onClick: () => void; prefix?: string }) {
  return (
    <button onClick={onClick} style={{ backgroundColor: style.bg, borderColor: style.border, color: style.text }} className={cx("w-full text-left rounded px-1.5 py-0.5 text-[11px] font-medium truncate border-l-2 leading-4", e.kind === "exam" && "ring-1 ring-bad/60")}>
      {prefix}{e.course && e.kind !== "lesson" ? `${e.course} · ` : ""}{eventTitle(e, parseLessonCode)}
    </button>
  );
}

/** The week: the hour grid takes the height available, so a week never scrolls on a laptop; it scrolls inside the card on a small screen. */
export function WeekView({ from, events, calendars, onSelect }: ViewProps & { from: string }) {
  const dark = useIsDark();
  const [ref, size] = useSize<HTMLDivElement>();
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const visibleDays = days.filter((d, i) => i < 5 || events.some((e) => isoDay(e.startsAt) === d));
  const timed = events.filter((e) => !e.allDay && e.endsAt && isoDay(e.startsAt) === isoDay(e.endsAt));
  const allDay = events.filter((e) => !timed.includes(e));
  const firstHour = Math.min(8, ...timed.map((e) => Math.floor(minutesOfDay(e.startsAt) / 60)));
  const lastHour = Math.max(18, ...timed.map((e) => Math.ceil(minutesOfDay(e.endsAt!) / 60)));
  const hours = lastHour - firstHour;
  const hourPx = Math.max(MIN_HOUR_PX, Math.floor(size.height / hours));
  const now = new Date();
  const nowDay = isoDay(now);
  const nowTop = ((minutesOfDay(now) - firstHour * 60) / 60) * hourPx;
  const columns = `3.25rem repeat(${visibleDays.length}, minmax(0, 1fr))`;

  return (
    <Panel>
      <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
        <div className="min-w-[560px] sm:min-w-0 flex-1 min-h-0 flex flex-col">
          <div className="grid border-b border-line shrink-0" style={{ gridTemplateColumns: columns }}>
            <div />
            {visibleDays.map((d) => (
              <div key={d} className={cx("px-1.5 py-1.5 text-center border-l border-line", d === nowDay && "bg-accent-soft/40")}>
                <div className="text-[11px] uppercase tracking-wide text-ink-3">{F.weekday.format(new Date(`${d}T12:00:00`))}</div>
                <div className={cx("text-lg font-semibold tabular-nums leading-6", d === nowDay && "text-accent")}>{F.dayNumber.format(new Date(`${d}T12:00:00`))}</div>
                <div className="mt-1 space-y-0.5 min-h-[1px]">
                  {allDay.filter((e) => isoDay(e.startsAt) === d).map((e) => (
                    <Pill key={e.key} e={e} style={eventStyle(e, calendars.get(e.calendarId), dark)} onClick={() => onSelect(e)} prefix={e.allDay || !e.endsAt ? (e.allDay ? "" : `${time(e.startsAt)} `) : ""} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div ref={ref} className="flex-1 min-h-0 overflow-y-auto">
            <div className="grid relative" style={{ gridTemplateColumns: columns, height: hours * hourPx }}>
              <div className="relative">
                {Array.from({ length: hours }, (_, i) => (
                  <div key={i} className="absolute right-2 -translate-y-1/2 font-mono text-[11px] text-ink-3 tabular-nums" style={{ top: i * hourPx }}>
                    {i === 0 ? "" : `${String(firstHour + i).padStart(2, "0")}:00`}
                  </div>
                ))}
              </div>
              {visibleDays.map((d) => {
                const dayEvents = timed.filter((e) => isoDay(e.startsAt) === d);
                return (
                  <div key={d} className={cx("relative border-l border-line", d === nowDay && "bg-accent-soft/20")}>
                    {Array.from({ length: hours }, (_, i) => (
                      <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * hourPx }} />
                    ))}
                    {d === nowDay && nowTop > 0 && nowTop < hours * hourPx && (
                      <div className="absolute inset-x-0 h-px bg-bad z-10" style={{ top: nowTop }}>
                        <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-bad" />
                      </div>
                    )}
                    {dayEvents.map((e) => {
                      const start = minutesOfDay(e.startsAt);
                      const end = minutesOfDay(e.endsAt!);
                      const top = ((start - firstHour * 60) / 60) * hourPx;
                      const height = Math.max(((end - start) / 60) * hourPx, 20);
                      const style = eventStyle(e, calendars.get(e.calendarId), dark);
                      const overlapping = dayEvents.filter((o) => o !== e && minutesOfDay(o.startsAt) < end && minutesOfDay(o.endsAt!) > start);
                      const index = overlapping.filter((o) => o.key < e.key).length;
                      const width = 100 / (overlapping.length + 1);
                      const dense = hourPx < 44;
                      return (
                        <button
                          key={e.key}
                          onClick={() => onSelect(e)}
                          style={{ top, height, left: `calc(${index * width}% + 2px)`, width: `calc(${width}% - 4px)`, backgroundColor: style.bg, borderColor: style.border, color: style.text }}
                          className={cx("absolute rounded-md border-l-[3px] px-1.5 py-0.5 text-left overflow-hidden hover:brightness-95 dark:hover:brightness-110 transition", e.kind === "exam" && "ring-1 ring-bad")}
                        >
                          <div className={cx("font-semibold truncate", dense ? "text-[11px] leading-4" : "text-[12px] leading-4")}>{eventTitle(e, parseLessonCode)}</div>
                          {height > 34 && <div className="text-[11px] opacity-80 truncate leading-4">{[e.location, e.overridden ? "modifié" : ""].filter(Boolean).join(" · ") || (e.kind !== "lesson" ? e.course : "")}</div>}
                          {height > 52 && <div className="text-[11px] opacity-70 font-mono leading-4">{time(e.startsAt)}–{time(e.endsAt!)}</div>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** The month: rows share the height available; each day shows as many events as fit, then a "+n". */
export function MonthView({ from, month, events, calendars, onSelect, onDay }: ViewProps & { from: string; month: string; onDay: (d: string) => void }) {
  const dark = useIsDark();
  const [ref, size] = useSize<HTMLDivElement>();
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const weeks = days.slice(35).some((d) => d.startsWith(month)) ? 6 : 5;
  const nowDay = today();
  const rowHeight = size.height / weeks;
  const perDay = Math.max(1, Math.floor((rowHeight - 34) / 18));
  return (
    <Panel>
      <div className="grid grid-cols-7 border-b border-line text-[11px] uppercase tracking-wide text-ink-3 shrink-0">
        {["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>
      <div ref={ref} className="flex-1 min-h-0 grid grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {days.slice(0, weeks * 7).map((d) => {
          const inMonth = d.startsWith(month);
          const dayEvents = events.filter((e) => isoDay(e.startsAt) === d);
          const lessons = dayEvents.filter((e) => e.kind === "lesson");
          const others = dayEvents.filter((e) => e.kind !== "lesson");
          const shown = others.slice(0, perDay);
          return (
            <div key={d} className={cx("min-h-0 overflow-hidden border-b border-r border-line p-1 flex flex-col", !inMonth && "bg-surface-2/50 text-ink-3")}>
              <div className="flex items-center justify-between shrink-0">
                <button onClick={() => onDay(d)} className={cx("h-6 w-6 grid place-items-center rounded-full text-xs font-semibold tabular-nums hover:bg-surface-2", d === nowDay && "bg-accent text-accent-ink hover:bg-accent")}>
                  {Number(d.slice(8))}
                </button>
                {lessons.length > 0 && (
                  <div className="flex gap-0.5 pr-0.5">
                    {[...new Set(lessons.map((l) => l.course))].slice(0, 5).map((c) => (
                      <span key={c} title={c} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: eventStyle(lessons.find((l) => l.course === c)!, calendars.get(lessons[0].calendarId), dark).border }} />
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-0.5 space-y-0.5 min-h-0">
                {shown.map((e) => (
                  <Pill key={e.key} e={e} style={eventStyle(e, calendars.get(e.calendarId), dark)} onClick={() => onSelect(e)} />
                ))}
                {others.length > shown.length && (
                  <button onClick={() => onDay(d)} className="text-[11px] text-ink-3 px-1 hover:text-ink">
                    +{others.length - shown.length}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** The agenda: a list by day, scrolling inside the page. */
export function AgendaView({ events, calendars, onSelect }: ViewProps) {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(isoDay(e.startsAt), [...(byDay.get(isoDay(e.startsAt)) ?? []), e]);
  if (byDay.size === 0) return <Empty title="Rien dans cette période" hint="Ajoutez un événement, ou affichez d'autres calendriers." />;
  const nowDay = today();
  return (
    <div className="h-full overflow-y-auto space-y-3 pr-0.5">
      {[...byDay.entries()].map(([d, list]) => (
        <Card key={d} padded={false}>
          <div className={cx("px-4 py-2 border-b border-line text-sm font-semibold capitalize flex items-center gap-2", d === nowDay && "text-accent")}>
            {F.dayLong.format(new Date(`${d}T12:00:00`))}
            {d === nowDay && <Badge tone="accent">aujourd'hui</Badge>}
          </div>
          <ul className="px-4 divide-y divide-line">
            {list.map((e) => {
              const calendar = calendars.get(e.calendarId);
              return (
                <button key={e.key} onClick={() => onSelect(e)} className="w-full text-left hover:bg-surface-2 -mx-4 px-4 flex items-stretch">
                  <span className="w-1 my-2 rounded-full shrink-0" style={{ backgroundColor: calendar?.slug === "schedule" ? "transparent" : calendar?.color }} />
                  <div className="flex-1 min-w-0 pl-3">
                    <EventRow e={e} />
                  </div>
                </button>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
