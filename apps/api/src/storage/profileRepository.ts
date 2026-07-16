import type {
  AppBootstrap,
  AnalyticsSummary,
  BiologicalAgeSource,
  DataSource,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataChartSeries,
  HealthDataChartSeriesOptions,
  HealthDataDetail,
  HealthDataSummary,
  HealthStoreData,
  Profile,
  SourceImport,
  UpdateObservationInput,
  UpdateObservationResponse
} from "@local-fitness-advisor/shared";
import type { MeasurementDetailPage } from "../summary.js";
import type { ClinicianReportSourceImport } from "../clinicianReport.js";

export interface ProfileImport {
  sourceImport: SourceImport;
  dataSource: DataSource;
  observations: HealthStoreData["observations"];
  observationGroups: HealthStoreData["observationGroups"];
  timeSeriesSamples: HealthStoreData["timeSeriesSamples"];
  activitySessions: HealthStoreData["activitySessions"];
}

export interface ImportCategoryOutcome {
  attempted: number;
  accepted: number;
  duplicates: number;
  evicted: 0;
}

export interface ImportOutcome {
  sourceImport: ImportCategoryOutcome;
  dataSource: ImportCategoryOutcome;
  observations: ImportCategoryOutcome;
  observationGroups: ImportCategoryOutcome;
  timeSeriesSamples: ImportCategoryOutcome;
  activitySessions: ImportCategoryOutcome;
}

export interface ImportMutationResult {
  counts: AppBootstrap["counts"];
  outcome: ImportOutcome;
  auditEvent: HealthStoreData["auditEvents"][number];
}

export interface ProfileRepository {
  appBootstrap(): Promise<AppBootstrap>;
  analyticsSummary(): Promise<AnalyticsSummary>;
  biologicalAgeSource(): Promise<BiologicalAgeSource>;
  clinicianReportSourceImports(): Promise<ClinicianReportSourceImport[]>;
  storageCounts(): Promise<AppBootstrap["counts"]>;
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
  measurementChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions): Promise<HealthDataChartSeries>;
  runCompiledQuery(sql: string): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}

export interface ManagedProfileRepository extends ProfileRepository {
  readonly profileId: string;
}