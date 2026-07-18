import type {
  AnalyticsSummary,
  AppBootstrap,
  HealthDataDetail,
  HealthDataSummary,
  ManualObservationPayload,
  MobileImportResult
} from "@local-fitness-advisor/shared";

export interface DetailPage {
  limit?: number;
  offset?: number;
}

export interface CompanionDataSource {
  bootstrap(): Promise<AppBootstrap>;
  analytics(): Promise<AnalyticsSummary>;
  summary(): Promise<HealthDataSummary>;
  healthDataDetail(measurementCode: string, page?: DetailPage): Promise<HealthDataDetail>;
}

export interface CompanionMutationService {
  importManualObservations(payload: ManualObservationPayload): Promise<MobileImportResult | unknown>;
}

export interface CompanionMaintenanceService {
  resetLocalData(): Promise<void>;
}