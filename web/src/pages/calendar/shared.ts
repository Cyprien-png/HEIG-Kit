import { courseColor } from "../../lib/courses";
import type { Calendar, CalendarEvent, EventKind } from "../../lib/types";

export const KIND_LABEL: Record<EventKind, string> = { lesson: "cours", deadline: "rendu", exam: "examen", event: "événement" };
export const KIND_TONE = { lesson: "neutral", deadline: "warn", exam: "bad", event: "info" } as const;

/** Colors offered when creating a calendar (the server picks the next one by default). */
export const CALENDAR_COLORS = ["#7c3aed", "#0d9488", "#db2777", "#4f46e5", "#ea580c", "#0891b2", "#65a30d", "#9333ea", "#be185d", "#0284c7", "#2563eb", "#dc2626", "#d97706"];

export interface EventStyle {
  bg: string;
  border: string;
  text: string;
}

/** Lessons of the timetable keep their course color; every other event takes the color of its calendar. */
export function eventStyle(e: CalendarEvent, calendar: Calendar | undefined, dark: boolean): EventStyle {
  if (calendar?.slug === "schedule" && e.course) {
    const c = courseColor(e.course);
    return { bg: c.soft, border: c.bg, text: dark ? c.textDark : c.text };
  }
  const base = calendar?.color ?? "#64748b";
  return {
    bg: `color-mix(in srgb, ${base} ${dark ? 24 : 14}%, transparent)`,
    border: base,
    text: dark ? `color-mix(in srgb, ${base} 50%, white)` : `color-mix(in srgb, ${base} 75%, black)`,
  };
}

/** The title shown for an event: lessons by their course and type rather than the raw GAPS code. */
export function eventTitle(e: CalendarEvent, parse: (summary: string) => { label: string }): string {
  return e.kind === "lesson" ? parse(e.title).label : e.title;
}

/** Details of source events are plain lines; the user's and the agent's are Markdown. */
export function detailsMarkdown(e: CalendarEvent): string {
  if (!e.details) return "";
  return e.source === "manual" ? e.details : e.details.replace(/\n(?!\n)/g, "  \n");
}

export const sourceLabel = (e: CalendarEvent) => (e.key.startsWith("manual:") ? "ajouté à la main" : e.source === "gaps" ? "GAPS" : "Cyberlearn");
