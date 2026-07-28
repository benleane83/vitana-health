import {
  buildManualObservationImport,
  classifyValue,
  computeAnalyticsFromInput,
  defaultMeasurementTypes,
  getReferenceRange,
  resolveReferenceRange,
  type AppBootstrap,
  type HealthDataDetail,
  type HealthDataChartSeriesOptions,
  type HealthDataSummary,
  type ManualObservationPayload,
  MobileMigrationReceipt,
  type MobileDetailPage,
  type MobileImportResult,
  type MobileProfileRepository,
  type ParsedImport,
  type Profile,
  type UpdateObservationInput
} from "@vitana/shared";
import type { LocalStore } from "./localStore";

const DEFAULT_DETAIL_LIMIT = 50;
const MAX_DETAIL_LIMIT = 100;

export class LocalProfileRepository implements MobileProfileRepository {
  private initialized?: Promise<void>;

  constructor(
    private readonly store: LocalStore,
    private readonly defaultProfile: Profile
  ) {}

  async bootstrap(): Promise<AppBootstrap> {
    await this.ensureInitialized();
    const [profile, counts] = await Promise.all([this.store.getProfile(), this.store.counts()]);
    return {
      profile,
      measurementTypes: defaultMeasurementTypes,
      manualObservationGroupTemplates: [],
      counts: {
        imports: counts.imports,
        observations: counts.observations,
        samples: counts.samples,
        activities: counts.activities,
        healthEvents: counts.healthEvents,
        careItems: counts.careItems
      }
    };
  }

  listDatasets() {
    return this.store.listDatasets();
  }

  async createFreshDataset(profile: Profile): Promise<void> {
    await this.store.createDataset(profile);
    this.initialized = Promise.resolve();
  }

  async deleteSelectedDataset(): Promise<void> {
    await this.ensureInitialized();
    await this.store.deleteSelectedDataset();
    this.initialized = undefined;
  }

  async selectDataset(datasetId: string): Promise<void> {
    await this.store.selectDataset(datasetId);
    this.initialized = Promise.resolve();
  }

  async analytics() {
    await this.ensureInitialized();
    const [profile, counts, observations] = await Promise.all([
      this.store.getProfile(),
      this.store.counts(),
      this.store.latestObservationsByCode()
    ]);
    return computeAnalyticsFromInput({
      counts,
      measurementTypes: defaultMeasurementTypes,
      observations,
      units: profile.units,
      subjectKind: profile.subjectKind
    });
  }

  async summary(): Promise<HealthDataSummary> {
    await this.ensureInitialized();
    const aggregates = await this.store.observationAggregates();
    const registry = new Map(defaultMeasurementTypes.map((measurement) => [measurement.code, measurement]));
    const categoryOrder = ["activity", "cardio", "sleep", "body", "lab", "derived", "uncategorized"] as const;
    const grouped = new Map<string, HealthDataSummary["categories"][number]["rows"]>();
    for (const aggregate of aggregates) {
      const measurement = registry.get(aggregate.measurementCode);
      const category = measurement?.category ?? "uncategorized";
      const rows = grouped.get(category) ?? [];
      rows.push({
        code: aggregate.measurementCode,
        displayName: measurement?.display ?? aggregate.measurementCode,
        description: measurement?.description,
        category,
        aggregation: measurement?.aggregation,
        counts: { observations: aggregate.count, samples: 0, activities: 0, total: aggregate.count },
        lastMeasuredAt: aggregate.lastMeasuredAt
      });
      grouped.set(category, rows);
    }
    const categories = categoryOrder.flatMap((category) => {
      const rows = grouped.get(category);
      if (!rows?.length) return [];
      rows.sort((left, right) => (right.lastMeasuredAt ?? "").localeCompare(left.lastMeasuredAt ?? ""));
      const total = rows.reduce((sum, row) => sum + row.counts.total, 0);
      return [{
        key: category,
        label: categoryLabel(category),
        counts: { observations: total, samples: 0, activities: 0, total, types: rows.length },
        rows
      }];
    });
    const total = aggregates.reduce((sum, row) => sum + row.count, 0);
    return {
      generatedAt: new Date().toISOString(),
      totals: { observations: total, samples: 0, activities: 0, total, types: aggregates.length },
      categories
    };
  }

