import {
  CURRENT_SCHEMA_VERSION,
  classifyValueWithRange,
  computeAnalytics,
  getPreferredUnit,
  resolveReferenceRange,
  toPreferredMeasurementValue,
  type ActivitySession,
  type AppBootstrap,
  type DataSource,
  type HealthDataDetail,
  type HealthDataDetailEntry,
  type HealthDataSummary,
  type HealthDataSummaryTypeRow,
  type HealthStoreData,
  type MeasurementType,
  type Observation,
  type ObservationGroup,
  type PersonalReferenceRange,
  type Profile,
  type ReplicaIdentity,
  type SourceImport,
  type TimeSeriesSample
} from "@vitana/shared";
import type { LocalStore } from "../standalone/localStore";

export class ConnectedReplicaRepository {
  constructor(
    private readonly store: LocalStore,
    readonly identity: ReplicaIdentity
  ) {}

  async bootstrap(): Promise<AppBootstrap> {
    const data = await this.readStore();
    return {
      profile: data.profile,
      measurementTypes: data.measurementTypes,
      manualObservationGroupTemplates: [],
      counts: {
        imports: data.sourceImports.length,
        observations: data.observations.length,
        samples: data.timeSeriesSamples.length,
        activities: data.activitySessions.length,
        healthEvents: 0,
        careItems: 0
      }
    };
  }

  async analytics() {
    return computeAnalytics(await this.readStore());
  }

  async summary(): Promise<HealthDataSummary> {
    return summarize(await this.readStore());
  }

  async healthDataDetail(measurementCode: string, page: { limit?: number; offset?: number } = {}): Promise<HealthDataDetail> {
    const data = await this.readStore();
    const allEntries = detailEntries(data, measurementCode);
    const limit = Math.min(Math.max(Math.trunc(page.limit ?? 50), 1), 100);
    const offset = Math.max(Math.trunc(page.offset ?? 0), 0);
    const entries = allEntries.slice(offset, offset + limit);
    const type = data.measurementTypes.find((entry) => entry.code === measurementCode);
    const summaryRow = summaryRowFor(data, measurementCode);
    const referenceRange = type
      ? resolveReferenceRange(
          type,
          getPreferredUnit(type, data.profile.units),
          data.personalReferenceRanges.find((range) => range.measurementCode === measurementCode),
          data.profile.subjectKind
        )
      : { source: "none" as const };
    return {
      generatedAt: new Date().toISOString(),
      measurement: summaryRow,
      referenceRange,
      entries,
      chartPoints: [...allEntries].reverse().map(({ kind, timestamp, value, unit, referenceRange }) => ({
        kind,
        timestamp,
        value,
        unit,
        referenceRange
      })),
      counts: summaryRow.counts,
      deletion: { observationEntries: 0, deletableEntries: 0 },
      pagination: {
        limit,
        loaded: Math.min(offset + entries.length, allEntries.length),
        total: allEntries.length,
        hasMore: offset + entries.length < allEntries.length
      }
    };
  }

  metadata() {
    return this.store.replicaMetadata(this.identity);
  }

  close() {
    return this.store.close();
  }

  private async readStore(): Promise<HealthStoreData> {
    const rows = await this.store.replicaEntities(this.identity);
    const values = <T>(entityType: string) =>
      rows.filter((row) => row.entityType === entityType).map((row) => row.payload as T);
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
      observationGroups: values<ObservationGroup>("observation-group"),
      observations: values<Observation>("observation"),
      timeSeriesSamples: values<TimeSeriesSample>("time-series-sample"),
      activitySessions: values<ActivitySession>("activity-session"),
      healthEvents: [],
      careItems: [],
      insights: [],
      auditEvents: []
    };
  }
}

function summarize(data: HealthStoreData): HealthDataSummary {
  const codes = new Set([
    ...data.observations.map((entry) => entry.measurementCode),
    ...data.timeSeriesSamples.map((entry) => entry.measurementCode),
    ...(data.activitySessions.length ? ["activity_sessions"] : [])
  ]);
  const rows = [...codes].map((code) => summaryRowFor(data, code));
  const grouped = new Map<HealthDataSummaryTypeRow["category"], HealthDataSummaryTypeRow[]>();
  for (const row of rows) grouped.set(row.category, [...(grouped.get(row.category) ?? []), row]);
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

function summaryRowFor(data: HealthStoreData, code: string): HealthDataSummaryTypeRow {
  const type = data.measurementTypes.find((entry) => entry.code === code);
  const observations = data.observations.filter((entry) => entry.measurementCode === code);
  const samples = data.timeSeriesSamples.filter((entry) => entry.measurementCode === code);
  const activities = code === "activity_sessions" ? data.activitySessions : [];
  const timestamps = [
    ...observations.map((entry) => entry.observedAt),
    ...samples.map((entry) => entry.endAt),
    ...activities.map((entry) => entry.endAt ?? entry.startAt)
  ].sort();
  const total = observations.length + samples.length + activities.length;
  return {
    code,
    displayName: code === "activity_sessions" ? "Activity sessions" : (type?.display ?? code),
    description: type?.description,
    category: code === "activity_sessions" ? "activity" : (type?.category ?? "uncategorized"),
    counts: { observations: observations.length, samples: samples.length, activities: activities.length, total },
    lastMeasuredAt: timestamps.at(-1)
  };
}

function detailEntries(data: HealthStoreData, measurementCode: string): HealthDataDetailEntry[] {
  const type = data.measurementTypes.find((entry) => entry.code === measurementCode);
  const displayName = measurementCode === "activity_sessions" ? "Activity sessions" : (type?.display ?? measurementCode);
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
      canDelete: false,
      deleteLabel: "Read-only while connected"
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
  const activities = measurementCode === "activity_sessions"
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
