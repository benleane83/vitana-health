import type {
  MobileImportEntityOutcome,
  MobileImportResult,
  BodyTrendQuery,
  CareItem,
  CareItemListQuery,
  CalendarMonthQuery,
  CompleteCareItemInput,
  CreateCareItemInput,
  CreateHealthEventInput,
  HealthEvent,
  HealthEventListQuery,
  MobileMigrationBatch,
  MobileMigrationManifest,
  MobileMigrationReceipt,
  Observation,
  ParsedImport,
  Profile,
  ReplicaIdentity,
  ReplicaPage,
  SourceKind,
  HealthDataChartSeries,
  HealthDataChartSeriesOptions,
  UpdateObservationInput
} from "@vitana/shared";

/** Schema version of the durable database, which holds data only this phone has. */
export const LOCAL_SCHEMA_VERSION = 7;

/**
 * Schema version of the disposable replica cache.
 *
 * It is tracked separately because it is not migrated. Every row in `replica.db` is a copy of
 * something the PC still holds, so a shape change is answered by dropping the file and re-syncing.
 * Bumping this number is the whole migration.
 */
export const REPLICA_SCHEMA_VERSION = 1;

/** Rows per migration batch. Shared so upload progress can be sized without materialising batches. */
export const DEFAULT_MIGRATION_BATCH_SIZE = 250;

/**
 * Narrows a replica read at the storage layer. Reading a measurement detail used to parse every
 * observation in the replica just to keep the handful belonging to one code.
 */
export interface ReplicaEntityFilter {
  /** Only these entity types are returned. Omit for all of them. */
  entityTypes?: string[];
  /** Applied only to reading-bearing entity types; other types are unaffected. */
  measurementCode?: string;
}

/** Entity types whose payloads carry a `measurementCode`, and so can be narrowed by one. */
export const MEASUREMENT_SCOPED_REPLICA_TYPES = ["observation", "time-series-sample"];


export interface LocalDatasetMetadata {
  datasetId: string;
  profileId: string;
  kind: "standalone" | "connected";
  lifecycleState: "active" | "archived";
  remoteBinding?: { serverUrl: string; profileId: string; pairingId: string };
  migrationFingerprint: string;
  migrationReceipt?: MobileMigrationReceipt;
  archivedAt?: string;
}

export interface LocalDatasetSummary {
  datasetId: string;
  profileId: string;
  displayName: string;
  kind: LocalDatasetMetadata["kind"];
  lifecycleState: LocalDatasetMetadata["lifecycleState"];
  selected: boolean;
}

export interface LocalStoreCounts {
  imports: number;
  observations: number;
  samples: number;
  activities: number;
  healthEvents: number;
  careItems: number;
  insights: number;
}

export interface LocalObservationAggregate {
  measurementCode: string;
  count: number;
  lastMeasuredAt: string;
  groupKind?: string;
}

export interface LocalObservationRecord extends Observation {
  sourceKind?: SourceKind;
  sourceLabel?: string;
  importFileName?: string;
  importedAt?: string;
  group?: {
    id: string;
    kind: string;
    label: string;
    collectedAt?: string;
  };
}

export interface LocalObservationPage {
  records: LocalObservationRecord[];
  total: number;
}

export type LocalCalendarObservation = Pick<Observation, "id" | "measurementCode" | "observedAt" | "value" | "unit"> & {
  sourceLabel?: string;
};

export type LocalBodyTrendObservation = LocalCalendarObservation & {
  observationGroupId?: string;
};

