import {
  type CareItem,
  type CareItemListQuery,
  type CompleteCareItemInput,
  type CreateCareItemInput,
  type CreateHealthEventInput,
  classifyValue,
  defaultMeasurementTypes,
  getReferenceRange,
  resolveReferenceRange,
  type AnalyticsSummary,
  type AppBootstrap,
  type HealthEvent,
  type HealthEventListQuery,
  type HealthDataDetail,
  type HealthDataDetailEntry,
  type HealthDataSummary,
  type HealthDataSummaryTypeRow,
  type ManualObservationPayload,
  type MobileImportResult
} from "@vitana/shared";
import type {
  CompanionCareService,
  CompanionDataSource,
  CompanionMutationService,
  CompanionObservationMutationService,
  DetailPage
} from "./companionDataSource";
import { chartSeriesFromDetail } from "./chartSeries";

interface DemoMetric {
  code: string;
  values: number[];
  unit: string;
  kind: HealthDataDetailEntry["kind"];
  sourceLabel: string;
  isPinned?: boolean;
}

const metrics: DemoMetric[] = [
  { code: "steps", values: [8240, 6915, 10482, 7730, 9125, 8450, 11320], unit: "count", kind: "sample", sourceLabel: "Demo fitness tracker" },
  { code: "heart_rate", values: [68, 70, 66, 72, 69, 67, 71], unit: "bpm", kind: "sample", sourceLabel: "Demo fitness tracker" },
  { code: "sleep_duration", values: [7.2, 6.8, 7.6, 7.0, 7.4, 6.9, 7.8], unit: "h", kind: "sample", sourceLabel: "Demo fitness tracker" },
  { code: "oxygen_saturation", values: [98, 97, 98, 99, 98, 97, 98], unit: "%", kind: "sample", sourceLabel: "Demo fitness tracker" },
  { code: "weight", values: [74.8, 74.6, 74.5, 74.3, 74.1, 74.0, 73.8], unit: "kg", kind: "observation", sourceLabel: "Demo manual entry", isPinned: true },
  { code: "blood_pressure_systolic", values: [124, 121, 119, 122, 118, 120, 117], unit: "mmHg", kind: "observation", sourceLabel: "Demo home monitor" },
  { code: "glucose", values: [5.1, 5.0, 5.4, 5.2, 5.1, 4.9, 5.0], unit: "mmol/L", kind: "observation", sourceLabel: "Demo laboratory report" }
];

