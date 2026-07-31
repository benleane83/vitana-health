import type {
  AppBootstrap,
  AnalyticsSummary,
  BiologicalAgeSource,
  ClinicianReportLatestMeasurement,
  CareItemListQuery,
  CareItemMutationResponse,
  CompleteCareItemInput,
  CompleteCareItemResponse,
  CreateCareItemInput,
  CreateHealthEventInput,
  DataSource,
  DeleteCareItemResponse,
  DeleteHealthEventResponse,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataChartSeries,
  HealthDataChartSeriesOptions,
  HealthDataDetail,
  HealthDataSummary,
  HealthEventListQuery,
  HealthEventMutationResponse,
  HealthStoreData,
  ImportCategoryOutcome,
  LinkedCareItemConflict,
  MeasurementAggregate,
  MeasurementPinState,
  MobileMigrationBatch,
  MobileMigrationBatchAcknowledgement,
  MobileMigrationManifest,
  MobileMigrationReceipt,
  MobileMigrationStartResponse,
  PaginatedResult,
  PersonalReferenceRangeInput,
  CareItem,
  HealthEvent,
  Profile,
  ProfilePhotoMetadata,
  ReferenceRangeState,
  ReplicaHighWaterMark,
  SourceImport,
  UpdateCareItemInput,
  UpdateHealthEventInput,
  UpdateObservationInput,
  UpdateObservationResponse
} from "@vitana/shared";
import type {
  HealthConnectSyncBatchAcknowledgement,
  HealthConnectSyncSessionResponse
} from "@vitana/shared";
import type { HealthConnectSyncSessionStart, StoredReplicaPage } from "./types.js";
import type { MeasurementDetailPage } from "../summary.js";
import type { ClinicianReportSourceImport } from "../clinicianReport.js";
import type { CompiledQuery } from "../queryCompiler.js";

export interface ProfileImport {
  sourceImport: SourceImport;
  dataSource: DataSource;
  observations: HealthStoreData["observations"];
  observationGroups: HealthStoreData["observationGroups"];
  timeSeriesSamples: HealthStoreData["timeSeriesSamples"];
  measurementAggregates: MeasurementAggregate[];
  activitySessions: HealthStoreData["activitySessions"];
}

export type { ImportCategoryOutcome };

export interface ImportOutcome {
  sourceImport: ImportCategoryOutcome;
  dataSource: ImportCategoryOutcome;
  observations: ImportCategoryOutcome;
  observationGroups: ImportCategoryOutcome;
  timeSeriesSamples: ImportCategoryOutcome;
  measurementAggregates: ImportCategoryOutcome;
  activitySessions: ImportCategoryOutcome;
}

export interface ImportMutationResult {
  counts: AppBootstrap["counts"];
  outcome: ImportOutcome;
  auditEvent: HealthStoreData["auditEvents"][number];
}

export interface MeasurementRegistryResetResult {
  refreshed: number;
  inserted: number;
}

export interface StoredProfilePhoto extends ProfilePhotoMetadata {
  contentType: "image/jpeg";
  bytes: Buffer;
}

export class RepositoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryValidationError";
  }
}

export class HealthEventDeleteConflictError extends Error {
  readonly code = "CARE_HEALTH_EVENT_LINK_CONFLICT" as const;

  constructor(readonly linkedCareItems: LinkedCareItemConflict[]) {
    super("This health event is still linked to one or more care items.");
    this.name = "HealthEventDeleteConflictError";
  }
}

export class CareItemCompletionConflictError extends Error {
  readonly code = "CARE_ITEM_NOT_OPEN" as const;

  constructor() {
    super("Only open care items can be completed.");
    this.name = "CareItemCompletionConflictError";
  }
}

