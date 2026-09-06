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
  DeleteObservationGroupResponse,
  DeleteObservationResponse,
  HealthDataChartSeries,
  HealthDataChartSeriesOptions,
  HealthDataDetail,
  HealthDataSummary,
  JournalPage,
  JournalQueryInput,
  ManualObservationPayload,
  Medication,
  MedicationListQuery,
  MedicationMutationResponse,
  CreateMedicationInput,
  DeleteMedicationResponse,
  MobileImportResult,
  ObservationGroupDetail,
  ObservationGroupListItem,
  ObservationGroupListQuery,
  HealthEvent,
  HealthEventListQuery,
  HealthEventMutationResponse,
  PaginatedResult,
  PersonalReferenceRangeInput,
  ReferenceRangeState,
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
  observationGroup(id: string): Promise<ObservationGroupDetail>;
  listObservationGroups(query?: ObservationGroupListQuery): Promise<PaginatedResult<ObservationGroupListItem>>;
  healthDataChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions): Promise<HealthDataChartSeries>;
}

export interface CompanionMutationService {
  importManualObservations(payload: ManualObservationPayload): Promise<MobileImportResult | unknown>;
}

export interface CompanionObservationMutationService {
  updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse>;
  deleteObservation(id: string): Promise<DeleteObservationResponse>;
  deleteObservationGroup(id: string): Promise<DeleteObservationGroupResponse>;
}

export interface CompanionReferenceRangeMutationService {
  setPersonalReferenceRange(measurementCode: string, input: PersonalReferenceRangeInput): Promise<ReferenceRangeState>;
  removePersonalReferenceRange(measurementCode: string): Promise<ReferenceRangeState>;
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
  listMedications(query?: MedicationListQuery): Promise<PaginatedResult<Medication>>;
  createMedication(payload: CreateMedicationInput): Promise<MedicationMutationResponse>;
  updateMedication(id: string, payload: CreateMedicationInput): Promise<MedicationMutationResponse>;
  deleteMedication(id: string): Promise<DeleteMedicationResponse>;
}