import { randomBytes } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import type duckdb from "duckdb";
import {
  healthStoreDataSchema,
  type AnalyticsSummary,
  type AppBootstrap,
  type BiologicalAgeSource,
  type CareItemListQuery,
  type CareItemMutationResponse,
  type CompleteCareItemInput,
  type CompleteCareItemResponse,
  type CreateCareItemInput,
  type CreateHealthEventInput,
  type DeleteCareItemResponse,
  type DeleteHealthEventResponse,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type HealthDataChartSeriesOptions,
  type HealthEventListQuery,
  type HealthEventMutationResponse,
  type HealthStoreData,
  type MobileMigrationBatch,
  type MobileMigrationManifest,
  type MeasurementPinState,
  type Observation,
  type PersonalReferenceRangeInput,
  type Profile,
  type ReplicaEntityType,
  type UpdateCareItemInput,
  type UpdateHealthEventInput,
  type UpdateObservationInput,
  type UpdateObservationResponse
} from "@vitana/shared";
import type { MeasurementDetailPage } from "../summary.js";
import type { ClinicianReportSourceImport } from "../clinicianReport.js";
import {
  closeEncryptedDuckDbDatabase,
  createDuckDbSchema,
  migrateDuckDbSchema,
  openEncryptedDuckDbDatabase,
  type DuckDbOptions,
  type EncryptedDuckDbDatabase
} from "./duckdbRuntime.js";
import type { ImportMutationResult, MeasurementRegistryResetResult, ProfileImport, ProfileRepository } from "./profileRepository.js";
import {
  reconcileDefaultMeasurementTypes,
  resetMeasurementTypeMetadataFromRegistry,
  schemaVersions as readSchemaVersions
} from "./duckdbSchema.js";
import {
  digestHealthStoreData,
  exportData as exportDuckDbData,
  firstDifferencePath,
  insertStore,
  snapshot as snapshotDuckDb
} from "./duckdbExport.js";
import {
  addInsight as addDuckDbInsight,
  completeCareItem as completeDuckDbCareItem,
  createCareItem as createDuckDbCareItem,
  createHealthEvent as createDuckDbHealthEvent,
  deleteCareItem as deleteDuckDbCareItem,
  deleteHealthEvent as deleteDuckDbHealthEvent,
  deleteObservation as deleteDuckDbObservation,
  deletePersonalReferenceRange as deleteDuckDbPersonalReferenceRange,
  deleteObservationRecord as deleteDuckDbObservationRecord,
  deleteObservationRecordsByMeasurementCode as deleteDuckDbObservationRecordsByMeasurementCode,
  deleteObservationsByMeasurementCode as deleteDuckDbObservationsByMeasurementCode,
  deleteDailyAggregateStepSamples as deleteDuckDbDailyAggregateStepSamples,
  deleteProfilePhoto as deleteDuckDbProfilePhoto,
  getProfilePhoto as readProfilePhoto,
  getProfile as readProfile,
  insertObservationRecord as insertDuckDbObservationRecord,
  pinMeasurement as pinDuckDbMeasurement,
  replaceProfile as replaceDuckDbProfile,
  replaceProfilePhoto as replaceDuckDbProfilePhoto,
  updateCareItem as updateDuckDbCareItem,
  updateHealthEvent as updateDuckDbHealthEvent,
  updateObservation as updateDuckDbObservation,
  unpinMeasurement as unpinDuckDbMeasurement,
  upsertPersonalReferenceRange as upsertDuckDbPersonalReferenceRange
} from "./duckdbCommands.js";
import {
  importObservationRecords as importDuckDbObservationRecords,
  mergeImport as mergeDuckDbImport
} from "./duckdbImportPersistence.js";
import {
  applyMobileMigrationBatch,
  completeMobileMigration,
  startMobileMigration
} from "./duckdbMigrationPersistence.js";
import {
  analyticsSummary as readAnalyticsSummary,
  appBootstrap as readAppBootstrap,
  biologicalAgeSource as readBiologicalAgeSource,
  clinicianReportLatestMeasurements as readClinicianReportLatestMeasurements,
  clinicianReportSourceImports as readClinicianReportSourceImports,
  countActivities as readActivityCounts,
  dailyMetrics as readDailyMetrics,
  latestMeasurement as readLatestMeasurement,
  listCareItems as readCareItems,
  listActivities as readActivities,
  listHealthEvents as readHealthEvents,
  measurementDetail as readMeasurementDetail,
  measurementChartSeries as readMeasurementChartSeries,
  measurementDetails as readMeasurementDetails,
  referenceRangeState as readReferenceRangeState,
  storageCounts as readStorageCounts,
  summary as readSummary,
  weeklyMetrics as readWeeklyMetrics,
  type DuckDbActivity,
  type DuckDbActivityCount,
  type DuckDbActivityQuery,
  type DuckDbDailyMetric,
  type DuckDbMeasurementValue,
  type DuckDbWeeklyMetric
} from "./duckdbProjections.js";
import {
  all,
  allWithParams,
  exec
} from "./duckdbRows.js";
import {
  createReplicaSnapshot,
  readReplicaDeltaPage,
  readReplicaSnapshotPage,
  recordReplicaChanges,
  recordReplicaEntityChanges,
  type ReplicaChangeInput,
  replicaHighWaterMark
} from "./duckdbReplicaSync.js";

