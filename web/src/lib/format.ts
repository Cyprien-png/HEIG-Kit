/** Dates and numbers the Swiss way, Europe/Zurich. */
export const TZ = "Europe/Zurich";

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-CH", { timeZone: TZ, ...options });

export const F = {
  time: fmt({ hour: "2-digit", minute: "2-digit" }),
  day: fmt({ weekday: "short", day: "numeric", month: "short" }),
  dayLong: fmt({ weekday: "long", day: "numeric", month: "long" }),
  date: fmt({ day: "2-digit", month: "2-digit", year: "numeric" }),
  dateTime: fmt({ day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  monthYear: fmt({ month: "long", year: "numeric" }),
  weekday: fmt({ weekday: "short" }),
  dayNumber: fmt({ day: "numeric" }),
};

export const time = (d: string | Date) => F.time.format(new Date(d));
export const day = (d: string | Date) => F.day.format(new Date(d));
export const dateTime = (d: string | Date) => F.dateTime.format(new Date(d));

/** "il y a 3 min", "dans 2 h", "hier". */
export function relative(d: string | Date | undefined, now = Date.now()): string {
  if (!d) return "jamais";
  const diff = new Date(d).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  if (abs < 60_000) return diff <= 0 ? "à l'instant" : "dans un instant";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return rtf.format(Math.round(diff / (30 * 86_400_000)), "month");
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

/** The local calendar day of an instant, as YYYY-MM-DD in Zurich. */
export function isoDay(d: string | Date): string {
  const parts = fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(d));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Midnight (Zurich) of a YYYY-MM-DD day, as a Date. */
export function startOfDay(iso: string): Date {
  const probe = new Date(`${iso}T00:00:00Z`);
  const local = new Date(probe.toLocaleString("en-US", { timeZone: TZ }));
  const utc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(probe.getTime() - (local.getTime() - utc.getTime()));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return isoDay(new Date());
}

/** Monday of the week holding a day. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -weekday);
}

/** Minutes since midnight (Zurich) of an instant. */
export function minutesOfDay(d: string | Date): number {
  const [h, m] = F.time.format(new Date(d)).split(":").map(Number);
  return h * 60 + m;
}

/** A datetime-local value (Zurich) for an instant, and back. */
export function toLocalInput(d: string | Date | undefined): string {
  if (!d) return "";
  const parts = fmt({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(d));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const [date, hm] = value.split("T");
  const base = startOfDay(date);
  const [h, m] = (hm ?? "00:00").split(":").map(Number);
  return new Date(base.getTime() + (h * 60 + m) * 60_000).toISOString();
}