export interface LocalStore {
  initialize(defaultProfile: Profile): Promise<void>;
  createDataset(profile: Profile): Promise<void>;
  deleteSelectedDataset(): Promise<void>;
  listDatasets(): Promise<LocalDatasetSummary[]>;
  selectDataset(datasetId: string): Promise<void>;
  datasetMetadata(): Promise<LocalDatasetMetadata>;
  getProfile(): Promise<Profile>;
  counts(): Promise<LocalStoreCounts>;
  mergeImport(imported: ParsedImport): Promise<MobileImportResult>;
  migrationManifest(): Promise<MobileMigrationManifest>;
  streamMigrationBatches(sessionId: string, batchSize?: number): AsyncIterable<MobileMigrationBatch>;
  archiveAfterMigration(receipt: MobileMigrationReceipt, serverUrl: string): Promise<void>;
  latestObservationsByCode(): Promise<Observation[]>;
  observationAggregates(): Promise<LocalObservationAggregate[]>;
  observationsForBodyTrend(query: BodyTrendQuery): Promise<LocalBodyTrendObservation[]>;
  observationsForCalendar(query: CalendarMonthQuery): Promise<LocalCalendarObservation[]>;
  observationsByCode(measurementCode: string, limit: number, offset: number): Promise<LocalObservationPage>;
  observationChartSeries(
    measurementCode: string,
    aggregation: HealthDataChartSeries["aggregation"],
    options: HealthDataChartSeriesOptions
  ): Promise<HealthDataChartSeries>;
  updateObservation(id: string, input: UpdateObservationInput): Promise<Observation | undefined>;
  deleteObservation(id: string): Promise<Observation | undefined>;
  listHealthEvents(query?: HealthEventListQuery): Promise<{ items: HealthEvent[]; total: number; offset: number; limit: number; hasMore: boolean }>;
  createHealthEvent(payload: CreateHealthEventInput): Promise<HealthEvent>;
  updateHealthEvent(id: string, payload: CreateHealthEventInput): Promise<HealthEvent | undefined>;
  deleteHealthEvent(id: string): Promise<HealthEvent | undefined>;
  listCareItems(query?: CareItemListQuery): Promise<{ items: CareItem[]; total: number; offset: number; limit: number; hasMore: boolean }>;
  createCareItem(payload: CreateCareItemInput): Promise<CareItem>;
  updateCareItem(id: string, payload: CreateCareItemInput): Promise<CareItem | undefined>;
  completeCareItem(id: string, payload: CompleteCareItemInput): Promise<{ careItem: CareItem; healthEvent?: HealthEvent } | undefined>;
  deleteCareItem(id: string): Promise<CareItem | undefined>;
  reset(): Promise<void>;
  close(): Promise<void>;
  replicaMetadata(identity: ReplicaIdentity): Promise<LocalReplicaMetadata | undefined>;
  applyReplicaPage(page: ReplicaPage): Promise<void>;
  replicaEntities(
    identity: ReplicaIdentity,
    filter?: ReplicaEntityFilter
  ): Promise<Array<{ entityType: string; payload: Record<string, unknown> }>>;
  deleteReplica(identity: ReplicaIdentity): Promise<void>;
  /**
   * Re-keys a fully built staging replica onto the live identity, replacing whatever was there.
   * Lets a rebuild after a PC-side restore be assembled without the user losing access to the copy
   * they already have.
   */
  promoteReplica(staging: ReplicaIdentity, target: ReplicaIdentity): Promise<void>;
}

export interface LocalReplicaMetadata extends ReplicaIdentity {
  cursorSequence: number;
  revision: number;
  initialSnapshotCompleted: boolean;
  /** Server-generated timestamp for the page. Display only - it uses the paired PC's clock. */
  cachedAt?: string;
  /** Device-local timestamp recorded when the page was applied. Use this for staleness checks. */
  appliedAt?: string;
  /** Resume point for an interrupted first snapshot. Undefined once the snapshot completes. */
  snapshotCursor?: string;
}

export function emptyCounts(): LocalStoreCounts {
  return {
    imports: 0,
    observations: 0,
    samples: 0,
    activities: 0,
    healthEvents: 0,
    careItems: 0,
    insights: 0
  };
}

export function entityOutcome(attempted: number, accepted: number): MobileImportEntityOutcome {
  return { attempted, accepted, duplicates: attempted - accepted, rejected: 0 };
}