export function createDemoDataSource(
  now = new Date()
): CompanionDataSource & CompanionCareService & CompanionMutationService & CompanionObservationMutationService {
  const details = new Map(metrics.map((metric) => [metric.code, makeDetail(metric, now)]));
  let healthEvents = makeHealthEvents(now);
  let careItems = makeCareItems(now, healthEvents);
  let nextHealthEventId = healthEvents.length + 1;
  let nextCareItemId = careItems.length + 1;
  let nextObservationId = 1;

  return {
    async bootstrap() { return makeBootstrap(details, now); },
    async analytics() { return makeAnalytics(details, now); },
    async summary() { return makeSummary([...details.values()].map((detail) => detail.measurement), now); },
    async healthDataDetail(measurementCode, page) {
      const detail = details.get(measurementCode);
      if (!detail) throw new Error("This metric is not available in demo mode.");
      return paginateDetail(detail, page);
    },
    async healthDataChartSeries(measurementCode, options) {
      const detail = details.get(measurementCode);
      if (!detail) throw new Error("This metric is not available in demo mode.");
      return chartSeriesFromDetail(detail, options);
    },
    async importManualObservations(payload) {
      const additions = payload.observations.map((observation) => {
        const measurementCode = observation.measurementCode;
        const detail = measurementCode ? details.get(measurementCode) : undefined;
        const measurement = measurementCode
          ? defaultMeasurementTypes.find((entry) => entry.code === measurementCode)
          : undefined;
        if (!detail || !measurement || !measurementCode) {
          throw new Error("This metric is not available in demo mode.");
        }
        return {
          detail,
          entry: createManualEntry({
            id: `demo-manual-${nextObservationId++}`,
            measurementCode,
            displayName: measurement.display,
            observedAt: payload.observedAt,
            value: observation.value,
            unit: observation.unit ?? detail.entries[0]?.unit ?? "",
            note: observation.note,
            sourceLabel: payload.label,
            measurement
          })
        };
      });
      for (const { detail, entry } of additions) {
        details.set(entry.measurementCode, withEntries(detail, [...detail.entries, entry]));
      }
      return demoImportResult(additions.length, nextObservationId);
    },
    async updateObservation(id, input) {
      const match = findObservation(details, id);
      if (!match) throw new Error("Observation not found.");
      const targetDetail = details.get(input.measurementCode);
      if (!targetDetail) throw new Error("This metric is not available in demo mode.");
      const measurement = defaultMeasurementTypes.find((entry) => entry.code === input.measurementCode);
      if (!measurement) throw new Error("This metric is not available in demo mode.");
      const updatedEntry: HealthDataDetailEntry = {
        ...match.entry,
        measurementCode: input.measurementCode,
        displayName: measurement.display,
        timestamp: input.observedAt,
        value: input.value,
        unit: input.unit,
        note: input.note,
        referenceRange: getReferenceRange(measurement, input.unit),
        status: classifyValue(input.value, measurement, input.unit),
        canDelete: true
      };
      details.set(match.measurementCode, withEntries(
        match.detail,
        match.detail.entries.filter((entry) => entry.id !== id)
      ));
      details.set(input.measurementCode, withEntries(
        targetDetail,
        [...targetDetail.entries.filter((entry) => entry.id !== id), updatedEntry]
      ));
      return {
        updatedObservation: toObservation(updatedEntry),
        counts: makeBootstrap(details, now).counts
      };
    },
    async deleteObservation(id) {
      const match = findObservation(details, id);
      if (!match) throw new Error("Observation not found.");
      details.set(match.measurementCode, withEntries(
        match.detail,
        match.detail.entries.filter((entry) => entry.id !== id)
      ));
      return {
        deletedCount: 1,
        deletedObservation: toObservation(match.entry),
        counts: makeBootstrap(details, now).counts
      };
    },
    async listHealthEvents(query = {}) {
      return paginateCollection(filterHealthEvents(healthEvents, query), query);
    },
    async createHealthEvent(payload: CreateHealthEventInput) {
      const healthEvent: HealthEvent = { id: `demo-event-${nextHealthEventId++}`, source: "manual-entry", ...payload };
      healthEvents = [healthEvent, ...healthEvents];
      return { healthEvent, counts: makeBootstrap(details, now).counts };
    },
    async updateHealthEvent(id: string, payload: CreateHealthEventInput) {
      const existing = healthEvents.find((entry) => entry.id === id);
      if (!existing) throw new Error("Health event not found.");
      const healthEvent: HealthEvent = { ...existing, ...payload };
      healthEvents = healthEvents.map((entry) => entry.id === id ? healthEvent : entry);
      return { healthEvent, counts: makeBootstrap(details, now).counts };
    },
    async deleteHealthEvent(id: string) {
      const deletedHealthEvent = healthEvents.find((entry) => entry.id === id);
      healthEvents = healthEvents.filter((entry) => entry.id !== id);
      return { deletedCount: deletedHealthEvent ? 1 : 0, deletedHealthEvent, counts: makeBootstrap(details, now).counts };
    },
    async listCareItems(query = {}) {
      return paginateCollection(filterCareItems(careItems, query), query);
    },
    async createCareItem(payload: CreateCareItemInput) {
      if (payload.status === "completed") throw new Error("Use the completion action to complete a care item.");
      const careItem: CareItem = { id: `demo-care-${nextCareItemId++}`, ...payload };
      careItems = [careItem, ...careItems];
      return { careItem, counts: makeBootstrap(details, now).counts };
    },
    async updateCareItem(id: string, payload: CreateCareItemInput) {
      const existing = careItems.find((entry) => entry.id === id);
      if (!existing) throw new Error("Care item not found.");
      if (existing.status !== "completed" && payload.status === "completed") {
        throw new Error("Use the completion action to complete a care item.");
      }
      const careItem: CareItem = existing.status === "completed"
        ? { ...existing, ...payload, status: "completed", completedAt: existing.completedAt, completedHealthEventId: existing.completedHealthEventId }
        : { ...existing, ...payload, completedAt: undefined, completedHealthEventId: undefined };
      careItems = careItems.map((entry) => entry.id === id ? careItem : entry);
      return { careItem, counts: makeBootstrap(details, now).counts };
    },
    async completeCareItem(id: string, payload: CompleteCareItemInput) {
      const existing = careItems.find((entry) => entry.id === id);
      if (!existing) throw new Error("Care item not found.");
      if (existing.status !== "open") throw new Error("Only open care items can be completed.");
      const healthEvent: HealthEvent = {
        id: `demo-event-${nextHealthEventId++}`,
        kind: payload.kind,
        status: "completed",
        occurredAt: payload.occurredAt,
        source: "manual-entry",
        notes: `Completed care item: ${existing.title}`
      };
      const careItem: CareItem = {
        ...existing,
        status: "completed",
        completedAt: payload.occurredAt,
        completedHealthEventId: healthEvent.id,
        completedHealthEvent: {
          id: healthEvent.id,
          kind: healthEvent.kind,
          occurredAt: healthEvent.occurredAt
        }
      };
      healthEvents = [healthEvent, ...healthEvents];
      careItems = careItems.map((entry) => entry.id === id ? careItem : entry);
      return { careItem, healthEvent, counts: makeBootstrap(details, now).counts };
    },
    async deleteCareItem(id: string) {
      const deletedCareItem = careItems.find((entry) => entry.id === id);
      careItems = careItems.filter((entry) => entry.id !== id);
      return { deletedCount: deletedCareItem ? 1 : 0, deletedCareItem, counts: makeBootstrap(details, now).counts };
    }
  };
}

