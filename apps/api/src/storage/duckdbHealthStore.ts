import type {
  AppBootstrap,
  CareItemListQuery,
  CareItemMutationResponse,
  CreateCareItemInput,
  CreateHealthEventInput,
  DeleteCareItemResponse,
  DeleteHealthEventResponse,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataChartSeriesOptions,
  HealthEventListQuery,
  HealthStoreData,
  PersonalReferenceRangeInput,
  HealthEventMutationResponse,
  UpdateCareItemInput,
  UpdateHealthEventInput,
  UpdateObservationInput,
  UpdateObservationResponse
} from "@vitana/shared";
import type { StoreSecurityMode } from "./profileStoreManager.js";
import {
  DuckDbRepository
} from "./duckdbRepository.js";
import type { DuckDbOptions } from "./duckdbRuntime.js";
import type { MeasurementDetailPage } from "../summary.js";
import { deriveProfileStorageKey } from "./profileKey.js";
import type {
  ImportMutationResult,
  ManagedProfileRepository,
  MeasurementRegistryResetResult,
  ProfileImport,
  ProfileRepository
} from "./profileRepository.js";

export interface DuckDbHealthStoreOptions {
  root: string;
  databasePath: string;
  profileId: string;
  passphrase: string;
  securityMode: StoreSecurityMode;
  duckdb?: DuckDbOptions;
}

export class DuckDbHealthStore implements ManagedProfileRepository {
  readonly profileId: string;
  readonly securityMode: StoreSecurityMode;