  async healthDataDetail(measurementCode: string, page: MobileDetailPage = {}): Promise<HealthDataDetail> {
    await this.ensureInitialized();
    const limit = Math.min(Math.max(Math.trunc(page.limit ?? DEFAULT_DETAIL_LIMIT), 1), MAX_DETAIL_LIMIT);
    const offset = Math.max(Math.trunc(page.offset ?? 0), 0);
    const result = await this.store.observationsByCode(measurementCode, limit, offset);
    const measurement = defaultMeasurementTypes.find((candidate) => candidate.code === measurementCode);
    const displayName = measurement?.display ?? measurementCode;
    const entries = result.records.map((record) => {
      const referenceRange = measurement ? getReferenceRange(measurement, record.unit) : undefined;
      return {
        kind: "observation" as const,
        id: record.id,
        measurementCode,
        displayName,
        timestamp: record.observedAt,
        value: record.value,
        unit: record.unit,
        sourceLabel: record.sourceLabel,
        sourceKind: record.sourceKind,
        importFileName: record.importFileName,
        importedAt: record.importedAt,
        note: record.note,
        observationGroup: record.group ? {
          id: record.group.id,
          kind: record.group.kind as NonNullable<HealthDataDetail["entries"][number]["observationGroup"]>["kind"],
          label: record.group.label,
          collectedAt: record.group.collectedAt
        } : undefined,
        referenceRange,
        status: measurement ? classifyValue(record.value, measurement, record.unit) : "unknown" as const,
        canDelete: true
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      measurement: {
        code: measurementCode,
        displayName,
        description: measurement?.description,
        category: measurement?.category ?? "uncategorized",
        aggregation: measurement?.aggregation,
        counts: { observations: result.total, samples: 0, activities: 0, total: result.total },
        lastMeasuredAt: entries[0]?.timestamp
      },
      entries,
      chartPoints: [...entries].reverse().map((entry) => ({
        kind: entry.kind,
        timestamp: entry.timestamp,
        value: entry.value,
        unit: entry.unit,
        referenceRange: entry.referenceRange
      })),
      referenceRange: measurement
        ? resolveReferenceRange(
            measurement,
            entries[0]?.unit ?? measurement.canonicalUnit,
            undefined,
            this.defaultProfile.subjectKind ?? "adult"
          )
        : { source: "none" },
      counts: { observations: result.total, samples: 0, activities: 0, total: result.total },
      deletion: { observationEntries: result.total, deletableEntries: result.total },
      pagination: {
        limit,
        loaded: Math.min(offset + entries.length, result.total),
        total: result.total,
        hasMore: offset + entries.length < result.total
      }
    };
  }

  async healthDataChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions) {
    await this.ensureInitialized();
    const measurement = defaultMeasurementTypes.find((candidate) => candidate.code === measurementCode);
    const series = await this.store.observationChartSeries(
      measurementCode,
      measurement?.aggregation ?? "none",
      options
    );
    return {
      ...series,
      points: series.points.map((point) => ({
        ...point,
        referenceRange: measurement ? getReferenceRange(measurement, point.unit) : undefined
      }))
    };
  }

  async updateObservation(id: string, input: UpdateObservationInput) {
    await this.ensureInitialized();
    const updatedObservation = await this.store.updateObservation(id, input);
    return updatedObservation
      ? { updatedObservation, counts: await this.bootstrap().then((value) => value.counts) }
      : undefined;
  }

  async deleteObservation(id: string) {
    await this.ensureInitialized();
    const deletedObservation = await this.store.deleteObservation(id);
    return deletedObservation
      ? { deletedCount: 1, deletedObservation, counts: await this.bootstrap().then((value) => value.counts) }
      : undefined;
  }

  async mergeImport(imported: ParsedImport): Promise<MobileImportResult> {
    await this.ensureInitialized();
    if (imported.timeSeriesSamples.length || imported.activitySessions.length) {
      throw new Error("This standalone proof of concept currently accepts observation imports only.");
    }
    return this.store.mergeImport(imported);
  }

  async migrationManifest() {
    await this.ensureInitialized();
    return this.store.migrationManifest();
  }

  async exportMigrationBatches(sessionId: string) {
    await this.ensureInitialized();
    return this.store.exportMigrationBatches(sessionId);
  }

  async archiveAfterMigration(receipt: MobileMigrationReceipt, serverUrl: string) {
    await this.ensureInitialized();
    return this.store.archiveAfterMigration(receipt, serverUrl);
  }

  async importManualObservations(payload: ManualObservationPayload): Promise<MobileImportResult> {
    const profile = (await this.bootstrap()).profile;
    const imported = buildManualObservationImport(payload, new Date().toISOString(), "custom", profile.units);
    if (imported.observations.length === 0) throw new Error("The import did not contain any valid observations.");
    return this.mergeImport(imported);
  }

  async close(): Promise<void> {
    if (this.initialized) await this.initialized;
    await this.store.close();
  }

  async reset(): Promise<void> {
    if (this.initialized) await this.initialized;
    await this.store.reset();
    this.initialized = undefined;
  }

  private ensureInitialized(): Promise<void> {
    this.initialized ??= this.store.initialize(this.defaultProfile);
    return this.initialized;
  }
}

function categoryLabel(category: string): string {
  if (category === "lab") return "Lab results";
  if (category === "cardio") return "Heart and circulation";
  return category.charAt(0).toUpperCase() + category.slice(1);
}
