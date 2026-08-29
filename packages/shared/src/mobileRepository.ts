import type {
  AnalyticsSummary,
  AppBootstrap,
  DeleteObservationResponse,
  HealthDataDetail,
  HealthDataSummary,
  DeleteMedicationResponse,
  Medication,
  MedicationMutationResponse,
  ObservationGroupDetail,
  PaginatedResult,
  UpdateObservationResponse
} from "./types.js";
import type {
  CreateMedicationInput,
  ImportCategoryOutcome,
  MedicationListQuery,
  UpdateObservationInput
} from "./apiContract.js";
import type { ManualObservationPayload, ParsedImport } from "./parserTypes.js";

export interface MobileDetailPage {
  limit?: number;
  offset?: number;
}

/** The phone reports the same import outcome shape the API does. */
export type MobileImportEntityOutcome = ImportCategoryOutcome;

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
  observationGroup(id: string): Promise<ObservationGroupDetail | undefined>;
  listMedications(query?: MedicationListQuery): Promise<PaginatedResult<Medication>>;
  createMedication(input: CreateMedicationInput): Promise<MedicationMutationResponse>;
  updateMedication(id: string, input: CreateMedicationInput): Promise<MedicationMutationResponse>;
  deleteMedication(id: string): Promise<DeleteMedicationResponse>;
  updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse | undefined>;
  deleteObservation(id: string): Promise<DeleteObservationResponse | undefined>;
  mergeImport(imported: ParsedImport): Promise<MobileImportResult>;
  importManualObservations(payload: ManualObservationPayload): Promise<MobileImportResult>;
  reset(): Promise<void>;
  close(): Promise<void>;
}
