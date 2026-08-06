import type {
  AnalyticsSummary,
  AppBootstrap,
  BodyTrendQuery,
  BodyTrendTimeline,
  CareItem,
  CareItemMutationResponse,
  CareItemListQuery,
  CalendarMonthData,
  CalendarMonthQuery,
  CompleteCareItemInput,
  CompleteCareItemResponse,
  CreateCareItemInput,
  CreateHealthEventInput,
  DeleteCareItemResponse,
  DeleteHealthEventResponse,
  DeleteObservationResponse,
  HealthDataChartSeries,
  HealthDataChartSeriesOptions,
  HealthDataDetail,
  HealthDataSummary,
  JournalPage,
  JournalQueryInput,
  ManualObservationPayload,
  MobileImportResult,
  HealthEvent,
  HealthEventListQuery,
  HealthEventMutationResponse,
  PaginatedResult,
  UpdateObservationInput,
  UpdateObservationResponse
} from "@vitana/shared";

export interface DetailPage {
  limit?: number;
  offset?: number;
}

export interface CompanionDataSource {
  bootstrap(): Promise<AppBootstrap>;
  analytics(): Promise<AnalyticsSummary>;
  summary(): Promise<HealthDataSummary>;
  bodyTrendTimeline(query: BodyTrendQuery, signal?: AbortSignal): Promise<BodyTrendTimeline>;
  calendarMonth(query: CalendarMonthQuery, signal?: AbortSignal): Promise<CalendarMonthData>;
  journal(query: JournalQueryInput, signal?: AbortSignal): Promise<JournalPage>;
  healthDataDetail(measurementCode: string, page?: DetailPage): Promise<HealthDataDetail>;
  healthDataChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions): Promise<HealthDataChartSeries>;
}

export interface CompanionMutationService {
  importManualObservations(payload: ManualObservationPayload): Promise<MobileImportResult | unknown>;
}

export interface CompanionObservationMutationService {
  updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse>;
  deleteObservation(id: string): Promise<DeleteObservationResponse>;
}

export interface CompanionMaintenanceService {
  resetLocalData(): Promise<void>;
}

export interface CompanionLifecycleService {
  dispose(): Promise<void>;
}

export interface CompanionCareService {
  listHealthEvents(query?: HealthEventListQuery): Promise<PaginatedResult<HealthEvent>>;
  createHealthEvent(payload: CreateHealthEventInput): Promise<HealthEventMutationResponse>;
  updateHealthEvent(id: string, payload: CreateHealthEventInput): Promise<HealthEventMutationResponse>;
  deleteHealthEvent(id: string): Promise<DeleteHealthEventResponse>;
  listCareItems(query?: CareItemListQuery): Promise<PaginatedResult<CareItem>>;
  createCareItem(payload: CreateCareItemInput): Promise<CareItemMutationResponse>;
  updateCareItem(id: string, payload: CreateCareItemInput): Promise<CareItemMutationResponse>;
  completeCareItem(id: string, payload: CompleteCareItemInput): Promise<CompleteCareItemResponse>;
  deleteCareItem(id: string): Promise<DeleteCareItemResponse>;
}