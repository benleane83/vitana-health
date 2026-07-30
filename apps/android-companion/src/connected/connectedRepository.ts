import {
  CURRENT_SCHEMA_VERSION,
  classifyValueWithRange,
  computeAnalytics,
  getPreferredUnit,
  resolveReferenceRange,
  toPreferredMeasurementValue,
  type ActivitySession,
  type AppBootstrap,
  type CareItem,
  type CareItemListQuery,
  type DataSource,
  type HealthDataChartSeries,
  type HealthDataChartSeriesOptions,
  type HealthDataDetail,
  type HealthDataDetailEntry,
  type HealthDataSummary,
  type HealthDataSummaryTypeRow,
  type HealthEvent,
  type HealthEventListQuery,
  type HealthStoreData,
  type MeasurementType,
  type Observation,
  type ObservationGroup,
  type PersonalReferenceRange,
  type PinnedMeasurement,
  type Profile,
  type ReplicaIdentity,
  type SourceImport,
  type TimeSeriesSample
} from "@vitana/shared";
import { chartRangeCutoff, chartSeriesFromPoints } from "../chartSeries";
import type { LocalStore, LocalReplicaMetadata } from "../standalone/localStore";

const ACTIVITY_SESSIONS_CODE = "activity_sessions";

/**
 * Upper bound on the points handed to the trend chart. The replica can hold tens of thousands of
 * readings for a single code and every point would otherwise be marshalled into React state.
 */
const MAX_CHART_POINTS = 500;

interface MeasurementBucket {
  observations: number;
  samples: number;
  activities: number;
  lastMeasuredAt?: string;
}

/**
 * A parsed view of the replica. The replica is read-only between synchronizations, so this is built
 * once per applied page rather than once per screen read.
 */
interface ReplicaProjection {
  key: string;
  data: HealthStoreData;
  measurements: Map<string, MeasurementBucket>;
  types: Map<string, MeasurementType>;
}

export class ConnectedReplicaRepository {
  private projection?: ReplicaProjection;

  constructor(
    private readonly store: LocalStore,
    readonly identity: ReplicaIdentity
  ) {}

  async bootstrap(): Promise<AppBootstrap> {
    const { data } = await this.readProjection();
    const healthEvents = data.healthEvents ?? [];
    const careItems = data.careItems ?? [];
    return {
      profile: data.profile,
      measurementTypes: data.measurementTypes,
      manualObservationGroupTemplates: [],
      counts: {
        imports: data.sourceImports.length,
        observations: data.observations.length,
        samples: data.timeSeriesSamples.length,
        activities: data.activitySessions.length,
        healthEvents: healthEvents.length,
        careItems: careItems.length
      }
    };
  }

  async analytics() {
    return computeAnalytics((await this.readProjection()).data);
  }

  async summary(): Promise<HealthDataSummary> {
    return summarize(await this.readProjection());
  }

  async healthDataDetail(measurementCode: string, page: { limit?: number; offset?: number } = {}): Promise<HealthDataDetail> {
    const projection = await this.readProjection();
    const { data } = projection;
    const allEntries = detailEntries(projection, measurementCode);
    const limit = Math.min(Math.max(Math.trunc(page.limit ?? 50), 1), 100);
    const offset = Math.max(Math.trunc(page.offset ?? 0), 0);
    const entries = allEntries.slice(offset, offset + limit);
    const type = projection.types.get(measurementCode);
    const summaryRow = summaryRowFor(projection, measurementCode);
    const referenceRange = type
      ? resolveReferenceRange(
          type,
          getPreferredUnit(type, data.profile.units),
          data.personalReferenceRanges.find((range) => range.measurementCode === measurementCode),
          data.profile.subjectKind
        )
      : { source: "none" as const };
    const observationEntries = allEntries.reduce(
      (count, entry) => entry.kind === "observation" ? count + 1 : count,
      0
    );
    return {
      generatedAt: new Date().toISOString(),
      measurement: summaryRow,
      isPinned: data.pinnedMeasurements.some((pin) => pin.measurementCode === measurementCode),
      referenceRange,
      entries,
      chartPoints: chartPoints(allEntries),
      counts: summaryRow.counts,
      deletion: { observationEntries, deletableEntries: observationEntries },
      pagination: {
        limit,
        loaded: Math.min(offset + entries.length, allEntries.length),
        total: allEntries.length,
        hasMore: offset + entries.length < allEntries.length
      }
    };
  }

