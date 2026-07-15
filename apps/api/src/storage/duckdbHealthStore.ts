import type {
  AppBootstrap,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthStoreData,
  UpdateObservationInput,
  UpdateObservationResponse
} from "@local-fitness-advisor/shared";
import type { StoreSecurityMode } from "./profileStoreManager.js";
import {
  DuckDbRepository
} from "./duckdbRepository.js";
import type { DuckDbOptions } from "./duckdbRuntime.js";
import type { MeasurementDetailPage } from "../summary.js";
import { deriveProfileStorageKey } from "./profileKey.js";
import type { ImportMutationResult, ProfileImport, ProfileRepository } from "./profileRepository.js";

export interface DuckDbHealthStoreOptions {
  root: string;
  databasePath: string;
  profileId: string;
  passphrase: string;
  securityMode: StoreSecurityMode;
  duckdb?: DuckDbOptions;
}

export class DuckDbHealthStore {
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

  async readSnapshot(options: { includeRaw?: boolean } = {}): Promise<HealthStoreData> {
    return this.repository.snapshot(options);
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

  getSummary() {
    return this.repository.summary();
  }

  getMeasurementDetail(measurementCode: string, page?: MeasurementDetailPage) {
    return this.repository.measurementDetail(measurementCode, page ?? { offset: 0, limit: 100 });
  }

  replaceProfile(profile: HealthStoreData["profile"]): Promise<HealthStoreData["profile"]> {
    return this.enqueueMutation(async () => {
      return this.repository.replaceProfile(profile);
    });
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

  exportData(): Promise<HealthStoreData> {
    return this.enqueueMutation(async () => {
      return this.repository.exportData();
    });
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