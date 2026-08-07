import type { CalendarMeasurementPoint } from "@vitana/shared";

export interface MonthCell {
  date: string;
  day: number;
  inMonth: boolean;
}

export function buildMonthCells(month: string, weekStartsOn = localeWeekStart()): MonthCell[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const cellCount = offset + days <= 35 ? 35 : 42;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 1, index - offset + 1));
    return { date: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === monthNumber - 1 };
  });
}

export function localeWeekStart(locale = Intl.DateTimeFormat().resolvedOptions().locale): number {
  try {
    const weekInfo = (new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay: number } }).weekInfo;
    if (weekInfo) return weekInfo.firstDay % 7;
  } catch {
    // Sunday is the stable fallback on runtimes without Intl.Locale week data.
  }
  return 0;
}

export function heatBuckets(points: CalendarMeasurementPoint[]): Map<string, number> {
  const unique = [...new Set(points.map((point) => point.value))].sort((left, right) => left - right);
  return new Map(points.map((point) => [
    point.date,
    unique.length === 1 ? 3 : 1 + Math.round((unique.indexOf(point.value) * 4) / (unique.length - 1))
  ]));
}

export function localDayRange(date: string, timezone: string): { start: string; end: string } {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return {
    start: zonedMidnightIso(date, timezone),
    end: new Date(new Date(zonedMidnightIso(next, timezone)).getTime() - 1).toISOString()
  };
}

function zonedMidnightIso(date: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  let instant = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const represented = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    instant += Date.UTC(year, month - 1, day) - represented;
  }
  return new Date(instant).toISOString();
}