  /**
   * Applies the range cutoff before downsampling. Deriving the series from `healthDataDetail`'s
   * already-downsampled `chartPoints` meant a short range over a long history returned a handful of
   * points — five years of daily readings collapsed to 500, of which only ~8 fell inside "1M".
   */
  async healthDataChartSeries(
    measurementCode: string,
    options: HealthDataChartSeriesOptions
  ): Promise<HealthDataChartSeries> {
    const projection = await this.readProjection();
    const cutoff = chartRangeCutoff(options.range);
    const entries = detailEntries(projection, measurementCode)
      .filter((entry) => !cutoff || entry.timestamp >= cutoff);
    const aggregation = projection.types.get(measurementCode)?.aggregation ?? "none";
    return chartSeriesFromPoints(measurementCode, aggregation, chartPoints(entries), options);
  }

  async listHealthEvents(query: HealthEventListQuery = {}) {
    const { data } = await this.readProjection();
    const healthEvents = data.healthEvents ?? [];
    const { limit, offset } = normalizePagination(query);
    const search = query.search?.trim().toLowerCase();
    const matching = healthEvents
      .filter((entry) => !query.kind || entry.kind === query.kind)
      .filter((entry) => !query.status || entry.status === query.status)
      .filter((entry) => !query.occurredFrom || entry.occurredAt >= query.occurredFrom)
      .filter((entry) => !query.occurredTo || entry.occurredAt <= query.occurredTo)
      .filter((entry) => !search || [entry.kind, entry.provider, entry.notes]
        .some((value) => value?.toLowerCase().includes(search)))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
    const items = matching.slice(offset, offset + limit);
    appendIncluded(items, healthEvents, query.includeId);
    return {
      items,
      total: matching.length,
      offset,
      limit,
      hasMore: offset + Math.min(limit, Math.max(matching.length - offset, 0)) < matching.length
    };
  }

  async listCareItems(query: CareItemListQuery = {}) {
    const { data } = await this.readProjection();
    const healthEvents = data.healthEvents ?? [];
    const careItems = data.careItems ?? [];
    const { limit, offset } = normalizePagination(query);
    const search = query.search?.trim().toLowerCase();
    const eventsById = new Map(healthEvents.map((entry) => [entry.id, entry]));
    const enrich = (entry: CareItem): CareItem => {
      const completed = entry.completedHealthEventId ? eventsById.get(entry.completedHealthEventId) : undefined;
      return completed ? {
        ...entry,
        completedHealthEvent: {
          id: completed.id,
          kind: completed.kind,
          occurredAt: completed.occurredAt,
          provider: completed.provider
        }
      } : entry;
    };
    const matching = careItems
      .filter((entry) => !query.kind || entry.kind === query.kind)
      .filter((entry) => !query.status || entry.status === query.status)
      .filter((entry) => !query.priority || entry.priority === query.priority)
      .filter((entry) => !query.dueFrom || (entry.dueStart !== undefined && entry.dueStart >= query.dueFrom))
      .filter((entry) => !query.dueTo || (entry.dueStart !== undefined && entry.dueStart <= query.dueTo))
      .filter((entry) => !search || [entry.title, entry.kind, entry.notes]
        .some((value) => value?.toLowerCase().includes(search)))
      .sort((left, right) => {
        if (left.dueStart === undefined) return right.dueStart === undefined ? left.id.localeCompare(right.id) : 1;
        if (right.dueStart === undefined) return -1;
        return left.dueStart.localeCompare(right.dueStart) || left.id.localeCompare(right.id);
      })
      .map(enrich);
    const items = matching.slice(offset, offset + limit);
    appendIncluded(items, careItems.map(enrich), query.includeId);
    return {
      items,
      total: matching.length,
      offset,
      limit,
      hasMore: offset + Math.min(limit, Math.max(matching.length - offset, 0)) < matching.length
    };
  }

  metadata() {
    return this.store.replicaMetadata(this.identity);
  }

  close() {
    return this.store.close();
  }

  /**
   * Returns the parsed replica, rebuilding it only when a new page has been applied. A single
   * screen refresh reads the store several times (bootstrap, analytics, summary) and the replica
   * cannot change in between, so the parse and the entity indexes are shared across those reads.
   */
  private async readProjection(): Promise<ReplicaProjection> {
    const key = projectionKey(await this.store.replicaMetadata(this.identity));
    if (this.projection?.key === key) return this.projection;
    const data = await this.readStore();
    this.projection = {
      key,
      data,
      measurements: indexMeasurements(data),
      types: new Map(data.measurementTypes.map((entry) => [entry.code, entry]))
    };
    return this.projection;
  }

