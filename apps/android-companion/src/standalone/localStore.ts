import type {
  MobileImportEntityOutcome,
  MobileImportResult,
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

export const LOCAL_SCHEMA_VERSION = 4;

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
  exportMigrationBatches(sessionId: string, batchSize?: number): Promise<MobileMigrationBatch[]>;
  archiveAfterMigration(receipt: MobileMigrationReceipt, serverUrl: string): Promise<void>;
  latestObservationsByCode(): Promise<Observation[]>;
  observationAggregates(): Promise<LocalObservationAggregate[]>;
  observationsByCode(measurementCode: string, limit: number, offset: number): Promise<LocalObservationPage>;
  observationChartSeries(
    measurementCode: string,
    aggregation: HealthDataChartSeries["aggregation"],
    options: HealthDataChartSeriesOptions
  ): Promise<HealthDataChartSeries>;
  updateObservation(id: string, input: UpdateObservationInput): Promise<Observation | undefined>;
  deleteObservation(id: string): Promise<Observation | undefined>;
  reset(): Promise<void>;
  close(): Promise<void>;
  replicaMetadata(identity: ReplicaIdentity): Promise<LocalReplicaMetadata | undefined>;
  applyReplicaPage(page: ReplicaPage): Promise<void>;
  replicaEntities(identity: ReplicaIdentity): Promise<Array<{ entityType: string; payload: Record<string, unknown> }>>;
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
