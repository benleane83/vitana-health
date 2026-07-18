import type {
  MobileImportResult,
  Observation,
  ParsedImport,
  Profile,
  SourceKind
} from "@local-fitness-advisor/shared";

export const LOCAL_SCHEMA_VERSION = 1;

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
  getProfile(): Promise<Profile>;
  counts(): Promise<LocalStoreCounts>;
  mergeImport(imported: ParsedImport): Promise<MobileImportResult>;
  recentObservations(limit: number): Promise<Observation[]>;
  observationAggregates(): Promise<LocalObservationAggregate[]>;
  observationsByCode(measurementCode: string, limit: number, offset: number): Promise<LocalObservationPage>;
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
