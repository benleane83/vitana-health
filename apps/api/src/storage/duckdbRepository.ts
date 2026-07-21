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
  type Observation,
  type PersonalReferenceRangeInput,
  type Profile,
  type UpdateCareItemInput,
  type UpdateHealthEventInput,
  type UpdateObservationInput,
  type UpdateObservationResponse
} from "@local-fitness-advisor/shared";
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
import type { ImportMutationResult, ProfileImport, ProfileRepository } from "./profileRepository.js";
import {
  reconcileDefaultMeasurementTypes,
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
  getProfile as readProfile,
  insertObservationRecord as insertDuckDbObservationRecord,
  replaceProfile as replaceDuckDbProfile,
  updateCareItem as updateDuckDbCareItem,
  updateHealthEvent as updateDuckDbHealthEvent,
  updateObservation as updateDuckDbObservation,
  upsertPersonalReferenceRange as upsertDuckDbPersonalReferenceRange
} from "./duckdbCommands.js";
import {
  importObservationRecords as importDuckDbObservationRecords,
  mergeImport as mergeDuckDbImport
} from "./duckdbImportPersistence.js";
import {
  analyticsSummary as readAnalyticsSummary,
  appBootstrap as readAppBootstrap,
  biologicalAgeSource as readBiologicalAgeSource,
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
  exec
} from "./duckdbRows.js";

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
    await reconcileDefaultMeasurementTypes(this.connection, (operation) => this.transaction(operation));
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
    return this.transaction(() => replaceDuckDbProfile(this.connection, profile));
  }

  async mergeImport(parsed: DuckDbImport): Promise<ImportMutationResult> {
    this.assertOpen();
    return this.transaction(() => mergeDuckDbImport(this.connection, parsed));
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
    return this.transaction(() => createDuckDbHealthEvent(this.connection, input));
  }

  async updateHealthEvent(id: string, input: UpdateHealthEventInput): Promise<HealthEventMutationResponse | undefined> {
    this.assertOpen();
    return this.transaction(() => updateDuckDbHealthEvent(this.connection, id, input));
  }

  async deleteHealthEvent(id: string): Promise<DeleteHealthEventResponse | undefined> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbHealthEvent(this.connection, id));
  }

  async listCareItems(query: CareItemListQuery) {
    this.assertOpen();
    return readCareItems(this.connection, query);
  }

  async createCareItem(input: CreateCareItemInput): Promise<CareItemMutationResponse> {
    this.assertOpen();
    return this.transaction(() => createDuckDbCareItem(this.connection, input));
  }

  async updateCareItem(id: string, input: UpdateCareItemInput): Promise<CareItemMutationResponse | undefined> {
    this.assertOpen();
    return this.transaction(() => updateDuckDbCareItem(this.connection, id, input));
  }

  async deleteCareItem(id: string): Promise<DeleteCareItemResponse | undefined> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbCareItem(this.connection, id));
  }

  async insertObservationRecord(observation: Observation): Promise<boolean> {
    this.assertOpen();
    return this.transaction(() => insertDuckDbObservationRecord(this.connection, observation));
  }

  async importObservationRecords(parsed: Pick<DuckDbImport, "sourceImport" | "dataSource" | "observations">): Promise<number> {
    this.assertOpen();
    return this.transaction(() => importDuckDbObservationRecords(this.connection, parsed));
  }

  async deleteObservationRecord(id: string): Promise<boolean> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbObservationRecord(this.connection, id));
  }

  async deleteObservationRecordsByMeasurementCode(measurementCode: string): Promise<number> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbObservationRecordsByMeasurementCode(this.connection, measurementCode));
  }

  async deleteObservation(id: string): Promise<DeleteObservationResponse | undefined> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbObservation(this.connection, id));
  }

  async updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse | undefined> {
    this.assertOpen();
    return this.transaction(() => updateDuckDbObservation(this.connection, id, input));
  }

  async deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbObservationsByMeasurementCode(this.connection, measurementCode));
  }

  async deleteDailyAggregateStepSamples(): Promise<DeleteObservationsByTypeResponse> {
    this.assertOpen();
    return this.transaction(() => deleteDuckDbDailyAggregateStepSamples(this.connection));
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
    });
  }

  async deletePersonalReferenceRange(measurementCode: string) {
    this.assertOpen();
    return this.transaction(async () => {
      await deleteDuckDbPersonalReferenceRange(this.connection, measurementCode);
      return readReferenceRangeState(this.connection, measurementCode);
    });
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

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    await exec(this.connection, "BEGIN TRANSACTION;");
    try {
      const result = await operation();
      await this.testHooks.beforeTransactionCommit?.();
      await exec(this.connection, "COMMIT;");
      return result;
    } catch (error) {
      await exec(this.connection, "ROLLBACK;").catch(() => undefined);
      throw error;
    }
  }

}

export type DuckDbImport = ProfileImport;
