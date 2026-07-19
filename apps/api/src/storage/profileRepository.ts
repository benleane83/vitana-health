import type {
  AppBootstrap,
  AnalyticsSummary,
  BiologicalAgeSource,
  CareItemListQuery,
  CareItemMutationResponse,
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
  LinkedCareItemConflict,
  PaginatedResult,
  CareItem,
  HealthEvent,
  Profile,
  SourceImport,
  UpdateCareItemInput,
  UpdateHealthEventInput,
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
  listHealthEvents(query: HealthEventListQuery): Promise<PaginatedResult<HealthEvent>>;
  createHealthEvent(input: CreateHealthEventInput): Promise<HealthEventMutationResponse>;
  updateHealthEvent(id: string, input: UpdateHealthEventInput): Promise<HealthEventMutationResponse | undefined>;
  deleteHealthEvent(id: string): Promise<DeleteHealthEventResponse | undefined>;
  listCareItems(query: CareItemListQuery): Promise<PaginatedResult<CareItem>>;
  createCareItem(input: CreateCareItemInput): Promise<CareItemMutationResponse>;
  updateCareItem(id: string, input: UpdateCareItemInput): Promise<CareItemMutationResponse | undefined>;
  deleteCareItem(id: string): Promise<DeleteCareItemResponse | undefined>;
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