export interface ProfileRepository {
  appBootstrap(): Promise<AppBootstrap>;
  analyticsSummary(): Promise<AnalyticsSummary>;
  biologicalAgeSource(): Promise<BiologicalAgeSource>;
  clinicianReportLatestMeasurements(): Promise<ClinicianReportLatestMeasurement[]>;
  clinicianReportSourceImports(): Promise<ClinicianReportSourceImport[]>;
  storageCounts(): Promise<AppBootstrap["counts"]>;
  getProfile(): Promise<Profile>;
  replaceProfile(profile: Profile): Promise<Profile>;
  getProfilePhoto(): Promise<StoredProfilePhoto | undefined>;
  replaceProfilePhoto(contentType: "image/jpeg", bytes: Buffer): Promise<StoredProfilePhoto>;
  deleteProfilePhoto(): Promise<boolean>;
  resetMeasurementTypeMetadataFromRegistry(): Promise<MeasurementRegistryResetResult>;
  mergeImport(imported: ProfileImport): Promise<ImportMutationResult>;
  startHealthConnectSyncSession(
    pairingId: string,
    request: HealthConnectSyncSessionStart
  ): Promise<HealthConnectSyncSessionResponse>;
  /** Resolves to `undefined` when the session id is unknown for this pairing. */
  applyHealthConnectSyncChunk(
    pairingId: string,
    sessionId: string,
    batchId: string,
    imported: ProfileImport
  ): Promise<HealthConnectSyncBatchAcknowledgement | undefined>;
  startMobileMigration(pairingId: string, manifest: MobileMigrationManifest): Promise<MobileMigrationStartResponse>;
  applyMobileMigrationBatch(pairingId: string, batch: MobileMigrationBatch): Promise<MobileMigrationBatchAcknowledgement>;
  completeMobileMigration(pairingId: string, sessionId: string): Promise<MobileMigrationReceipt>;
  getReplicaHighWaterMark(): Promise<ReplicaHighWaterMark>;
  startReplicaSnapshot(pairingId: string): Promise<string>;
  replicaSnapshotPage(pairingId: string, snapshotId: string, offset: number, limit: number): Promise<StoredReplicaPage | undefined>;
  replicaDeltaPage(afterSequence: number, highWaterSequence: number | undefined, limit: number): Promise<StoredReplicaPage>;
  addInsight(insight: HealthStoreData["insights"][number]): Promise<HealthStoreData["insights"][number]>;
  /**
   * Notes that a full export was taken. Separate from {@link ProfileRepository.exportData} so the
   * short write and the long read are not forced to share a single serialized slot.
   */
  recordExportAudit(): Promise<void>;
  exportData(): Promise<HealthStoreData>;
  listHealthEvents(query: HealthEventListQuery): Promise<PaginatedResult<HealthEvent>>;
  createHealthEvent(input: CreateHealthEventInput): Promise<HealthEventMutationResponse>;
  updateHealthEvent(id: string, input: UpdateHealthEventInput): Promise<HealthEventMutationResponse | undefined>;
  deleteHealthEvent(id: string): Promise<DeleteHealthEventResponse | undefined>;
  listCareItems(query: CareItemListQuery): Promise<PaginatedResult<CareItem>>;
  createCareItem(input: CreateCareItemInput): Promise<CareItemMutationResponse>;
  updateCareItem(id: string, input: UpdateCareItemInput): Promise<CareItemMutationResponse | undefined>;
  completeCareItem(id: string, input: CompleteCareItemInput): Promise<CompleteCareItemResponse | undefined>;
  deleteCareItem(id: string): Promise<DeleteCareItemResponse | undefined>;
  updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse | undefined>;
  deleteObservation(id: string): Promise<DeleteObservationResponse | undefined>;
  deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse>;
  deleteDailyAggregateStepSamples(): Promise<DeleteObservationsByTypeResponse>;
  deleteStepSamples(): Promise<DeleteObservationsByTypeResponse>;
  summary(): Promise<HealthDataSummary>;
  measurementDetail(measurementCode: string, page: MeasurementDetailPage): Promise<HealthDataDetail>;
  measurementChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions): Promise<HealthDataChartSeries>;
  upsertPersonalReferenceRange(
    measurementCode: string,
    input: PersonalReferenceRangeInput
  ): Promise<ReferenceRangeState>;
  deletePersonalReferenceRange(measurementCode: string): Promise<ReferenceRangeState>;
  pinMeasurement(measurementCode: string): Promise<MeasurementPinState>;
  unpinMeasurement(measurementCode: string): Promise<MeasurementPinState>;
  runCompiledQuery(query: CompiledQuery): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}

export interface ManagedProfileRepository extends ProfileRepository {
  readonly profileId: string;
}