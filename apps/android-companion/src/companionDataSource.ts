import type {
  AnalyticsSummary,
  AppBootstrap,
  HealthDataDetail,
  HealthDataSummary
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