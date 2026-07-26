import type {
  MobileImportResult,
  MobileMigrationBatch,
  MobileMigrationManifest,
  MobileMigrationReceipt,
  Observation,
  ParsedImport,
  Profile,
  SourceKind,
  HealthDataChartSeries,
  HealthDataChartSeriesOptions,
  UpdateObservationInput
} from "@vitana/shared";

export const LOCAL_SCHEMA_VERSION = 2;

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

export function entityOutcome(attempted: number, accepted: number) {
  return { attempted, accepted, duplicates: attempted - accepted };
}
