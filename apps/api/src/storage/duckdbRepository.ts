import { randomBytes } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import type duckdb from "duckdb";
import {
  healthStoreDataSchema,
  type AnalyticsSummary,
  type AppBootstrap,
  type BiologicalAgeSource,
  type BodyTrendDateQuery,
  type BodyTrendQuery,
  type CalendarMonthQuery,
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
  HEALTH_CONNECT_SYNC_PROTOCOL_VERSION,
  type HealthConnectSyncBatchAcknowledgement,
  type HealthDataChartSeriesOptions,
  type HealthEventListQuery,
  type HealthEventMutationResponse,
  type HealthStoreData,
  type JournalQuery,
  type MobileMigrationBatch,
  type MobileMigrationManifest,
  type MeasurementPinState,
  type Observation,
  type ObservationGroupDetail,
  type PersonalReferenceRange,
  type PersonalReferenceRangeInput,
  type Profile,
  type ReplicaEntityType,
  type SleepSessionListQueryContract,
  type SleepSessionPage,
  type UpdateCareItemInput,
  type UpdateHealthEventInput,
  type UpdateObservationInput,
  type UpdateObservationGroupInput,
  type UpdateObservationResponse
} from "@vitana/shared";
import type { MeasurementDetailPage } from "../summary.js";
import type { ClinicianReportSourceImport } from "../clinicianReport.js";
import type { CompiledQuery } from "../queryCompiler.js";
import {
  applyAnalyticalViews,
  backupDatabaseFile,
  closeEncryptedDuckDbDatabase,
  createDuckDbSchema,
  duckDbSchemaMigrationRequired,
  migrateDuckDbSchema,
  openEncryptedDuckDbDatabase,
  restoreDatabaseBackup,
  SchemaMigrationError,
  type DuckDbOptionsWithTestHooks,
  type DuckDbTestHooks,
  type EncryptedDuckDbDatabase
} from "./duckdbRuntime.js";
import { pruneRetention } from "./duckdbRetention.js";
import type { BackupExportCollection, ImportMutationResult, MeasurementRegistryResetResult, ProfileImport, ProfileRepository } from "./profileRepository.js";
import {
  reconcileDefaultMeasurementTypes,
  resetMeasurementTypeMetadataFromRegistry,
  schemaVersions as readSchemaVersions
} from "./duckdbSchema.js";
import {
  backupExportMetadata as readBackupExportMetadata,
  backupExportPage as readBackupExportPage,
  digestHealthStoreData,
  recordExportAudit,
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
  deleteStepSamples as deleteDuckDbStepSamples,
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
  updateObservationGroup as updateDuckDbObservationGroup,
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
  findHealthConnectSyncAcknowledgement,
  findHealthConnectSyncSession,
  recordHealthConnectSyncAcknowledgement,
  startHealthConnectSyncSession,
  summarizeHealthConnectSyncCounts,
  type HealthConnectSyncSessionStart
} from "./duckdbHealthConnectSync.js";
import {
  analyticsSummary as readAnalyticsSummary,
  appBootstrap as readAppBootstrap,
  insightReviewContext as readInsightReviewContext,
  bodyTrendDateDetail as readBodyTrendDateDetail,
  bodyTrendTimeline as readBodyTrendTimeline,
  calendarMonth as readCalendarMonth,
  biologicalAgeSource as readBiologicalAgeSource,
  clinicianReportLatestMeasurements as readClinicianReportLatestMeasurements,
  clinicianReportSourceImports as readClinicianReportSourceImports,
  countActivities as readActivityCounts,
  dailyMetrics as readDailyMetrics,
  latestMeasurement as readLatestMeasurement,
  listCareItems as readCareItems,
  listActivities as readActivities,
  listHealthEvents as readHealthEvents,
  journal as readJournal,
  measurementDetail as readMeasurementDetail,
  measurementChartSeries as readMeasurementChartSeries,
  measurementDetails as readMeasurementDetails,
  observationGroupDetail as readObservationGroupDetail,
  referenceRangeState as readReferenceRangeState,
  sleepSessions as readSleepSessions,
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
  recordReplicaEntityChanges,
  replicaHighWaterMark
} from "./duckdbReplicaSync.js";
import {
  replicaObservationTombstones,
  replicaObservationUpsert,
  replicaSourceImport,
  replicaTombstone,
  replicaUpsert,
  type ReplicaChangeInput
} from "./duckdbReplicaChanges.js";

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
  /** Held as a promise so concurrent readers share one scan rather than racing six of them. */
  private countsCache: Promise<AppBootstrap["counts"]> | undefined;

  private constructor(
    private readonly handle: EncryptedDuckDbDatabase,
    private readonly testHooks: DuckDbTestHooks = {}
  ) {}

  static async hydrate(
    root: string,
    databasePath: string,
    key: string,
    store: HealthStoreData,
    options: DuckDbOptionsWithTestHooks = {}
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
    options: DuckDbOptionsWithTestHooks = {}
  ): Promise<DuckDbRepository> {
    if (!existsSync(databasePath)) {
      throw new Error("DuckDB repository refuses to create an empty database while opening.");
    }
    let handle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
    let migrationBackupPath: string | undefined;
    try {
      if (await duckDbSchemaMigrationRequired(handle)) {
        await exec(handle.connection, "CHECKPOINT;");
        await closeEncryptedDuckDbDatabase(handle);
        migrationBackupPath = backupDatabaseFile(handle.databasePath);
        handle = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
      }
      await migrateDuckDbSchema(handle, undefined, false, migrationBackupPath);
      await applyAnalyticalViews(handle.connection);
      await pruneRetention(handle.connection);
      const repository = new DuckDbRepository(handle, options.testHooks);
      await repository.reconcileDefaultMeasurementTypes();
      return repository;
    } catch (error) {
      await closeEncryptedDuckDbDatabase(handle).catch(() => undefined);
      // The file is only replaceable now that nothing holds it open, so the pre-migration copy goes
      // back here rather than inside the migrator.
      const backupPath = error instanceof SchemaMigrationError ? error.backupPath : migrationBackupPath;
      if (backupPath) {
        restoreDatabaseBackup(backupPath, handle.databasePath);
      }
      throw error;
    }
  }

  async schemaVersions(): Promise<number[]> {
    this.assertOpen();
    return readSchemaVersions(this.reader);
  }

  private async reconcileDefaultMeasurementTypes(): Promise<void> {
    await reconcileDefaultMeasurementTypes(
      this.connection,
      (operation, replicaChanges) => this.transaction(operation, replicaChanges)
    );
  }

  async snapshot(options: { includeRaw?: boolean } = { includeRaw: true }): Promise<HealthStoreData> {
    this.assertOpen();
    return snapshotDuckDb(this.reader, options);
  }

  async backupExportMetadata() {
    this.assertOpen();
    return readBackupExportMetadata(this.reader);
  }

  async backupExportPage(collection: BackupExportCollection, offset: number, limit: number) {
    this.assertOpen();
    return readBackupExportPage(this.reader, collection, offset, limit);
  }

  async appBootstrap(): Promise<AppBootstrap> {
    this.assertOpen();
    return readAppBootstrap(this.reader, await this.storageCounts());
  }

  async analyticsSummary(): Promise<AnalyticsSummary> {
    this.assertOpen();
    return readAnalyticsSummary(this.reader);
  }

  async insightReviewContext() {
    this.assertOpen();
    return readInsightReviewContext(this.reader);
  }

  async biologicalAgeSource(): Promise<BiologicalAgeSource> {
    this.assertOpen();
    return readBiologicalAgeSource(this.reader);
  }

  async clinicianReportLatestMeasurements() {
    this.assertOpen();
    return readClinicianReportLatestMeasurements(this.reader);
  }

  async clinicianReportSourceImports(): Promise<ClinicianReportSourceImport[]> {
    this.assertOpen();
    return readClinicianReportSourceImports(this.reader);
  }

  async storageCounts(): Promise<AppBootstrap["counts"]> {
    this.assertOpen();
    // Six `COUNT(*)` scans that can only change inside a transaction. Bootstrap, every import and
    // every storage panel were re-running them to be told what the last call already knew.
    this.countsCache ??= (() => {
      this.testHooks.beforeStorageCountsRead?.();
      return readStorageCounts(this.reader).catch((error: unknown) => {
        this.countsCache = undefined;
        throw error;
      });
    })();
    return { ...await this.countsCache };
  }

  async getProfile(): Promise<Profile> {
    this.assertOpen();
    return readProfile(this.reader);
  }

  async replaceProfile(profile: HealthStoreData["profile"]): Promise<HealthStoreData["profile"]> {
    this.assertOpen();
    return this.transaction(
      () => replaceDuckDbProfile(this.connection, profile),
      (saved) => [replicaUpsert("profile", saved.id, saved)]
    );
  }

  async getProfilePhoto() {
    this.assertOpen();
    return readProfilePhoto(this.reader);
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
    return resetMeasurementTypeMetadataFromRegistry(
      this.connection,
      (operation, replicaChanges) => this.transaction(operation, replicaChanges)
    );
  }

  async mergeImport(parsed: DuckDbImport): Promise<ImportMutationResult> {
    this.assertOpen();
    const { replicaChanges: _replicaChanges, ...result } = await this.transaction(
      () => mergeDuckDbImport(this.connection, parsed),
      (merged) => merged.replicaChanges,
      { affectsStorageCounts: true }
    );
    return result;
  }

  async startHealthConnectSyncSession(pairingId: string, request: HealthConnectSyncSessionStart) {
    this.assertOpen();
    return this.transaction(() => startHealthConnectSyncSession(this.connection, pairingId, request));
  }

  /**
   * Applies one sync chunk and records its acknowledgement in the same transaction, so a retry after
   * a lost response replays the stored answer instead of importing the payload a second time.
   */
  async applyHealthConnectSyncChunk(
    pairingId: string,
    sessionId: string,
    batchId: string,
    parsed: DuckDbImport
  ): Promise<HealthConnectSyncBatchAcknowledgement | undefined> {
    this.assertOpen();
    if (!await findHealthConnectSyncSession(this.connection, pairingId, sessionId)) {
      return undefined;
    }
    const replayed = await findHealthConnectSyncAcknowledgement(this.connection, sessionId, batchId);
    if (replayed) {
      return replayed;
    }
    let acknowledgement: HealthConnectSyncBatchAcknowledgement | undefined;
    await this.transaction(
      async () => {
        const merged = await mergeDuckDbImport(this.connection, parsed);
        acknowledgement = {
          protocolVersion: HEALTH_CONNECT_SYNC_PROTOCOL_VERSION,
          sessionId,
          batchId,
          counts: summarizeHealthConnectSyncCounts(merged.outcome)
        };
        await recordHealthConnectSyncAcknowledgement(this.connection, acknowledgement);
        return merged;
      },
      (merged) => merged.replicaChanges,
      { affectsStorageCounts: true }
    );
    return acknowledgement;
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
    const { replicaChanges: _replicaChanges, ...acknowledgement } = await this.transaction(
      () => applyMobileMigrationBatch(this.connection, {
        pairingId,
        destinationProfileId: profile.id
      }, batch),
      (applied) => applied.replicaChanges,
      { affectsStorageCounts: true }
    );
    return acknowledgement;
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
    return replicaHighWaterMark(this.reader);
  }

  async startReplicaSnapshot(pairingId: string): Promise<string> {
    this.assertOpen();
    return this.transaction(async () =>
      createReplicaSnapshot(this.connection, pairingId, await snapshotDuckDb(this.connection, { includeRaw: false })));
  }

  async replicaSnapshotPage(pairingId: string, snapshotId: string, offset: number, limit: number) {
    this.assertOpen();
    return readReplicaSnapshotPage(this.reader, pairingId, snapshotId, offset, limit);
  }

  async replicaDeltaPage(afterSequence: number, highWaterSequence: number | undefined, limit: number) {
    this.assertOpen();
    return readReplicaDeltaPage(this.reader, afterSequence, highWaterSequence, limit);
  }

  async addInsight(insight: HealthStoreData["insights"][number]): Promise<HealthStoreData["insights"][number]> {
    this.assertOpen();
    return this.transaction(() => addDuckDbInsight(this.connection, insight));
  }

  async recordExportAudit(): Promise<void> {
    this.assertOpen();
    await this.transaction(() => recordExportAudit(this.connection));
  }

  async exportData(): Promise<HealthStoreData> {
    this.assertOpen();
    return snapshotDuckDb(this.reader, { includeRaw: true });
  }

  async listHealthEvents(query: HealthEventListQuery) {
    this.assertOpen();
    return readHealthEvents(this.reader, query);
  }

  async createHealthEvent(input: CreateHealthEventInput): Promise<HealthEventMutationResponse> {
    this.assertOpen();
    return this.transaction(
      () => createDuckDbHealthEvent(this.connection, input),
      (result) => [replicaUpsert("health-event", result.healthEvent.id, result.healthEvent)],
      { affectsStorageCounts: true }
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
        : [],
      { affectsStorageCounts: true }
    );
  }

  async listCareItems(query: CareItemListQuery) {
    this.assertOpen();
    return readCareItems(this.reader, query);
  }

  async createCareItem(input: CreateCareItemInput): Promise<CareItemMutationResponse> {
    this.assertOpen();
    return this.transaction(
      () => createDuckDbCareItem(this.connection, input),
      (result) => [replicaUpsert("care-item", result.careItem.id, result.careItem)],
      { affectsStorageCounts: true }
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
        ...(result.healthEvent
          ? [replicaUpsert("health-event", result.healthEvent.id, result.healthEvent)]
          : [])
      ] : [],
      { affectsStorageCounts: true }
    );
  }

  async deleteCareItem(id: string): Promise<DeleteCareItemResponse | undefined> {
    this.assertOpen();
    return this.transaction(
      () => deleteDuckDbCareItem(this.connection, id),
      (result) => result?.deletedCareItem
        ? [replicaTombstone("care-item", result.deletedCareItem.id)]
        : [],
      { affectsStorageCounts: true }
    );
  }

  async insertObservationRecord(observation: Observation): Promise<boolean> {
    this.assertOpen();
    return this.transaction(
      () => insertDuckDbObservationRecord(this.connection, observation),
      (inserted) => inserted ? replicaObservationUpsert(observation) : [],
      { affectsStorageCounts: true }
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
      ],
      { affectsStorageCounts: true }
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
    }, (deleted) => deleted && replicated ? [replicaTombstone("observation", id)] : [], {
      affectsStorageCounts: true
    });
  }

  async deleteObservationRecordsByMeasurementCode(measurementCode: string): Promise<number> {
    this.assertOpen();
    const result = await this.transaction(
      () => deleteDuckDbObservationRecordsByMeasurementCode(this.connection, measurementCode),
      (deleted) => replicaObservationTombstones(measurementCode, deleted.deletedIds),
      { affectsStorageCounts: true }
    );
    return result.deletedCount;
  }

  async deleteObservation(id: string): Promise<DeleteObservationResponse | undefined> {
    this.assertOpen();
    return this.transaction(
      () => deleteDuckDbObservation(this.connection, id),
      (result) => result?.deletedObservation?.measurementCode !== "heart_rate" && result?.deletedObservation
        ? [replicaTombstone("observation", result.deletedObservation.id)]
        : [],
      { affectsStorageCounts: true }
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

  async getObservationGroup(id: string): Promise<ObservationGroupDetail | undefined> {
    this.assertOpen();
    return readObservationGroupDetail(this.reader, id);
  }

  async updateObservationGroup(
    id: string,
    input: UpdateObservationGroupInput
  ): Promise<ObservationGroupDetail | undefined> {
    this.assertOpen();
    const result = await this.transaction(
      () => updateDuckDbObservationGroup(this.connection, id, input),
      (updated) => updated ? [
        ...updated.updatedObservations.flatMap(replicaObservationUpsert),
        ...updated.deletedIds.map((observationId) => replicaTombstone("observation", observationId))
      ] : [],
      { affectsStorageCounts: true }
    );
    return result ? readObservationGroupDetail(this.reader, id) : undefined;
  }

  async deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse> {
    this.assertOpen();
    const { deletedIds: _deletedIds, ...response } = await this.transaction(
      () => deleteDuckDbObservationsByMeasurementCode(this.connection, measurementCode),
      (deleted) => replicaObservationTombstones(measurementCode, deleted.deletedIds),
      { affectsStorageCounts: true }
    );
    return response;
  }

  async deleteDailyAggregateStepSamples(): Promise<DeleteObservationsByTypeResponse> {
    this.assertOpen();
    const { deletedIds: _deletedIds, ...response } = await this.transaction(
      () => deleteDuckDbDailyAggregateStepSamples(this.connection),
      (deleted) => deleted.deletedIds.map((id) => replicaTombstone("time-series-sample", id)),
      { affectsStorageCounts: true }
    );
    return response;
  }

  async deleteStepSamples(): Promise<DeleteObservationsByTypeResponse> {
    this.assertOpen();
    const { deletedIds: _deletedIds, ...response } = await this.transaction(
      () => deleteDuckDbStepSamples(this.connection),
      (deleted) => deleted.deletedIds.map((id) => replicaTombstone("time-series-sample", id)),
      { affectsStorageCounts: true }
    );
    return response;
  }

  async summary() {
    this.assertOpen();
    return readSummary(this.reader);
  }

  async bodyTrendTimeline(query: BodyTrendQuery) {
    this.assertOpen();
    return readBodyTrendTimeline(this.reader, query);
  }

  async bodyTrendDateDetail(date: string, query: BodyTrendDateQuery) {
    this.assertOpen();
    return readBodyTrendDateDetail(this.reader, date, query);
  }

  async calendarMonth(query: CalendarMonthQuery) {
    this.assertOpen();
    return readCalendarMonth(this.reader, query);
  }

  async journal(query: JournalQuery) {
    this.assertOpen();
    return readJournal(this.reader, query);
  }

  async sleepSessions(page: SleepSessionListQueryContract): Promise<SleepSessionPage> {
    this.assertOpen();
    return readSleepSessions(this.reader, page);
  }

  async measurementDetail(measurementCode: string, page: MeasurementDetailPage = { offset: 0, limit: 100 }) {
    this.assertOpen();
    return readMeasurementDetail(this.reader, measurementCode, page);
  }

  async measurementChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions) {
    this.assertOpen();
    return readMeasurementChartSeries(this.reader, measurementCode, options);
  }

  async upsertPersonalReferenceRange(
    measurementCode: string,
    input: PersonalReferenceRangeInput
  ) {
    this.assertOpen();
    let range: PersonalReferenceRange | undefined;
    return this.transaction(async () => {
      range = await upsertDuckDbPersonalReferenceRange(this.connection, measurementCode, input);
      return readReferenceRangeState(this.connection, measurementCode);
    }, () => range
      ? [replicaUpsert("personal-reference-range", measurementCode, range)]
      : []);
  }

  async deletePersonalReferenceRange(measurementCode: string) {
    this.assertOpen();
    return this.transaction(async () => {
      await deleteDuckDbPersonalReferenceRange(this.connection, measurementCode);
      return readReferenceRangeState(this.connection, measurementCode);
    }, () => [replicaTombstone("personal-reference-range", measurementCode)]);
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
    return readDailyMetrics(this.reader, measurementCode);
  }

  async weeklyMetrics(measurementCode?: string): Promise<DuckDbWeeklyMetric[]> {
    this.assertOpen();
    return readWeeklyMetrics(this.reader, measurementCode);
  }

  async latestMeasurement(measurementCode: string): Promise<DuckDbMeasurementValue | undefined> {
    this.assertOpen();
    return readLatestMeasurement(this.reader, measurementCode);
  }

  async measurementDetails(measurementCode: string, limit?: number): Promise<DuckDbMeasurementValue[]> {
    this.assertOpen();
    return readMeasurementDetails(this.reader, measurementCode, limit);
  }

  async listActivities(options: DuckDbActivityQuery): Promise<DuckDbActivity[]> {
    this.assertOpen();
    return readActivities(this.reader, options);
  }

  async countActivities(options: DuckDbActivityQuery): Promise<DuckDbActivityCount[]> {
    this.assertOpen();
    return readActivityCounts(this.reader, options);
  }

  async runCompiledQuery(query: CompiledQuery): Promise<Array<Record<string, unknown>>> {
    this.assertOpen();
    // A plan compiled for another engine would either fail with a parser error or, worse, parse
    // and mean something subtly different. Refuse it where the mismatch is still legible.
    if (query.dialect !== "duckdb") {
      throw new Error(`This profile runs on DuckDB and cannot execute a ${query.dialect} query plan.`);
    }
    return allWithParams(this.reader, query.sql, ...query.parameters);
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

  /**
   * Reads run on their own connection so a dashboard request is not stuck behind a queued import.
   * Anything that reads its own writes - the bodies of `transaction` callbacks - must keep using
   * `connection`, because this one only ever sees committed state.
   */
  private get reader(): duckdb.Connection {
    return this.handle.readConnection;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("DuckDB repository is closed.");
    }
  }

  /**
   * Runs an operation in a transaction. Mutations that feed the companion replica declare the
   * entities they touched via `replicaChanges`; there is deliberately no whole-store diff, which
   * used to make every tracked write O(store size).
   */
  private async transaction<T>(
    operation: () => Promise<T>,
    replicaChanges?: (result: T) => ReplicaChangeInput[],
    impact: TransactionImpact = {}
  ): Promise<T> {
    await exec(this.connection, "BEGIN TRANSACTION;");
    try {
      const result = await operation();
      if (replicaChanges) {
        await recordReplicaEntityChanges(this.connection, replicaChanges(result));
      }
      await this.testHooks.beforeTransactionCommit?.();
      await exec(this.connection, "COMMIT;");
      if (impact.affectsStorageCounts) {
        this.countsCache = undefined;
      }
      return result;
    } catch (error) {
      await exec(this.connection, "ROLLBACK;").catch(() => undefined);
      throw error;
    }
  }

}

interface TransactionImpact {
  affectsStorageCounts?: boolean;
}

function replicaCareItem(careItem: CompleteCareItemResponse["careItem"]): Record<string, unknown> {
  const { completedHealthEvent: _completedHealthEvent, ...payload } = careItem;
  return payload;
}

export type DuckDbImport = ProfileImport;