function makeBootstrap(details: Map<string, HealthDataDetail>, now: Date): AppBootstrap {
  const counts = entryCounts(details);
  return {
    profile: {
      id: "demo-profile",
      displayName: "Demo Profile",
      subjectKind: "adult",
      birthDate: "1988-04-12",
      sex: "not-specified",
      heightCm: 172,
      goalSummary: "Maintain consistent activity and cardiovascular health.",
      units: "metric",
      updatedAt: now.toISOString()
    },
    measurementTypes: defaultMeasurementTypes,
    manualObservationGroupTemplates: [],
    counts: { imports: 3, ...counts, healthEvents: 0, careItems: 0 }
  };
}

function makeAnalytics(details: Map<string, HealthDataDetail>, now: Date): AnalyticsSummary {
  const counts = entryCounts(details);
  return {
    counts: { imports: 3, ...counts, insights: 0, healthEvents: 0, careItems: 0 },
    latestMetrics: [...details.values()]
      .flatMap((detail) => {
        const latest = detail.entries[0];
        if (!latest) return [];
        return {
          code: detail.measurement.code,
          label: detail.measurement.displayName,
          value: latest.value,
          unit: latest.unit,
          observedAt: latest.timestamp,
          status: "normal" as const,
          isPinned: detail.isPinned
        };
      })
      .sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || right.observedAt.localeCompare(left.observedAt)),
    trendCards: [],
    labAlerts: [],
    evidenceDigest: [
      "Sample activity has remained consistent over the last seven days.",
      "Sample cardiovascular measurements are within their illustrative ranges."
    ]
  };
}

function makeSummary(rows: HealthDataSummaryTypeRow[], now: Date): HealthDataSummary {
  const categoryLabels: Record<HealthDataSummaryTypeRow["category"], string> = {
    activity: "Activity",
    cardio: "Cardiovascular",
    sleep: "Sleep",
    body: "Body",
    lab: "Laboratory",
    derived: "Derived",
    uncategorized: "Other"
  };
  const categories = [...new Set(rows.map((row) => row.category))].map((category) => {
    const categoryRows = rows.filter((row) => row.category === category);
    const counts = sumCounts(categoryRows);
    return {
      key: category,
      label: categoryLabels[category],
      counts: { ...counts, types: categoryRows.length },
      rows: categoryRows
    };
  });
  const counts = sumCounts(rows);
  return {
    generatedAt: now.toISOString(),
    totals: { ...counts, types: rows.length },
    categories
  };
}

