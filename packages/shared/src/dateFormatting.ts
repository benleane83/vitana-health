import type { MeasurementType } from "./types.js";

export function isUtcMidnightTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) &&
    timestamp.getUTCHours() === 0 &&
    timestamp.getUTCMinutes() === 0 &&
    timestamp.getUTCSeconds() === 0 &&
    timestamp.getUTCMilliseconds() === 0;
}

export function usesDateOnlyObservation(
  aggregation: MeasurementType["aggregation"] | undefined
): boolean {
  return aggregation === "latest";
}

export function localCalendarDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function observationCalendarDate(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "";
  return isUtcMidnightTimestamp(value)
    ? timestamp.toISOString().slice(0, 10)
    : localCalendarDate(timestamp);
}

export function localDateFromCalendarDate(value: string): Date | undefined {
  const parts = parseCalendarDate(value);
  if (!parts) return undefined;
  return new Date(parts.year, parts.month - 1, parts.day);
}

export function calendarDateToUtcMidnight(value: string): string | undefined {
  const parts = parseCalendarDate(value);
  if (!parts) return undefined;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toISOString();
}

function parseCalendarDate(value: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = new Date(Date.UTC(year, month - 1, day));
  if (
    timestamp.getUTCFullYear() !== year ||
    timestamp.getUTCMonth() !== month - 1 ||
    timestamp.getUTCDate() !== day
  ) return undefined;
  return { year, month, day };
}