  private mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly repository: ProfileRepository,
    options: DuckDbHealthStoreOptions
  ) {
    this.profileId = options.profileId;
    this.securityMode = options.securityMode;
  }

  static async hydrate(options: DuckDbHealthStoreOptions, store: HealthStoreData): Promise<DuckDbHealthStore> {
    const repository = await DuckDbRepository.hydrate(
      options.root,
      options.databasePath,
      deriveProfileDatabaseKey(options.passphrase, options.profileId),
      store,
      options.duckdb
    );
    return new DuckDbHealthStore(repository, options);
  }

  static async open(options: DuckDbHealthStoreOptions): Promise<DuckDbHealthStore> {
    const repository = await DuckDbRepository.open(
      options.root,
      options.databasePath,
      deriveProfileDatabaseKey(options.passphrase, options.profileId),
      options.duckdb
    );
    const profile = await repository.getProfile();
    if (profile.id !== options.profileId) {
      await repository.close();
      throw new Error(`DuckDB health store profile mismatch: expected ${options.profileId}, found ${profile.id}.`);
    }
    return new DuckDbHealthStore(repository, options);
  }

  getProfile() {
    return this.repository.getProfile();
  }

  appBootstrap(): Promise<AppBootstrap> {
    return this.repository.appBootstrap();
  }

  analyticsSummary() {
    return this.repository.analyticsSummary();
  }

  biologicalAgeSource() {
    return this.repository.biologicalAgeSource();
  }

  clinicianReportLatestMeasurements() {
    return this.repository.clinicianReportLatestMeasurements();
  }

  clinicianReportSourceImports() {
    return this.repository.clinicianReportSourceImports();
  }

  storageCounts() {
    return this.repository.storageCounts();
  }

  summary() {
    return this.repository.summary();
  }

  measurementDetail(measurementCode: string, page: MeasurementDetailPage = { offset: 0, limit: 100 }) {
    return this.repository.measurementDetail(measurementCode, page);
  }

  measurementChartSeries(measurementCode: string, options: HealthDataChartSeriesOptions) {
    return this.repository.measurementChartSeries(measurementCode, options);
  }

  upsertPersonalReferenceRange(
    measurementCode: string,
    input: PersonalReferenceRangeInput
  ) {
    return this.enqueueMutation(() => this.repository.upsertPersonalReferenceRange(measurementCode, input));
  }

  deletePersonalReferenceRange(measurementCode: string) {
    return this.enqueueMutation(() => this.repository.deletePersonalReferenceRange(measurementCode));
  }

  replaceProfile(profile: HealthStoreData["profile"]): Promise<HealthStoreData["profile"]> {
    return this.enqueueMutation(async () => {
      return this.repository.replaceProfile(profile);
    });
  }

  getProfilePhoto() {
    return this.repository.getProfilePhoto();
  }

  replaceProfilePhoto(contentType: "image/jpeg", bytes: Buffer) {
    return this.enqueueMutation(() => this.repository.replaceProfilePhoto(contentType, bytes));
  }

  deleteProfilePhoto() {
    return this.enqueueMutation(() => this.repository.deleteProfilePhoto());
  }

  resetMeasurementTypeMetadataFromRegistry(): Promise<MeasurementRegistryResetResult> {
    return this.enqueueMutation(() => this.repository.resetMeasurementTypeMetadataFromRegistry());
  }

  mergeImport(parsed: ProfileImport): Promise<ImportMutationResult> {
    return this.enqueueMutation(async () => {
      return this.repository.mergeImport(parsed);
    });
  }

  addInsight(insight: HealthStoreData["insights"][number]): Promise<HealthStoreData["insights"][number]> {
    return this.enqueueMutation(async () => {
      return this.repository.addInsight(insight);
    });
  }

  deleteObservation(id: string): Promise<DeleteObservationResponse | undefined> {
    return this.enqueueMutation(async () => {
      return this.repository.deleteObservation(id);
    });
  }

  updateObservation(id: string, input: UpdateObservationInput): Promise<UpdateObservationResponse | undefined> {
    return this.enqueueMutation(async () => {
      return this.repository.updateObservation(id, input);
    });
  }

  deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse> {
    return this.enqueueMutation(async () => {
      return this.repository.deleteObservationsByMeasurementCode(measurementCode);
    });
  }

  deleteDailyAggregateStepSamples(): Promise<DeleteObservationsByTypeResponse> {
    return this.enqueueMutation(async () => {
      return this.repository.deleteDailyAggregateStepSamples();
    });
  }

  exportData(): Promise<HealthStoreData> {
    return this.enqueueMutation(async () => {
      return this.repository.exportData();
    });
  }

  listHealthEvents(query: HealthEventListQuery) {
    return this.repository.listHealthEvents(query);
  }

  createHealthEvent(input: CreateHealthEventInput): Promise<HealthEventMutationResponse> {
    return this.enqueueMutation(async () => this.repository.createHealthEvent(input));
  }

  updateHealthEvent(id: string, input: UpdateHealthEventInput): Promise<HealthEventMutationResponse | undefined> {
    return this.enqueueMutation(async () => this.repository.updateHealthEvent(id, input));
  }

  deleteHealthEvent(id: string): Promise<DeleteHealthEventResponse | undefined> {
    return this.enqueueMutation(async () => this.repository.deleteHealthEvent(id));
  }

  listCareItems(query: CareItemListQuery) {
    return this.repository.listCareItems(query);
  }

  createCareItem(input: CreateCareItemInput): Promise<CareItemMutationResponse> {
    return this.enqueueMutation(async () => this.repository.createCareItem(input));
  }

  updateCareItem(id: string, input: UpdateCareItemInput): Promise<CareItemMutationResponse | undefined> {
    return this.enqueueMutation(async () => this.repository.updateCareItem(id, input));
  }

  deleteCareItem(id: string): Promise<DeleteCareItemResponse | undefined> {
    return this.enqueueMutation(async () => this.repository.deleteCareItem(id));
  }

  runCompiledQuery(sql: string): Promise<Array<Record<string, unknown>>> {
    return this.repository.runCompiledQuery(sql);
  }

  async close(): Promise<void> {
    await this.mutationTail;
    await this.repository.close();
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(mutation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function deriveProfileDatabaseKey(passphrase: string, profileId: string): string {
  return deriveProfileStorageKey(passphrase, profileId, "duckdb-v1");
}