function makeDetail(metric: DemoMetric, now: Date): HealthDataDetail {
  const measurementType = defaultMeasurementTypes.find((entry) => entry.code === metric.code);
  if (!measurementType) throw new Error(`Unknown demo measurement: ${metric.code}`);
  const entries = [...metric.values].reverse().map((value, index): HealthDataDetailEntry => {
    const referenceRange = getReferenceRange(measurementType, metric.unit);
    return {
      kind: metric.kind,
      id: `demo-${metric.code}-${index}`,
      measurementCode: metric.code,
      displayName: measurementType.display,
      timestamp: daysBefore(now, index).toISOString(),
      value,
      unit: metric.unit,
      sourceLabel: metric.sourceLabel,
      sourceKind: metric.kind === "sample" ? "health-connect" : "manual-entry",
      referenceRange,
      status: classifyValue(value, measurementType, metric.unit),
      canDelete: metric.kind === "observation"
    };
  });
  const counts = {
    observations: metric.kind === "observation" ? entries.length : 0,
    samples: metric.kind === "sample" ? entries.length : 0,
    activities: metric.kind === "activity" ? entries.length : 0
  };
  const measurement: HealthDataSummaryTypeRow = {
    code: metric.code,
    displayName: measurementType.display,
    description: measurementType.description,
    category: measurementType.category,
    aggregation: measurementType.aggregation,
    counts: { ...counts, total: entries.length },
    lastMeasuredAt: entries[0].timestamp
  };
  return {
    generatedAt: now.toISOString(),
    measurement,
    isPinned: metric.isPinned ?? false,
    entries,
    chartPoints: [...entries].reverse().map((entry) => ({
      kind: entry.kind,
      timestamp: entry.timestamp,
      value: entry.value,
      unit: entry.unit,
      referenceRange: entry.referenceRange
    })),
    referenceRange: resolveReferenceRange(measurementType, metric.unit, undefined, "adult"),
    counts: { ...counts, total: entries.length },
    deletion: { observationEntries: counts.observations, deletableEntries: counts.observations },
    pagination: { limit: entries.length, loaded: entries.length, total: entries.length, hasMore: false }
  };
}

function paginateDetail(detail: HealthDataDetail, page: DetailPage = {}): HealthDataDetail {
  const offset = Math.max(0, page.offset ?? 0);
  const limit = Math.max(1, page.limit ?? 50);
  const entries = detail.entries.slice(offset, offset + limit);
  return {
    ...detail,
    entries,
    pagination: {
      limit,
      loaded: entries.length,
      total: detail.entries.length,
      hasMore: offset + entries.length < detail.entries.length
    }
  };
}

