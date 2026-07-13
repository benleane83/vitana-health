import type {
  DataSource,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataDetail,
  HealthDataSummary,
  HealthStoreData,
  Profile,
  SourceImport
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

export interface ProfileRepository {
  snapshot(): Promise<HealthStoreData>;
  getProfile(): Promise<Profile>;
  replaceProfile(profile: Profile): Promise<Profile>;
  mergeImport(imported: ProfileImport): Promise<HealthStoreData>;
  addInsight(insight: HealthStoreData["insights"][number]): Promise<HealthStoreData["insights"][number]>;
  exportData(): Promise<HealthStoreData>;
  deleteObservation(id: string): Promise<DeleteObservationResponse | undefined>;
  deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse>;
  summary(): Promise<HealthDataSummary>;
  measurementDetail(measurementCode: string, page: MeasurementDetailPage): Promise<HealthDataDetail>;
  runCompiledQuery(sql: string): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}