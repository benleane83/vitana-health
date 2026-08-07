import {
  healthEventKindLabels,
  journalItemsPerDayLimit,
  type ActivitySession,
  type DataSource,
  type HealthEvent,
  type JournalDay,
  type JournalPage,
  type JournalQueryInput,
  type MeasurementType,
  type Observation,
  type TimeSeriesSample
} from "@vitana/shared";

export interface JournalProjectionData {
  activities: ActivitySession[];
  dataSources: DataSource[];
  healthEvents: HealthEvent[];
  measurementTypes: MeasurementType[];
  observations: Observation[];
  samples: TimeSeriesSample[];
}

export function journalFromSnapshot(query: JournalQueryInput, data: JournalProjectionData): JournalPage {
  const dayLimit = Math.min(Math.max(Math.trunc(query.dayLimit ?? 14), 1), 31);
  const sources = new Map(data.dataSources.map((source) => [source.id, source.label]));
  const steps = data.observations.filter((entry) => entry.measurementCode === "steps");
  const sleeps = data.samples.filter((entry) => entry.measurementCode === "sleep_duration");
  const events = data.healthEvents.filter((entry) => entry.status === "completed");
  const dates = new Set<string>();
  for (const entry of steps) dates.add(localDate(entry.observedAt, query.timezone));
  for (const entry of data.activities) dates.add(localDate(entry.endAt ?? entry.startAt, query.timezone));
  for (const entry of sleeps) dates.add(localDate(entry.endAt, query.timezone));
  for (const entry of events) dates.add(localDate(entry.occurredAt, query.timezone));
  const candidates = [...dates]
    .filter((date) => !query.beforeDate || date < query.beforeDate)
    .sort((left, right) => right.localeCompare(left));
  const visibleDates = candidates.slice(0, dayLimit);
  const stepsAggregation = data.measurementTypes.find((entry) => entry.code === "steps")?.aggregation ?? "sum";

  const days = visibleDates.map((date): JournalDay => {
    const daySteps = steps
      .filter((entry) => localDate(entry.observedAt, query.timezone) === date)
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
    const daySleeps = sleeps.filter((entry) => localDate(entry.endAt, query.timezone) === date);
    const items = [
      ...data.activities
        .filter((entry) => localDate(entry.endAt ?? entry.startAt, query.timezone) === date)
        .map((entry) => ({
          kind: "activity" as const,
          id: entry.id,
          occurredAt: entry.endAt ?? entry.startAt,
          title: sourceTitle(entry.sourceJson) ?? humanize(entry.activityType),
          activityType: entry.activityType,
          ...(entry.durationMinutes === undefined ? {} : { durationMinutes: entry.durationMinutes }),
          ...(entry.distanceMeters === undefined ? {} : { distanceMeters: entry.distanceMeters }),
          ...(entry.energyKcal === undefined ? {} : { energyKcal: entry.energyKcal }),
          ...(sources.get(entry.sourceId) ? { sourceLabel: sources.get(entry.sourceId) } : {})
        })),
      ...daySleeps.map((entry) => ({
        kind: "sleep" as const,
        id: entry.id,
        occurredAt: entry.endAt,
        startAt: entry.startAt,
        endAt: entry.endAt,
        durationMinutes: entry.value,
        stageDataStatus: "unavailable" as const,
        ...(sources.get(entry.sourceId) ? { sourceLabel: sources.get(entry.sourceId) } : {})
      })),
      ...events
        .filter((entry) => localDate(entry.occurredAt, query.timezone) === date)
        .map((entry) => ({
          kind: "health-event" as const,
          id: entry.id,
          occurredAt: entry.occurredAt,
          eventKind: entry.kind,
          title: healthEventKindLabels[entry.kind],
          detail: entry.provider || entry.notes,
          sourceLabel: entry.source
        }))
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)
      || left.kind.localeCompare(right.kind) || right.id.localeCompare(left.id));
    const visibleItems = items.slice(0, journalItemsPerDayLimit);
    return {
      date,
      summary: {
        ...(daySteps.length ? { steps: aggregateSteps(daySteps, stepsAggregation, sources) } : {}),
        ...(daySleeps.length ? { sleepDurationMinutes: daySleeps.reduce((sum, entry) => sum + entry.value, 0) } : {})
      },
      items: visibleItems,
      omittedItemCount: items.length - visibleItems.length
    };
  });

  return {
    timezone: query.timezone,
    days,
    ...(candidates.length > dayLimit ? { nextBeforeDate: visibleDates.at(-1) } : {})
  };
}

function aggregateSteps(
  entries: Observation[],
  aggregation: MeasurementType["aggregation"],
  sources: Map<string, string>
) {
  const values = entries.map((entry) => entry.value);
  const value = aggregation === "average"
    ? values.reduce((sum, current) => sum + current, 0) / values.length
    : aggregation === "min"
      ? Math.min(...values)
      : aggregation === "max"
        ? Math.max(...values)
        : aggregation === "latest" || aggregation === "none"
          ? values.at(-1)!
          : values.reduce((sum, current) => sum + current, 0);
  return {
    value,
    unit: entries.at(-1)!.unit,
    sources: [...new Set(entries.flatMap((entry) => sources.get(entry.sourceId) ?? []))].sort()
  };
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

function sourceTitle(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const title = (value as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title : undefined;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