function sumCounts(rows: HealthDataSummaryTypeRow[]) {
  return rows.reduce((counts, row) => ({
    observations: counts.observations + row.counts.observations,
    samples: counts.samples + row.counts.samples,
    activities: counts.activities + row.counts.activities,
    total: counts.total + row.counts.total
  }), { observations: 0, samples: 0, activities: 0, total: 0 });
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function makeHealthEvents(now: Date): HealthEvent[] {
  return [{
    id: "demo-event-1",
    kind: "other",
    status: "completed",
    occurredAt: daysBefore(now, 3).toISOString(),
    source: "manual-entry",
    provider: "Demo clinician",
    notes: "Follow-up review completed."
  }, {
    id: "demo-event-2",
    kind: "immunization",
    status: "completed",
    occurredAt: daysBefore(now, 28).toISOString(),
    source: "manual-entry",
    provider: "Community pharmacy",
    notes: "Routine immunization"
  }];
}

function makeCareItems(now: Date, events: HealthEvent[]): CareItem[] {
  return [{
    id: "demo-care-1",
    title: "Book review visit",
    kind: "routine-checkup",
    dueStart: daysBefore(now, -2).toISOString(),
    reminderAt: daysBefore(now, -3).toISOString(),
    priority: "normal",
    status: "open",
    notes: "Bring recent notes."
  }, {
    id: "demo-care-2",
    title: "Monitor post-vaccine symptoms",
    kind: "monitoring",
    dueStart: daysBefore(now, -1).toISOString(),
    priority: "low",
    status: "completed",
    completedAt: daysBefore(now, 20).toISOString(),
    completedHealthEventId: events[1]?.id
  }];
}

function filterHealthEvents(items: HealthEvent[], query: HealthEventListQuery): HealthEvent[] {
  return items.filter((item) => {
    if (query.kind && item.kind !== query.kind) return false;
    if (query.status && item.status !== query.status) return false;
    if (query.search) {
      const token = query.search.toLowerCase();
      if (![item.kind, item.provider ?? "", item.notes ?? ""].some((value) => value.toLowerCase().includes(token))) return false;
    }
    return true;
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
}

function filterCareItems(items: CareItem[], query: CareItemListQuery): CareItem[] {
  return items.filter((item) => {
    if (query.kind && item.kind !== query.kind) return false;
    if (query.status && item.status !== query.status) return false;
    if (query.priority && item.priority !== query.priority) return false;
    if (query.search) {
      const token = query.search.toLowerCase();
      if (![item.title, item.kind, item.notes ?? ""].some((value) => value.toLowerCase().includes(token))) return false;
    }
    return true;
  }).sort((left, right) => (left.dueStart ?? "").localeCompare(right.dueStart ?? "") || left.id.localeCompare(right.id));
}

function paginateCollection<T extends { id: string }>(
  items: T[],
  query: { limit?: number; offset?: number; includeId?: string }
) {
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.max(1, query.limit ?? 20);
  const page = items.slice(offset, offset + limit);
  if (query.includeId && !page.some((entry) => entry.id === query.includeId)) {
    const selected = items.find((entry) => entry.id === query.includeId);
    if (selected) page.push(selected);
  }
  return {
    items: page,
    total: items.length,
    offset,
    limit,
    hasMore: offset + Math.min(limit, page.length) < items.length
  };
}

function findObservation(details: Map<string, HealthDataDetail>, id: string) {
  for (const [measurementCode, detail] of details) {
    const entry = detail.entries.find((candidate) => candidate.id === id && candidate.kind === "observation");
    if (entry) return { measurementCode, detail, entry };
  }
  return undefined;
}

function withEntries(detail: HealthDataDetail, entries: HealthDataDetailEntry[]): HealthDataDetail {
  const orderedEntries = [...entries].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const counts = countEntries(orderedEntries);
  return {
    ...detail,
    measurement: {
      ...detail.measurement,
      counts: { ...counts, total: orderedEntries.length },
      lastMeasuredAt: orderedEntries[0]?.timestamp
    },
    entries: orderedEntries,
    chartPoints: [...orderedEntries].reverse().map((entry) => ({
      kind: entry.kind,
      timestamp: entry.timestamp,
      value: entry.value,
      unit: entry.unit,
      referenceRange: entry.referenceRange
    })),
    counts: { ...counts, total: orderedEntries.length },
    deletion: { observationEntries: counts.observations, deletableEntries: counts.observations },
    pagination: { limit: orderedEntries.length, loaded: orderedEntries.length, total: orderedEntries.length, hasMore: false }
  };
}

function entryCounts(details: Map<string, HealthDataDetail>) {
  return [...details.values()].reduce((counts, detail) => {
    const detailCounts = countEntries(detail.entries);
    return {
      observations: counts.observations + detailCounts.observations,
      samples: counts.samples + detailCounts.samples,
      activities: counts.activities + detailCounts.activities
    };
  }, { observations: 0, samples: 0, activities: 0 });
}

function countEntries(entries: HealthDataDetailEntry[]) {
  return entries.reduce((counts, entry) => ({
    observations: counts.observations + (entry.kind === "observation" ? 1 : 0),
    samples: counts.samples + (entry.kind === "sample" ? 1 : 0),
    activities: counts.activities + (entry.kind === "activity" ? 1 : 0)
  }), { observations: 0, samples: 0, activities: 0 });
}

function toObservation(entry: HealthDataDetailEntry) {
  return {
    id: entry.id,
    measurementCode: entry.measurementCode,
    observedAt: entry.timestamp,
    value: entry.value,
    unit: entry.unit,
    sourceId: "demo-source",
    note: entry.note
  };
}

function createManualEntry({
  id,
  measurementCode,
  displayName,
  observedAt,
  value,
  unit,
  note,
  sourceLabel,
  measurement
}: {
  id: string;
  measurementCode: string;
  displayName: string;
  observedAt: string;
  value: number;
  unit: string;
  note?: string;
  sourceLabel: string;
  measurement: (typeof defaultMeasurementTypes)[number];
}): HealthDataDetailEntry {
  return {
    kind: "observation",
    id,
    measurementCode,
    displayName,
    timestamp: observedAt,
    value,
    unit,
    sourceLabel: sourceLabel || "Demo manual entry",
    sourceKind: "manual-entry",
    note,
    referenceRange: getReferenceRange(measurement, unit),
    status: classifyValue(value, measurement, unit),
    canDelete: true
  };
}

function demoImportResult(observationCount: number, importSequence: number): MobileImportResult {
  const accepted = { attempted: observationCount, accepted: observationCount, duplicates: 0 };
  const empty = { attempted: 0, accepted: 0, duplicates: 0 };
  return {
    importId: `demo-import-${importSequence}`,
    outcome: {
      sourceImports: { attempted: 1, accepted: 1, duplicates: 0 },
      dataSources: { attempted: 1, accepted: 1, duplicates: 0 },
      observationGroups: { attempted: 1, accepted: 1, duplicates: 0 },
      observations: accepted,
      timeSeriesSamples: empty,
      activitySessions: empty
    }
  };
}