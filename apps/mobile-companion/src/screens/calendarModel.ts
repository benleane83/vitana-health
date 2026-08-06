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