  private async readStore(): Promise<HealthStoreData> {
    const rows = await this.store.replicaEntities(this.identity);
    const buckets = new Map<string, unknown[]>();
    for (const row of rows) {
      const bucket = buckets.get(row.entityType);
      if (bucket) bucket.push(row.payload);
      else buckets.set(row.entityType, [row.payload]);
    }
    const values = <T>(entityType: string) => (buckets.get(entityType) ?? []) as T[];
    const profile = values<Profile>("profile")[0];
    if (!profile) throw new Error("The connected snapshot does not contain its assigned profile.");
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      profile,
      sourceImports: values<SourceImport>("source-import"),
      dataSources: values<DataSource>("data-source"),
      devices: values<HealthStoreData["devices"][number]>("device"),
      measurementTypes: values<MeasurementType>("measurement-type"),
      personalReferenceRanges: values<PersonalReferenceRange>("personal-reference-range"),
      pinnedMeasurements: values<PinnedMeasurement>("pinned-measurement"),
      observationGroups: values<ObservationGroup>("observation-group"),
      observations: values<Observation>("observation"),
      timeSeriesSamples: values<TimeSeriesSample>("time-series-sample"),
      activitySessions: values<ActivitySession>("activity-session"),
      healthEvents: values<HealthEvent>("health-event"),
      careItems: values<CareItem>("care-item"),
      insights: [],
      auditEvents: []
    };
  }
}

function projectionKey(metadata: LocalReplicaMetadata | undefined): string {
  if (!metadata) return "absent";
  return `${metadata.revision}:${metadata.cursorSequence}:${metadata.appliedAt ?? ""}`;
}

/** Buckets every reading by measurement code in one pass so summaries are not O(codes x readings). */
function indexMeasurements(data: HealthStoreData): Map<string, MeasurementBucket> {
  const measurements = new Map<string, MeasurementBucket>();
  const bucketFor = (code: string) => {
    const existing = measurements.get(code);
    if (existing) return existing;
    const created: MeasurementBucket = { observations: 0, samples: 0, activities: 0 };
    measurements.set(code, created);
    return created;
  };
  const observe = (bucket: MeasurementBucket, timestamp: string | undefined) => {
    if (timestamp && (bucket.lastMeasuredAt === undefined || timestamp > bucket.lastMeasuredAt)) {
      bucket.lastMeasuredAt = timestamp;
    }
  };
  for (const entry of data.observations) {
    const bucket = bucketFor(entry.measurementCode);
    bucket.observations += 1;
    observe(bucket, entry.observedAt);
  }
  for (const entry of data.timeSeriesSamples) {
    const bucket = bucketFor(entry.measurementCode);
    bucket.samples += 1;
    observe(bucket, entry.endAt);
  }
  if (data.activitySessions.length > 0) {
    const bucket = bucketFor(ACTIVITY_SESSIONS_CODE);
    bucket.activities = data.activitySessions.length;
    for (const entry of data.activitySessions) observe(bucket, entry.endAt ?? entry.startAt);
  }
  return measurements;
}

/** Evenly downsamples a trend series, always keeping the first and last point. */
function chartPoints(entries: HealthDataDetailEntry[]): HealthDataDetail["chartPoints"] {
  const total = entries.length;
  const toPoint = (entry: HealthDataDetailEntry) => ({
    kind: entry.kind,
    timestamp: entry.timestamp,
    value: entry.value,
    unit: entry.unit,
    referenceRange: entry.referenceRange
  });
  // Entries arrive newest first; charts read oldest first.
  if (total <= MAX_CHART_POINTS) {
    const points: HealthDataDetail["chartPoints"] = [];
    for (let index = total - 1; index >= 0; index--) points.push(toPoint(entries[index]));
    return points;
  }
  const stride = (total - 1) / (MAX_CHART_POINTS - 1);
  const points: HealthDataDetail["chartPoints"] = [];
  for (let index = 0; index < MAX_CHART_POINTS; index++) {
    points.push(toPoint(entries[total - 1 - Math.round(index * stride)]));
  }
  return points;
}

function normalizePagination(query: { limit?: number; offset?: number }) {
  return {
    limit: Math.min(Math.max(Math.trunc(query.limit ?? 20), 1), 100),
    offset: Math.max(Math.trunc(query.offset ?? 0), 0)
  };
}

function appendIncluded<T extends { id: string }>(items: T[], allItems: T[], includeId: string | undefined) {
  const normalizedId = includeId?.trim();
  if (!normalizedId || items.some((entry) => entry.id === normalizedId)) return;
  const included = allItems.find((entry) => entry.id === normalizedId);
  if (included) items.push(included);
}

