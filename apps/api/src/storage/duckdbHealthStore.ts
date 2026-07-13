import { createHash } from "node:crypto";
import type {
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthDataDetailEntry,
  HealthStoreData
} from "@local-fitness-advisor/shared";
import { listHealthDataDetailEntries } from "../summary.js";
import type { StoreSecurityMode } from "../store.js";
import {
  DuckDbRepository,
  type DuckDbImport
} from "./duckdbRepository.js";
import type { DuckDbOptions } from "./duckdbRuntime.js";

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
    private readonly repository: DuckDbRepository,
    private cachedData: HealthStoreData,
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
    return new DuckDbHealthStore(repository, await repository.snapshot(), options);
  }

  static async open(options: DuckDbHealthStoreOptions): Promise<DuckDbHealthStore> {
    const repository = await DuckDbRepository.open(
      options.root,
      options.databasePath,
      deriveProfileDatabaseKey(options.passphrase, options.profileId),
      options.duckdb
    );
    const snapshot = await repository.snapshot();
    if (snapshot.profile.id !== options.profileId) {
      await repository.close();
      throw new Error(`DuckDB health store profile mismatch: expected ${options.profileId}, found ${snapshot.profile.id}.`);
    }
    return new DuckDbHealthStore(repository, snapshot, options);
  }

  snapshot(options: { includeRaw?: boolean } = {}): HealthStoreData {
    const snapshot = structuredClone(this.cachedData);
    if (options.includeRaw === true) {
      return snapshot;
    }
    snapshot.sourceImports = snapshot.sourceImports.map(({ rawContent: _rawContent, ...sourceImport }) => sourceImport);
    return snapshot;
  }

  replaceProfile(profile: HealthStoreData["profile"]): Promise<HealthStoreData["profile"]> {
    return this.enqueueMutation(async () => {
      const saved = await this.repository.replaceProfile(profile);
      await this.refreshCache();
      return saved;
    });
  }

  mergeImport(parsed: DuckDbImport): Promise<HealthStoreData> {
    return this.enqueueMutation(async () => {
      this.cachedData = await this.repository.mergeImport(parsed);
      return this.snapshot();
    });
  }

  addInsight(insight: HealthStoreData["insights"][number]): Promise<HealthStoreData["insights"][number]> {
    return this.enqueueMutation(async () => {
      const saved = await this.repository.addInsight(insight);
      await this.refreshCache();
      return saved;
    });
  }

  listDetailEntries(measurementCode: string): HealthDataDetailEntry[] {
    return listHealthDataDetailEntries(this.snapshot(), measurementCode);
  }

  deleteObservation(id: string): Promise<DeleteObservationResponse | undefined> {
    return this.enqueueMutation(async () => {
      const deleted = await this.repository.deleteObservation(id);
      if (!deleted) {
        return undefined;
      }
      await this.refreshCache();
      return { ...deleted, store: this.snapshot() };
    });
  }

  deleteObservationsByMeasurementCode(measurementCode: string): Promise<DeleteObservationsByTypeResponse> {
    return this.enqueueMutation(async () => {
      const deleted = await this.repository.deleteObservationsByMeasurementCode(measurementCode);
      await this.refreshCache();
      return { ...deleted, store: this.snapshot() };
    });
  }

  exportData(): Promise<HealthStoreData> {
    return this.enqueueMutation(async () => {
      this.cachedData = await this.repository.exportData();
      return this.snapshot({ includeRaw: true });
    });
  }

  runCompiledQuery(sql: string): Promise<Array<Record<string, unknown>>> {
    return this.repository.runCompiledQuery(sql);
  }

  async close(): Promise<void> {
    await this.mutationTail;
    await this.repository.close();
  }

  private async refreshCache(): Promise<void> {
    this.cachedData = await this.repository.snapshot();
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(mutation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function deriveProfileDatabaseKey(passphrase: string, profileId: string): string {
  return createHash("sha256")
    .update("local-fitness-advisor:duckdb-profile-key:v1\0", "utf8")
    .update(profileId, "utf8")
    .update("\0", "utf8")
    .update(passphrase, "utf8")
    .digest("base64");
}