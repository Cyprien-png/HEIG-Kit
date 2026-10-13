export const TIME_ZONE = "Europe/Zurich";

/** Midnight in Zurich of the given YYYY-MM-DD day. */
export function startOfDay(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  const zurichHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(utcMidnight),
  );
  return new Date(utcMidnight.getTime() - zurichHour * 60 * 60 * 1000);
}

export function isoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

export function addDays(date: Date, days: number): Date {
  return startOfDay(isoDate(new Date(date.getTime() + (days * 24 + 12) * 60 * 60 * 1000)));
}
