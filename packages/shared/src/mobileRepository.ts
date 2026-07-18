import type {
  AnalyticsSummary,
  AppBootstrap,
  HealthDataDetail,
  HealthDataSummary
} from "./types.js";
import type { ManualObservationPayload, ParsedImport } from "./parserTypes.js";

export interface MobileDetailPage {
  limit?: number;
  offset?: number;
}

export interface MobileImportEntityOutcome {
  attempted: number;
  accepted: number;
  duplicates: number;
}

export interface MobileImportResult {
  importId: string;
  outcome: {
    sourceImports: MobileImportEntityOutcome;
    dataSources: MobileImportEntityOutcome;
    observationGroups: MobileImportEntityOutcome;
    observations: MobileImportEntityOutcome;
    timeSeriesSamples: MobileImportEntityOutcome;
    activitySessions: MobileImportEntityOutcome;
  };
}

export interface MobileProfileRepository {
  bootstrap(): Promise<AppBootstrap>;
  analytics(): Promise<AnalyticsSummary>;
  summary(): Promise<HealthDataSummary>;
  healthDataDetail(measurementCode: string, page?: MobileDetailPage): Promise<HealthDataDetail>;
  mergeImport(imported: ParsedImport): Promise<MobileImportResult>;
  importManualObservations(payload: ManualObservationPayload): Promise<MobileImportResult>;
  reset(): Promise<void>;
  close(): Promise<void>;
}