export { digestHealthStoreData } from "./duckdbExport.js";
export type {
  DuckDbActivity,
  DuckDbActivityCount,
  DuckDbActivityQuery,
  DuckDbDailyMetric,
  DuckDbMeasurementValue,
  DuckDbWeeklyMetric
} from "./duckdbProjections.js";

export class DuckDbRepository implements ProfileRepository {
  private closed = false;

  private constructor(
    private readonly handle: EncryptedDuckDbDatabase,
    private readonly testHooks: NonNullable<DuckDbOptions["testHooks"]> = {}
  ) {}

  static async hydrate(
    root: string,
    databasePath: string,
    key: string,
    store: HealthStoreData,
    options: DuckDbOptions = {}
  ): Promise<DuckDbRepository> {
    if (existsSync(databasePath)) {
      throw new Error("DuckDB hydration requires a new database path.");
    }
    const validated = healthStoreDataSchema.parse(store) as HealthStoreData;
    const temporaryPath = `${databasePath}.hydrating-${process.pid}-${randomBytes(6).toString("hex")}`;
    await createDuckDbSchema(root, temporaryPath, key, options);
    const repository = await DuckDbRepository.open(root, temporaryPath, key, options);
    let transactionStarted = false;
    try {
      await exec(repository.connection, "BEGIN TRANSACTION;");
      transactionStarted = true;
      await insertStore(repository.connection, validated);
      await exec(repository.connection, "COMMIT;");
      transactionStarted = false;
      await repository.checkpoint();
      const exported = await repository.snapshot();
      if (digestHealthStoreData(exported) !== digestHealthStoreData(validated)) {
        throw new Error(`DuckDB hydration validation failed before atomic promotion at ${firstDifferencePath(validated, exported)}.`);
      }
      await repository.close();
      await options.testHooks?.beforeHydrationPromotion?.();
      renameSync(temporaryPath, databasePath);
      return DuckDbRepository.open(root, databasePath, key, options);
    } catch (error) {
      if (transactionStarted) {
        await exec(repository.connection, "ROLLBACK;").catch(() => undefined);
      }
      await repository.close().catch(() => undefined);
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  static async open(
    root: string,
    databasePath: string,
    key: string,
    options: DuckDbOptions = {}
  ): Promise<DuckDbRepository> {
    if (!existsSync(databasePath)) {
      throw new Error("DuckDB repository refuses to create an empty database while opening.");
    }
    const handle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    try {
      await migrateDuckDbSchema(handle);
      const repository = new DuckDbRepository(handle, options.testHooks);
      await repository.reconcileDefaultMeasurementTypes();
      return repository;
    } catch (error) {
      await closeEncryptedDuckDbDatabase(handle).catch(() => undefined);
      throw error;
    }
  }

  async schemaVersions(): Promise<number[]> {
    this.assertOpen();
    return readSchemaVersions(this.connection);
  }

  private async reconcileDefaultMeasurementTypes(): Promise<void> {
    await reconcileDefaultMeasurementTypes(this.connection, (operation) => this.transaction(operation, true));
  }

  async snapshot(options: { includeRaw?: boolean } = { includeRaw: true }): Promise<HealthStoreData> {
    this.assertOpen();
    return snapshotDuckDb(this.connection, options);
  }

  async appBootstrap(): Promise<AppBootstrap> {
    this.assertOpen();
    return readAppBootstrap(this.connection);
  }

  async analyticsSummary(): Promise<AnalyticsSummary> {
    this.assertOpen();
    return readAnalyticsSummary(this.connection);
  }

  async biologicalAgeSource(): Promise<BiologicalAgeSource> {
    this.assertOpen();
    return readBiologicalAgeSource(this.connection);
  }

  async clinicianReportLatestMeasurements() {
    this.assertOpen();
    return readClinicianReportLatestMeasurements(this.connection);
  }

  async clinicianReportSourceImports(): Promise<ClinicianReportSourceImport[]> {
    this.assertOpen();
    return readClinicianReportSourceImports(this.connection);
  }

  async storageCounts(): Promise<AppBootstrap["counts"]> {
    this.assertOpen();
    return readStorageCounts(this.connection);
  }

  async getProfile(): Promise<Profile> {
    this.assertOpen();
    return readProfile(this.connection);
  }

  async replaceProfile(profile: HealthStoreData["profile"]): Promise<HealthStoreData["profile"]> {
    this.assertOpen();
    return this.transaction(() => replaceDuckDbProfile(this.connection, profile), true);
  }

  async getProfilePhoto() {
    this.assertOpen();
    return readProfilePhoto(this.connection);
  }

  async replaceProfilePhoto(contentType: "image/jpeg", bytes: Buffer) {
    this.assertOpen();
    return this.transaction(() => replaceDuckDbProfilePhoto(this.connection, contentType, bytes));
  }

  async deleteProfilePhoto() {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbProfilePhoto(this.connection));
  }

  async resetMeasurementTypeMetadataFromRegistry(): Promise<MeasurementRegistryResetResult> {
    this.assertOpen();
    return resetMeasurementTypeMetadataFromRegistry(this.connection, (operation) => this.transaction(operation, true));
  }

  async mergeImport(parsed: DuckDbImport): Promise<ImportMutationResult> {
    this.assertOpen();
    return this.transaction(() => mergeDuckDbImport(this.connection, parsed), true);
  }

  async startMobileMigration(pairingId: string, manifest: MobileMigrationManifest) {
    this.assertOpen();
    const profile = await this.getProfile();
    return this.transaction(() => startMobileMigration(this.connection, {
      pairingId,
      destinationProfileId: profile.id
    }, manifest));
  }

  async applyMobileMigrationBatch(pairingId: string, batch: MobileMigrationBatch) {
    this.assertOpen();
    const profile = await this.getProfile();
    return this.transaction(() => applyMobileMigrationBatch(this.connection, {
      pairingId,
      destinationProfileId: profile.id
    }, batch), true);
  }

  async completeMobileMigration(pairingId: string, sessionId: string) {
    this.assertOpen();
    const profile = await this.getProfile();
    return this.transaction(() => completeMobileMigration(this.connection, {
      pairingId,
      destinationProfileId: profile.id
    }, sessionId));
  }

  async getReplicaHighWaterMark() {
    this.assertOpen();
    return replicaHighWaterMark(this.connection);
  }

  async startReplicaSnapshot(pairingId: string): Promise<string> {
    this.assertOpen();
    return this.transaction(async () =>
      createReplicaSnapshot(this.connection, pairingId, await snapshotDuckDb(this.connection, { includeRaw: false })));
  }

  async replicaSnapshotPage(pairingId: string, snapshotId: string, offset: number, limit: number) {
    this.assertOpen();
    return readReplicaSnapshotPage(this.connection, pairingId, snapshotId, offset, limit);
  }

  async replicaDeltaPage(afterSequence: number, highWaterSequence: number | undefined, limit: number) {
    this.assertOpen();
    return readReplicaDeltaPage(this.connection, afterSequence, highWaterSequence, limit);
  }

  async addInsight(insight: HealthStoreData["insights"][number]): Promise<HealthStoreData["insights"][number]> {
    this.assertOpen();
    return this.transaction(() => addDuckDbInsight(this.connection, insight));
  }

  async exportData(): Promise<HealthStoreData> {
    this.assertOpen();
    return this.transaction(() => exportDuckDbData(this.connection));
  }

  async listHealthEvents(query: HealthEventListQuery) {
    this.assertOpen();
    return readHealthEvents(this.connection, query);
  }

  async createHealthEvent(input: CreateHealthEventInput): Promise<HealthEventMutationResponse> {
    this.assertOpen();
    return this.transaction(
      () => createDuckDbHealthEvent(this.connection, input),
      (result) => [replicaUpsert("health-event", result.healthEvent.id, result.healthEvent)]
    );
  }

  async updateHealthEvent(id: string, input: UpdateHealthEventInput): Promise<HealthEventMutationResponse | undefined> {
    this.assertOpen();
    return this.transaction(
      () => updateDuckDbHealthEvent(this.connection, id, input),
      (result) => result
        ? [replicaUpsert("health-event", result.healthEvent.id, result.healthEvent)]
        : []
    );
  }

  async deleteHealthEvent(id: string): Promise<DeleteHealthEventResponse | undefined> {
    this.assertOpen();
    return this.transaction(
      () => deleteDuckDbHealthEvent(this.connection, id),
      (result) => result?.deletedHealthEvent
        ? [replicaTombstone("health-event", result.deletedHealthEvent.id)]
        : []
    );
  }

  async listCareItems(query: CareItemListQuery) {
    this.assertOpen();
    return readCareItems(this.connection, query);
  }

  async createCareItem(input: CreateCareItemInput): Promise<CareItemMutationResponse> {
    this.assertOpen();
    return this.transaction(
      () => createDuckDbCareItem(this.connection, input),
      (result) => [replicaUpsert("care-item", result.careItem.id, result.careItem)]
    );
  }

  async updateCareItem(id: string, input: UpdateCareItemInput): Promise<CareItemMutationResponse | undefined> {
    this.assertOpen();
    return this.transaction(
      () => updateDuckDbCareItem(this.connection, id, input),
      (result) => result
        ? [replicaUpsert("care-item", result.careItem.id, result.careItem)]
        : []
    );
  }

  async completeCareItem(id: string, input: CompleteCareItemInput): Promise<CompleteCareItemResponse | undefined> {
    this.assertOpen();
    return this.transaction(
      () => completeDuckDbCareItem(this.connection, id, input),
      (result) => result ? [
        replicaUpsert("care-item", result.careItem.id, replicaCareItem(result.careItem)),
        replicaUpsert("health-event", result.healthEvent.id, result.healthEvent)
      ] : []
    );
  }

  async deleteCareItem(id: string): Promise<DeleteCareItemResponse | undefined> {
    this.assertOpen();
    return this.transaction(
      () => deleteDuckDbCareItem(this.connection, id),
      (result) => result?.deletedCareItem
        ? [replicaTombstone("care-item", result.deletedCareItem.id)]
        : []
    );
  }

  async insertObservationRecord(observation: Observation): Promise<boolean> {
    this.assertOpen();
    return this.transaction(
      () => insertDuckDbObservationRecord(this.connection, observation),
      (inserted) => inserted ? replicaObservationUpsert(observation) : []
    );
  }

  async importObservationRecords(parsed: Pick<DuckDbImport, "sourceImport" | "dataSource" | "observations">): Promise<number> {
    this.assertOpen();
    const result = await this.transaction(
      () => importDuckDbObservationRecords(this.connection, parsed),
      (imported) => [
        ...(imported.sourceImport
          ? [replicaUpsert("source-import", imported.sourceImport.id, replicaSourceImport(imported.sourceImport))]
          : []),
        ...(imported.dataSource
          ? [replicaUpsert("data-source", imported.dataSource.id, imported.dataSource)]
          : []),
        ...imported.observations.flatMap(replicaObservationUpsert)
      ]
    );
    return result.count;
  }

  async deleteObservationRecord(id: string): Promise<boolean> {
    this.assertOpen();
    let replicated = false;
    return this.transaction(async () => {
      const rows = await allWithParams(
        this.connection,
        "SELECT measurement_code FROM observations WHERE id = ? LIMIT 1;",
        id
      );
      replicated = rows[0]?.measurement_code !== "heart_rate";
      return deleteDuckDbObservationRecord(this.connection, id);
    }, (deleted) => deleted && replicated ? [replicaTombstone("observation", id)] : []);
  }

  async deleteObservationRecordsByMeasurementCode(measurementCode: string): Promise<number> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbObservationRecordsByMeasurementCode(this.connection, measurementCode), true);
  }

  async deleteObservation(id: string): Promise<DeleteObservationResponse | undefined> {
    this.assertOpen();
    return this.transaction(
      () => deleteDuckDbObservation(this.connection, id),
      (result) => result?.deletedObservation?.measurementCode !== "heart_rate" && result?.deletedObservation
        ? [replicaTombstone("observation", result.deletedObservation.id)]
        : []
    );
  }

  async updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse | undefined> {
    this.assertOpen();
    let previouslyReplicated = false;
    return this.transaction(async () => {
      const rows = await allWithParams(
        this.connection,
        "SELECT measurement_code FROM observations WHERE id = ? LIMIT 1;",
        id
      );
      previouslyReplicated = rows[0]?.measurement_code !== "heart_rate";
      return updateDuckDbObservation(this.connection, id, input);
    }, (result) => {
      if (!result) return [];
      const changes = replicaObservationUpsert(result.updatedObservation);
      if (changes.length === 0 && previouslyReplicated) {
        return [replicaTombstone("observation", id)];
      }
      return changes;
    });
  }

  async deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbObservationsByMeasurementCode(this.connection, measurementCode), true);
  }

  async deleteDailyAggregateStepSamples(): Promise<DeleteObservationsByTypeResponse> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbDailyAggregateStepSamples(this.connection), true);
  }

  async summary() {
    this.assertOpen();
    return readSummary(this.connection);
  }

  async measurementDetail(measurementCode: string, page: MeasurementDetailPage = { offset: 0, limit: 100 }) {
    this.assertOpen();
    return readMeasurementDetail(this.connection, measurementCode, page);
  }

  async measurementChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions) {
    this.assertOpen();
    return readMeasurementChartSeries(this.connection, measurementCode, options);
  }

  async upsertPersonalReferenceRange(
    measurementCode: string,
    input: PersonalReferenceRangeInput
  ) {
    this.assertOpen();
    return this.transaction(async () => {
      await upsertDuckDbPersonalReferenceRange(this.connection, measurementCode, input);
      return readReferenceRangeState(this.connection, measurementCode);
    }, true);
  }

  async deletePersonalReferenceRange(measurementCode: string) {
    this.assertOpen();
    return this.transaction(async () => {
      await deleteDuckDbPersonalReferenceRange(this.connection, measurementCode);
      return readReferenceRangeState(this.connection, measurementCode);
    }, true);
  }

  async pinMeasurement(measurementCode: string): Promise<MeasurementPinState> {
    this.assertOpen();
    return this.transaction(
      () => pinDuckDbMeasurement(this.connection, measurementCode),
      (result) => result.changed && result.pin
        ? [replicaUpsert("pinned-measurement", measurementCode, result.pin)]
        : []
    ).then((result) => ({
      measurementCode,
      isPinned: true,
      pinnedAt: result.pin?.pinnedAt
    }));
  }

  async unpinMeasurement(measurementCode: string): Promise<MeasurementPinState> {
    this.assertOpen();
    return this.transaction(
      () => unpinDuckDbMeasurement(this.connection, measurementCode),
      (result) => result.changed ? [replicaTombstone("pinned-measurement", measurementCode)] : []
    ).then(() => ({ measurementCode, isPinned: false }));
  }

  async dailyMetrics(measurementCode?: string): Promise<DuckDbDailyMetric[]> {
    this.assertOpen();
    return readDailyMetrics(this.connection, measurementCode);
  }

  async weeklyMetrics(measurementCode?: string): Promise<DuckDbWeeklyMetric[]> {
    this.assertOpen();
    return readWeeklyMetrics(this.connection, measurementCode);
  }

  async latestMeasurement(measurementCode: string): Promise<DuckDbMeasurementValue | undefined> {
    this.assertOpen();
    return readLatestMeasurement(this.connection, measurementCode);
  }

  async measurementDetails(measurementCode: string, limit?: number): Promise<DuckDbMeasurementValue[]> {
    this.assertOpen();
    return readMeasurementDetails(this.connection, measurementCode, limit);
  }

  async listActivities(options: DuckDbActivityQuery): Promise<DuckDbActivity[]> {
    this.assertOpen();
    return readActivities(this.connection, options);
  }

  async countActivities(options: DuckDbActivityQuery): Promise<DuckDbActivityCount[]> {
    this.assertOpen();
    return readActivityCounts(this.connection, options);
  }

  async runCompiledQuery(sql: string): Promise<Array<Record<string, unknown>>> {
    this.assertOpen();
    return all(this.connection, sql);
  }

  async checkpoint(): Promise<void> {
    this.assertOpen();
    await exec(this.connection, "CHECKPOINT;");
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await closeEncryptedDuckDbDatabase(this.handle);
  }

  private get connection(): duckdb.Connection {
    return this.handle.connection;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("DuckDB repository is closed.");
    }
  }

  private async transaction<T>(
    operation: () => Promise<T>,
    trackReplica: boolean | ((result: T) => ReplicaChangeInput[]) = false
  ): Promise<T> {
    await exec(this.connection, "BEGIN TRANSACTION;");
    try {
      const before = trackReplica === true ? await this.replicaSnapshot() : undefined;
      const result = await operation();
      if (typeof trackReplica === "function") {
        await recordReplicaEntityChanges(this.connection, trackReplica(result));
      } else if (before) {
        await recordReplicaChanges(
          this.connection,
          before,
          await this.replicaSnapshot()
        );
      }
      await this.testHooks.beforeTransactionCommit?.();
      await exec(this.connection, "COMMIT;");
      return result;
    } catch (error) {
      await exec(this.connection, "ROLLBACK;").catch(() => undefined);
      throw error;
    }
  }

  private async replicaSnapshot(): Promise<HealthStoreData> {
    await this.testHooks.beforeReplicaSnapshot?.();
    return snapshotDuckDb(this.connection, { includeRaw: false });
  }

}

function replicaUpsert(
  entityType: ReplicaEntityType,
  entityId: string,
  payload: object
): ReplicaChangeInput {
  return {
    entityType,
    entityId,
    operation: "upsert",
    payload: payload as Record<string, unknown>
  };
}

function replicaTombstone(entityType: ReplicaEntityType, entityId: string): ReplicaChangeInput {
  return { entityType, entityId, operation: "tombstone" };
}

function replicaObservationUpsert(observation: Observation): ReplicaChangeInput[] {
  return observation.measurementCode === "heart_rate"
    ? []
    : [replicaUpsert("observation", observation.id, observation)];
}

function replicaSourceImport(sourceImport: DuckDbImport["sourceImport"]): object {
  const { rawContent: _rawContent, ...replicaImport } = sourceImport;
  return replicaImport;
}

function replicaCareItem(careItem: CompleteCareItemResponse["careItem"]): Record<string, unknown> {
  const { completedHealthEvent: _completedHealthEvent, ...payload } = careItem;
  return payload;
}

export type DuckDbImport = ProfileImport;
