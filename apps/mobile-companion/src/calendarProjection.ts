import {
  defaultMeasurementTypes,
  type CalendarMeasurementPoint,
  type CalendarMonthData,
  type CalendarMonthQuery,
  type HealthEvent
} from "@vitana/shared";

export interface CalendarProjectionEntry {
  id: string;
  measurementCode: string;
  observedAt: string;
  value: number;
  unit: string;
  sourceLabel?: string;
}

export function calendarMonthFromEntries(
  query: CalendarMonthQuery,
  entries: CalendarProjectionEntry[],
  events: HealthEvent[] = []
): CalendarMonthData {
  const requestedCodes = new Set(query.measurementCodes);
  const aggregationByCode = new Map(defaultMeasurementTypes.map((type) => [type.code, type.aggregation]));
  const groups = new Map<string, CalendarProjectionEntry[]>();
  for (const entry of entries) {
    if (!requestedCodes.has(entry.measurementCode)) continue;
    const date = localDate(entry.observedAt, query.timezone);
    if (!date.startsWith(`${query.month}-`)) continue;
    const key = `${date}\u0000${entry.measurementCode}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const measurements = [...groups.entries()].map(([key, records]) => {
    const [date, measurementCode] = key.split("\u0000");
    const ordered = [...records].sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
    const values = ordered.map((entry) => entry.value);
    const aggregation = aggregationByCode.get(measurementCode) ?? "none";
    const value = aggregate(values, aggregation);
    return {
      date,
      measurementCode,
      value,
      unit: ordered.at(-1)!.unit,
      count: ordered.length,
      min: Math.min(...values),
      max: Math.max(...values),
      aggregation,
      sources: [...new Set(ordered.flatMap((entry) => entry.sourceLabel ? [entry.sourceLabel] : []))].sort()
    } satisfies CalendarMeasurementPoint;
  }).sort((left, right) => left.date.localeCompare(right.date) || left.measurementCode.localeCompare(right.measurementCode));

  const eventsByDate = new Map<string, { count: number; kinds: Set<HealthEvent["kind"]> }>();
  for (const event of events) {
    if (event.status !== "completed") continue;
    const date = localDate(event.occurredAt, query.timezone);
    if (!date.startsWith(`${query.month}-`)) continue;
    const summary = eventsByDate.get(date) ?? { count: 0, kinds: new Set() };
    summary.count += 1;
    summary.kinds.add(event.kind);
    eventsByDate.set(date, summary);
  }

  return {
    month: query.month,
    timezone: query.timezone,
    measurements,
    events: [...eventsByDate.entries()].map(([date, summary]) => ({
      date,
      count: summary.count,
      kinds: [...summary.kinds].sort()
    })).sort((left, right) => left.date.localeCompare(right.date))
  };
}

function aggregate(values: number[], aggregation: CalendarMeasurementPoint["aggregation"]): number {
  if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "min") return Math.min(...values);
  if (aggregation === "max") return Math.max(...values);
  return values.at(-1)!;
}

function localDate(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}