function summarize(projection: ReplicaProjection): HealthDataSummary {
  const rows = [...projection.measurements.keys()].map((code) => summaryRowFor(projection, code));
  const grouped = new Map<HealthDataSummaryTypeRow["category"], HealthDataSummaryTypeRow[]>();
  for (const row of rows) {
    const category = grouped.get(row.category);
    if (category) category.push(row);
    else grouped.set(row.category, [row]);
  }
  const categories = [...grouped.entries()].map(([key, categoryRows]) => ({
    key,
    label: key === "lab" ? "Lab results" : key.charAt(0).toUpperCase() + key.slice(1),
    counts: categoryRows.reduce(
      (counts, row) => ({
        observations: counts.observations + row.counts.observations,
        samples: counts.samples + row.counts.samples,
        activities: counts.activities + row.counts.activities,
        total: counts.total + row.counts.total,
        types: counts.types + 1
      }),
      { observations: 0, samples: 0, activities: 0, total: 0, types: 0 }
    ),
    rows: categoryRows.sort((left, right) => (right.lastMeasuredAt ?? "").localeCompare(left.lastMeasuredAt ?? ""))
  }));
  return {
    generatedAt: new Date().toISOString(),
    totals: categories.reduce(
      (counts, category) => ({
        observations: counts.observations + category.counts.observations,
        samples: counts.samples + category.counts.samples,
        activities: counts.activities + category.counts.activities,
        total: counts.total + category.counts.total,
        types: counts.types + category.counts.types
      }),
      { observations: 0, samples: 0, activities: 0, total: 0, types: 0 }
    ),
    categories
  };
}

function summaryRowFor(projection: ReplicaProjection, code: string): HealthDataSummaryTypeRow {
  const type = projection.types.get(code);
  const counts = projection.measurements.get(code) ?? { observations: 0, samples: 0, activities: 0 };
  const isActivity = code === ACTIVITY_SESSIONS_CODE;
  return {
    code,
    displayName: isActivity ? "Activity sessions" : (type?.display ?? code),
    description: type?.description,
    category: isActivity ? "activity" : (type?.category ?? "uncategorized"),
    counts: {
      observations: counts.observations,
      samples: counts.samples,
      activities: counts.activities,
      total: counts.observations + counts.samples + counts.activities
    },
    lastMeasuredAt: counts.lastMeasuredAt
  };
}

function detailEntries(projection: ReplicaProjection, measurementCode: string): HealthDataDetailEntry[] {
  const { data } = projection;
  const type = projection.types.get(measurementCode);
  const displayName = measurementCode === ACTIVITY_SESSIONS_CODE
    ? "Activity sessions"
    : (type?.display ?? measurementCode);
  const sources = new Map(data.dataSources.map((entry) => [entry.id, entry]));
  const imports = new Map(data.sourceImports.map((entry) => [entry.id, entry]));
  const groups = new Map(data.observationGroups.map((entry) => [entry.id, entry]));
  const sourceFields = (sourceId: string) => {
    const source = sources.get(sourceId);
    const imported = source?.importId ? imports.get(source.importId) : undefined;
    return {
      sourceLabel: source?.label,
      sourceKind: source?.sourceKind,
      importFileName: imported?.fileName,
      importedAt: imported?.importedAt
    };
  };
  const range = (value: number, unit: string) => {
    if (!type) return {};
    const displayed = toPreferredMeasurementValue(value, unit, type, data.profile.units);
    const referenceRange = resolveReferenceRange(
      type,
      displayed.unit,
      data.personalReferenceRanges.find((entry) => entry.measurementCode === measurementCode),
      data.profile.subjectKind
    ).effective;
    return {
      value: displayed.value,
      unit: displayed.unit,
      referenceRange,
      status: classifyValueWithRange(displayed.value, referenceRange)
    };
  };
  const observations = data.observations
    .filter((entry) => entry.measurementCode === measurementCode)
    .map<HealthDataDetailEntry>((entry) => ({
      kind: "observation",
      id: entry.id,
      measurementCode,
      displayName,
      timestamp: entry.observedAt,
      ...range(entry.value, entry.unit),
      ...sourceFields(entry.sourceId),
      note: entry.note,
      observationGroup: entry.observationGroupId ? groups.get(entry.observationGroupId) : undefined,
      canDelete: true,
      deleteLabel: "Delete reading"
    } as HealthDataDetailEntry));
  const samples = data.timeSeriesSamples
    .filter((entry) => entry.measurementCode === measurementCode)
    .map<HealthDataDetailEntry>((entry) => ({
      kind: "sample",
      id: entry.id,
      measurementCode,
      displayName,
      timestamp: entry.endAt,
      ...range(entry.value, entry.unit),
      ...sourceFields(entry.sourceId)
    } as HealthDataDetailEntry));
  const activities = measurementCode === ACTIVITY_SESSIONS_CODE
    ? data.activitySessions.map<HealthDataDetailEntry>((entry) => ({
        kind: "activity",
        id: entry.id,
        measurementCode,
        displayName,
        timestamp: entry.endAt ?? entry.startAt,
        value: entry.durationMinutes ?? 0,
        unit: "min",
        ...sourceFields(entry.sourceId),
        note: `Type: ${entry.activityType}`
      }))
    : [];
  return [...observations, ...samples, ...activities]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id));
}
