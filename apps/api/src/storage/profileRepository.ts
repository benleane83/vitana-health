import type {
  AppBootstrap,
  AnalyticsSummary,
  DataSource,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataDetail,
  HealthDataSummary,
  HealthStoreData,
  Profile,
  SourceImport,
  UpdateObservationInput,
  UpdateObservationResponse
} from "@local-fitness-advisor/shared";
import type { MeasurementDetailPage } from "../summary.js";

export interface ProfileImport {
  sourceImport: SourceImport;
  dataSource: DataSource;
  observations: HealthStoreData["observations"];
  observationGroups: HealthStoreData["observationGroups"];
  timeSeriesSamples: HealthStoreData["timeSeriesSamples"];
  activitySessions: HealthStoreData["activitySessions"];
}

export interface ImportMutationResult {
  counts: AppBootstrap["counts"];
  auditEvent: HealthStoreData["auditEvents"][number];
}

export interface ProfileRepository {
  snapshot(options?: { includeRaw?: boolean }): Promise<HealthStoreData>;
  appBootstrap(): Promise<AppBootstrap>;
  analyticsSummary(): Promise<AnalyticsSummary>;
  getProfile(): Promise<Profile>;
  replaceProfile(profile: Profile): Promise<Profile>;
  mergeImport(imported: ProfileImport): Promise<ImportMutationResult>;
  addInsight(insight: HealthStoreData["insights"][number]): Promise<HealthStoreData["insights"][number]>;
  exportData(): Promise<HealthStoreData>;
  updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse | undefined>;
  deleteObservation(id: string): Promise<DeleteObservationResponse | undefined>;
  deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse>;
  summary(): Promise<HealthDataSummary>;
  measurementDetail(measurementCode: string, page: MeasurementDetailPage): Promise<HealthDataDetail>;
  runCompiledQuery(sql: string): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}