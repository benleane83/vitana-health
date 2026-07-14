import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import {
  defaultMeasurementTypes,
  parsePersistedHealthStore,
  type AppBootstrap,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type HealthDataDetailEntry,
  type HealthStoreData,
  type Observation,
  type Profile,
  type ProfileListEntry,
  type SourceImport
} from "@local-fitness-advisor/shared";
import {
  chartPointsForEntries,
  type MeasurementDetailPage,
  summarizeMeasurementDetail,
  summarizeStoreData
} from "./summary.js";
import { log } from "./logger.js";
import { initializeDuckDbRoot, type DuckDbOptions } from "./storage/duckdbRuntime.js";
import { DuckDbHealthStore } from "./storage/duckdbHealthStore.js";
import { digestHealthStoreData } from "./storage/duckdbRepository.js";

interface EncryptedEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  payload: string;
}

interface ProfileRegistryFile {
  profiles: ProfileListEntry[];
}

export type StoreSecurityMode = "env-secret" | "generated-local-key" | "os-secure-storage";

export interface StoreSecurityConfig {
  passphrase: string;
  securityMode: StoreSecurityMode;
}

export interface ProfileStoreManagerOptions {
  security?: StoreSecurityConfig;
}

export interface OpenProfileStoreManagerOptions extends ProfileStoreManagerOptions {
  storageBackend: "json" | "duckdb";
  duckdb?: DuckDbActivationOptions;
}

interface ProfileStoreManagerConstructionOptions extends ProfileStoreManagerOptions {
  deferInitialization?: boolean;
}

export interface DuckDbActivationOptions {
  httpfsExtensionPath: string;
  root?: string;
}

export interface DuckDbRollbackOptions {
  discardDuckDbChanges: true;
}

interface StorageBackendManifest {
  version: 1;
  backend: "duckdb";
  activatedAt: string;
  profiles: Array<{
    profileId: string;
    sourceFile: string;
    sourceSha256: string;
    baselineDigest: string;
    databaseFile: string;
  }>;
}

export type HealthStoreHandle = HealthStore | DuckDbHealthStore;

const maxRawImportChars = 1_000_000;
const maxObservations = 250_000;
const maxTimeSeriesSamples = 10_000;
const minPerMeasurementCode = 500;
const maxActivitySessions = 75_000;
const maxObservationGroups = 20_000;
const windowsX64HttpfsSha256 = "21eea4547cf5aa5231f4838906e8935067c956f56a5efd09035a51189af8a77b";
export class StoreLoadError extends Error {
  constructor(
    readonly stage: "decryption" | "validation" | "migration",
    readonly filePath: string,
    readonly backupAttempted: boolean,
    cause: unknown
  ) {
    super(`Unable to load encrypted health store at ${filePath}: ${stage} failed.${backupAttempted ? " The backup was also unavailable." : " Restore a backup or remove the affected store file to create a new local store."}`);
    this.name = "StoreLoadError";
    this.cause = cause;
  }
}

export class HealthStore {
  private data: HealthStoreData;
  private readonly passphrase: string;
  private readonly dataPath: string;
  private readonly backupPath: string;
  readonly profileId: string;
  readonly securityMode: StoreSecurityMode;

  constructor(options: { profileId?: string; passphrase?: string; securityMode?: StoreSecurityMode } = {}) {
    this.profileId = normalizeProfileId(options.profileId ?? "self");
    this.dataPath = resolveStorePath(this.profileId);
    this.backupPath = `${this.dataPath}.bak`;
    mkdirSync(dirname(this.dataPath), { recursive: true });
    if (options.passphrase && options.securityMode) {
      this.passphrase = options.passphrase;
      this.securityMode = options.securityMode;
    } else {
      const security = resolveStoreSecurityConfig();
      this.passphrase = security.passphrase;
      this.securityMode = security.securityMode;
    }
    this.data = existsSync(this.dataPath) ? this.readEncryptedStore() : createEmptyStore(this.profileId);
    const registryChanged = reconcileDefaultMeasurementTypes(this.data);
    if (!existsSync(this.dataPath)) {
      this.audit("store-created", "Encrypted local health store created.");
      this.persist();
    } else if (registryChanged) {
      this.persist();
    }
  }

  snapshot(options: { includeRaw?: boolean } = {}): HealthStoreData {
    return {
      ...this.data,
      sourceImports: this.data.sourceImports.map((item) => redactRawImport(item, options.includeRaw === true))
    };
  }

  appBootstrap(): Promise<AppBootstrap> {
    const measurementByCode = new Map(this.data.measurementTypes.map((measurement) => [measurement.code, measurement]));
    const groupsById = new Map(this.data.observationGroups.map((group) => [group.id, group]));
    const templatesByLabel = new Map<string, AppBootstrap["manualObservationGroupTemplates"][number]>();
    for (const observation of this.data.observations) {
      const group = observation.observationGroupId ? groupsById.get(observation.observationGroupId) : undefined;
      if (!group || group.kind !== "custom") continue;
      const normalizedLabel = normalizeGroupLabel(group.label);
      if (!normalizedLabel) continue;
      const template = templatesByLabel.get(normalizedLabel) ?? {
        label: group.label.trim(),
        normalizedLabel,
        measurements: []
      };
      if (!template.measurements.some((measurement) => measurement.measurementCode === observation.measurementCode)) {
        const measurement = measurementByCode.get(observation.measurementCode);
        template.measurements.push({
          measurementCode: observation.measurementCode,
          marker: measurement?.display ?? observation.measurementCode,
          unit: measurement?.canonicalUnit ?? observation.unit
        });
      }
      templatesByLabel.set(normalizedLabel, template);
    }
    return Promise.resolve({
      profile: { ...this.data.profile },
      measurementTypes: this.data.measurementTypes.map((measurement) => ({ ...measurement })),
      manualObservationGroupTemplates: [...templatesByLabel.values()].sort((left, right) => left.label.localeCompare(right.label)),
      latestInsight: this.data.insights[0] ? { ...this.data.insights[0] } : undefined,
      counts: {
        imports: this.data.sourceImports.length,
        observations: this.data.observations.length,
        samples: this.data.timeSeriesSamples.length,
        activities: this.data.activitySessions.length
      }
    });
  }

  getProfile(): Promise<Profile> {
    return Promise.resolve({ ...this.data.profile });
  }

  getSummary() {
    return Promise.resolve(summarizeStoreData(this.snapshot()));
  }

  getMeasurementDetail(measurementCode: string, page?: MeasurementDetailPage) {
    const detail = summarizeMeasurementDetail(this.snapshot(), measurementCode);
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? detail.entries.length;
    const entries = detail.entries.slice(offset, offset + limit);
    return Promise.resolve({
      ...detail,
      entries,
      chartPoints: chartPointsForEntries(entries),
      pagination: {
        limit,
        loaded: offset + entries.length,
        total: detail.counts.total,
        hasMore: offset + entries.length < detail.counts.total
      }
    });
  }

  replaceProfile(profile: HealthStoreData["profile"]): HealthStoreData["profile"] {
    this.data.profile = { ...profile, id: this.profileId, updatedAt: new Date().toISOString() };
    this.audit("profile-updated", "Profile details updated locally.");
    this.persist();
    return this.data.profile;
  }

  mergeImport(parsed: {
    sourceImport: SourceImport;
    dataSource: HealthStoreData["dataSources"][number];
    observations: HealthStoreData["observations"];
    observationGroups: HealthStoreData["observationGroups"];
    timeSeriesSamples: HealthStoreData["timeSeriesSamples"];
    activitySessions: HealthStoreData["activitySessions"];
  }): HealthStoreData {
    const safeSourceImport = sanitizeSourceImport(parsed.sourceImport);
    if (
      !this.data.sourceImports.some(
        (entry) =>
          entry.sourceKind === safeSourceImport.sourceKind &&
          entry.checksum === safeSourceImport.checksum &&
          entry.fileName === safeSourceImport.fileName
      )
    ) {
      this.data.sourceImports.push(safeSourceImport);
    }
    if (!this.data.dataSources.some((entry) => entry.id === parsed.dataSource.id)) {
      this.data.dataSources.push(parsed.dataSource);
    }
    this.data.observations = limitByNewest(
      appendUniqueById(this.data.observations, parsed.observations),
      maxObservations,
      (item) => item.observedAt,
      (item) => item.measurementCode,
      minPerMeasurementCode
    );
    this.data.observationGroups = limitByNewest(
      appendUniqueById(this.data.observationGroups, parsed.observationGroups),
      maxObservationGroups,
      (item) => item.collectedAt ?? item.endAt ?? item.startAt ?? item.id
    );
    this.data.timeSeriesSamples = limitByNewest(
      appendUniqueById(this.data.timeSeriesSamples, parsed.timeSeriesSamples),
      maxTimeSeriesSamples,
      (item) => item.endAt,
      (item) => item.measurementCode,
      minPerMeasurementCode
    );
    this.data.activitySessions = limitByNewest(
      appendUniqueById(this.data.activitySessions, parsed.activitySessions),
      maxActivitySessions,
      (item) => item.startAt
    );
    this.audit(
      "import-processed",
      `${safeSourceImport.sourceKind} import processed with ${safeSourceImport.rowCount} source row(s).`
    );
    this.persist();
    return this.snapshot();
  }

  addInsight(insight: HealthStoreData["insights"][number]): HealthStoreData["insights"][number] {
    this.data.insights.unshift(insight);
    this.audit("insight-generated", `${insight.model} insight generated.`);
    this.persist();
    return insight;
  }

  deleteObservation(id: string): DeleteObservationResponse | undefined {
    const match = this.data.observations.find((entry) => entry.id === id);
    if (!match) {
      return undefined;
    }
    this.data.observations = this.data.observations.filter((entry) => entry.id !== id);
    this.audit("observation-deleted", observationDeleteDetail(match));
    this.persist();
    return {
      deletedCount: 1,
      deletedObservation: match,
      store: this.snapshot()
    };
  }

  deleteObservationsByMeasurementCode(measurementCode: string): DeleteObservationsByTypeResponse {
    const deleted = this.data.observations.filter((entry) => entry.measurementCode === measurementCode);
    if (deleted.length > 0) {
      this.data.observations = this.data.observations.filter((entry) => entry.measurementCode !== measurementCode);
      this.audit("observation-type-deleted", `${deleted.length} observation(s) deleted for ${measurementCode}.`);
      this.persist();
    }
    return {
      deletedCount: deleted.length,
      measurementCode,
      store: this.snapshot()
    };
  }

  exportData(): HealthStoreData {
    this.audit("export-created", "Full local data export created.");
    this.persist();
    return this.snapshot({ includeRaw: true });
  }

  private audit(eventType: HealthStoreData["auditEvents"][number]["eventType"], detail: string): void {
    this.data.auditEvents.unshift({
      id: `audit_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
      createdAt: new Date().toISOString(),
      eventType,
      detail
    });
  }

  private readEncryptedStore(): HealthStoreData {
    try {
      const parsed = this.readAndValidateStore(this.dataPath);
      if (parsed.migrated) {
        writeEncryptedStore(this.dataPath, this.backupPath, this.passphrase, parsed.data);
      }
      return parsed.data;
    } catch (primaryError) {
      if (!existsSync(this.backupPath)) {
        throw primaryError;
      }
      try {
        const recovered = this.readAndValidateStore(this.backupPath);
        writeFileSync(this.dataPath, readFileSync(this.backupPath), { encoding: "utf8", mode: 0o600 });
        if (recovered.migrated) {
          writeEncryptedStore(this.dataPath, this.backupPath, this.passphrase, recovered.data);
        }
        return recovered.data;
      } catch (backupError) {
        throw new StoreLoadError(loadFailureStage(backupError), this.dataPath, true, backupError);
      }
    }
  }

  private readAndValidateStore(path: string): { data: HealthStoreData; migrated: boolean } {
    let raw: unknown;
    try {
      raw = readEncryptedStoreAtPath(path, this.passphrase);
    } catch (error) {
      throw new StoreLoadError("decryption", path, false, error);
    }
    try {
      const parsed = parsePersistedHealthStore(raw);
      return parsed;
    } catch (error) {
      const stage = error instanceof Error && error.message.startsWith("Unsupported health store schema version") ? "migration" : "validation";
      throw new StoreLoadError(stage, path, false, error);
    }
  }

  private persist(): void {
    writeEncryptedStore(this.dataPath, this.backupPath, this.passphrase, this.data);
  }
}

export class ProfileStoreManager {
  readonly securityMode: StoreSecurityMode;

  private readonly passphrase: string;
  private stores = new Map<string, HealthStoreHandle>();
  private profiles: ProfileListEntry[] = [];
  private activeProfileId = "self";
  private backend: "json" | "duckdb" = "json";
  private duckdbManifest: StorageBackendManifest | undefined;
  private duckdbRoot: string | undefined;
  private duckdbOptions: DuckDbOptions | undefined;

  constructor(options: ProfileStoreManagerConstructionOptions = {}) {
    mkdirSync(resolveDataDir(), { recursive: true });
    const security = options.security ?? resolveStoreSecurityConfig();
    this.passphrase = security.passphrase;
    this.securityMode = security.securityMode;
    if (!options.deferInitialization) {
      this.initialize();
    }
  }

  static async open(options: OpenProfileStoreManagerOptions): Promise<ProfileStoreManager> {
    const manager = new ProfileStoreManager({ ...options, deferInitialization: true });
    if (options.storageBackend === "duckdb" && hasDuckDbActivationManifest()) {
      manager.initializeDuckDbBootstrap();
      await manager.activateDuckDb(manager.requireDuckDbOpenOptions(options));
      return manager;
    }

    manager.initialize();
    if (options.storageBackend === "duckdb") {
      await manager.activateDuckDb(manager.requireDuckDbOpenOptions(options));
    }
    return manager;
  }

  listProfiles(): ProfileListEntry[] {
    return [...this.profiles];
  }

  getActiveProfileId(): string {
    return this.activeProfileId;
  }

  getActiveStore(): HealthStoreHandle {
    return this.getStore(this.activeProfileId);
  }

  getStore(profileId: string): HealthStoreHandle {
    const normalizedId = normalizeProfileId(profileId);
    const existing = this.stores.get(normalizedId);
    if (existing) {
      return existing;
    }
    if (this.backend === "duckdb") {
      throw new Error(`DuckDB profile ${normalizedId} is not registered.`);
    }
    const created = new HealthStore({
      profileId: normalizedId,
      passphrase: this.passphrase,
      securityMode: this.securityMode
    });
    this.stores.set(normalizedId, created);
    return created;
  }

  getStorageBackend(): "json" | "duckdb" {
    return this.backend;
  }

  async runActiveDuckDbQuery(sql: string): Promise<Array<Record<string, unknown>>> {
    if (this.backend !== "duckdb") {
      throw new Error("Encrypted DuckDB analytics are unavailable while JSON storage is active.");
    }
    const store = this.getActiveStore();
    if (!(store instanceof DuckDbHealthStore)) {
      throw new Error("Active DuckDB storage is inconsistent with the selected backend.");
    }
    return store.runCompiledQuery(sql);
  }

  async activateDuckDb(options: DuckDbActivationOptions): Promise<void> {
    const startedAt = performance.now();
    if (process.platform !== "win32" || process.arch !== "x64") {
      throw new Error("DuckDB storage productionization is currently approved only for Windows x64.");
    }
    if (!existsSync(options.httpfsExtensionPath)) {
      throw new Error(`Pinned DuckDB extension is unavailable at ${options.httpfsExtensionPath}.`);
    }
    if (hashFile(options.httpfsExtensionPath) !== windowsX64HttpfsSha256) {
      throw new Error("Pinned DuckDB extension failed SHA-256 verification.");
    }
    const root = initializeDuckDbRoot(options.root ?? duckdbStorageRoot());
    const existingManifest = loadStorageBackendManifest();
    const duckdbOptions: DuckDbOptions = {
      httpfsExtensionPath: options.httpfsExtensionPath,
      memoryLimit: "256MB"
    };
    const opened = new Map<string, DuckDbHealthStore>();

    try {
      if (existingManifest) {
        for (const entry of existingManifest.profiles) {
          const sourcePath = resolve(resolveDataDir(), entry.sourceFile);
          if (!existsSync(sourcePath) || hashFile(sourcePath) !== entry.sourceSha256) {
            throw new Error(`Retained JSON rollback artifact changed for profile ${entry.profileId}.`);
          }
          const store = await DuckDbHealthStore.open({
            root,
            databasePath: resolve(root, "databases", entry.databaseFile),
            profileId: entry.profileId,
            passphrase: this.passphrase,
            securityMode: this.securityMode,
            duckdb: duckdbOptions
          });
          opened.set(entry.profileId, store);
        }
        this.commitDuckDbActivation(existingManifest, opened, root, duckdbOptions);
        removeLegacyWarehouseArtifacts();
        recordStoragePilotEvent("storage-duckdb-reopened", "duckdb", opened.size, startedAt);
        return;
      }

      const manifest: StorageBackendManifest = {
        version: 1,
        backend: "duckdb",
        activatedAt: new Date().toISOString(),
        profiles: []
      };
      for (const profile of this.profiles) {
        const sourcePath = resolveStorePath(profile.id);
        if (!existsSync(sourcePath)) {
          throw new Error(`Encrypted JSON source is missing for profile ${profile.id}.`);
        }
        const sourceSha256 = hashFile(sourcePath);
        const sourceSnapshot = this.getStore(profile.id).snapshot({ includeRaw: true });
        const databaseFile = `health-store-${profile.id}.duckdb`;
        const databasePath = resolve(root, "databases", databaseFile);
        const store = existsSync(databasePath)
          ? await DuckDbHealthStore.open({
              root,
              databasePath,
              profileId: profile.id,
              passphrase: this.passphrase,
              securityMode: this.securityMode,
              duckdb: duckdbOptions
            })
          : await DuckDbHealthStore.hydrate({
              root,
              databasePath,
              profileId: profile.id,
              passphrase: this.passphrase,
              securityMode: this.securityMode,
              duckdb: duckdbOptions
            }, sourceSnapshot);
        if (digestHealthStoreData(store.snapshot({ includeRaw: true })) !== digestHealthStoreData(sourceSnapshot)) {
          await store.close();
          throw new Error(`DuckDB activation parity failed for profile ${profile.id}.`);
        }
        if (hashFile(sourcePath) !== sourceSha256) {
          await store.close();
          throw new Error(`Encrypted JSON source changed during DuckDB activation for profile ${profile.id}.`);
        }
        opened.set(profile.id, store);
        manifest.profiles.push({
          profileId: profile.id,
          sourceFile: relativeDataFile(sourcePath),
          sourceSha256,
          baselineDigest: digestHealthStoreData(sourceSnapshot),
          databaseFile
        });
      }
      persistStorageBackendManifest(manifest);
      this.commitDuckDbActivation(manifest, opened, root, duckdbOptions);
      removeLegacyWarehouseArtifacts();
      recordStoragePilotEvent("storage-duckdb-activated", "duckdb", opened.size, startedAt);
    } catch (error) {
      await Promise.all([...opened.values()].map((store) => store.close().catch(() => undefined)));
      throw error;
    }
  }

  async rollbackDuckDb(options: DuckDbRollbackOptions): Promise<string> {
    const archivedManifestPath = rollbackDuckDbActivation({
      security: { passphrase: this.passphrase, securityMode: this.securityMode },
      discardDuckDbChanges: options.discardDuckDbChanges
    });
    const jsonStores = new Map<string, HealthStore>();
    for (const profile of this.profiles) {
      const store = new HealthStore({
        profileId: profile.id,
        passphrase: this.passphrase,
        securityMode: this.securityMode
      });
      jsonStores.set(profile.id, store);
    }

    const duckdbStores = [...this.stores.values()].filter(
      (store): store is DuckDbHealthStore => store instanceof DuckDbHealthStore
    );
    this.stores = new Map(jsonStores);
    this.duckdbManifest = undefined;
    this.duckdbRoot = undefined;
    this.duckdbOptions = undefined;
    this.backend = "json";
    this.refreshProfileEntriesFromStores();
    await Promise.all(duckdbStores.map((store) => store.close()));
    return archivedManifestPath;
  }

  async closeAll(): Promise<void> {
    const duckdbStores = [...this.stores.values()].filter(
      (store): store is DuckDbHealthStore => store instanceof DuckDbHealthStore
    );
    await Promise.all(duckdbStores.map((store) => store.close()));
    this.stores.clear();
  }

  private commitDuckDbActivation(
    manifest: StorageBackendManifest,
    stores: Map<string, DuckDbHealthStore>,
    root: string,
    options: DuckDbOptions
  ): void {
    this.stores = new Map(stores);
    this.duckdbManifest = manifest;
    this.duckdbRoot = root;
    this.duckdbOptions = options;
    this.backend = "duckdb";
    this.profiles = [...stores.values()].map((store) => profileListEntryFromProfile(store.snapshot().profile));
    this.persistProfiles();
    if (!this.profiles.some((profile) => profile.id === this.activeProfileId)) {
      this.activeProfileId = this.profiles[0].id;
      this.persistActiveProfile();
    }
  }

  async createProfile(displayName: string): Promise<ProfileListEntry> {
    const name = displayName.trim() || "Local user";
    const id = generateProfileId(name, new Set(this.profiles.map((entry) => entry.id)));
    if (this.backend === "duckdb") {
      const manifest = this.requireDuckDbManifest();
      const root = this.duckdbRoot!;
      const duckdbOptions = this.duckdbOptions!;
      const sourceStore = new HealthStore({
        profileId: id,
        passphrase: this.passphrase,
        securityMode: this.securityMode
      });
      sourceStore.replaceProfile({
        ...sourceStore.snapshot().profile,
        id,
        displayName: name
      });
      const sourcePath = resolveStorePath(id);
      const sourceSnapshot = sourceStore.snapshot({ includeRaw: true });
      const databaseFile = `health-store-${id}.duckdb`;
      const databasePath = resolve(root, "databases", databaseFile);
      let store: DuckDbHealthStore | undefined;
      try {
        store = await DuckDbHealthStore.hydrate({
          root,
          databasePath,
          profileId: id,
          passphrase: this.passphrase,
          securityMode: this.securityMode,
          duckdb: duckdbOptions
        }, sourceSnapshot);
        const entry = profileListEntryFromProfile(store.snapshot().profile);
        const nextProfiles = [...this.profiles, entry];
        const nextManifest: StorageBackendManifest = {
          ...manifest,
          profiles: [...manifest.profiles, {
            profileId: id,
            sourceFile: relativeDataFile(sourcePath),
            sourceSha256: hashFile(sourcePath),
            baselineDigest: digestHealthStoreData(sourceSnapshot),
            databaseFile
          }]
        };
        persistProfileRegistry(nextProfiles);
        try {
          persistStorageBackendManifest(nextManifest);
        } catch (error) {
          persistProfileRegistry(this.profiles);
          throw error;
        }
        this.profiles = nextProfiles;
        this.duckdbManifest = nextManifest;
        this.stores.set(id, store);
        return entry;
      } catch (error) {
        await store?.close().catch(() => undefined);
        removeProfileStorageFiles(id, databasePath);
        throw error;
      }
    }
    const store = this.getStore(id);
    await store.replaceProfile({
      ...store.snapshot().profile,
      id,
      displayName: name
    });
    const entry = profileListEntryFromProfile(store.snapshot().profile);
    this.profiles.push(entry);
    this.persistProfiles();
    return entry;
  }

  setActiveProfile(profileId: string): string {
    const normalizedId = normalizeProfileId(profileId);
    if (!this.profiles.some((entry) => entry.id === normalizedId)) {
      throw new Error("Profile not found.");
    }
    this.activeProfileId = normalizedId;
    this.persistActiveProfile();
    return this.activeProfileId;
  }

  async deleteProfile(profileId: string): Promise<{ activeProfileId: string }> {
    const normalizedId = normalizeProfileId(profileId);
    if (this.profiles.length <= 1) {
      throw new Error("Cannot delete the last remaining profile.");
    }
    if (!this.profiles.some((entry) => entry.id === normalizedId)) {
      throw new Error("Profile not found.");
    }

    const nextProfiles = this.profiles.filter((entry) => entry.id !== normalizedId);
    if (this.backend === "duckdb") {
      const manifest = this.requireDuckDbManifest();
      const manifestEntry = manifest.profiles.find((entry) => entry.profileId === normalizedId);
      const store = this.stores.get(normalizedId);
      if (!manifestEntry || !(store instanceof DuckDbHealthStore)) {
        throw new Error(`DuckDB profile ${normalizedId} is inconsistent with the activation manifest.`);
      }
      const nextManifest: StorageBackendManifest = {
        ...manifest,
        profiles: manifest.profiles.filter((entry) => entry.profileId !== normalizedId)
      };
      persistProfileRegistry(nextProfiles);
      try {
        persistStorageBackendManifest(nextManifest);
      } catch (error) {
        persistProfileRegistry(this.profiles);
        throw error;
      }
      this.profiles = nextProfiles;
      this.duckdbManifest = nextManifest;
      this.stores.delete(normalizedId);
      if (this.activeProfileId === normalizedId) {
        this.activeProfileId = this.profiles[0].id;
        this.persistActiveProfile();
      }
      await store.close();
      removeProfileStorageFiles(
        normalizedId,
        resolve(this.duckdbRoot!, "databases", manifestEntry.databaseFile)
      );
      return { activeProfileId: this.activeProfileId };
    }

    this.profiles = nextProfiles;
    this.stores.delete(normalizedId);

    const profileDataPath = resolveStorePath(normalizedId);
    if (existsSync(profileDataPath)) {
      try {
        unlinkSync(profileDataPath);
      } catch {
        // Best effort filesystem cleanup.
      }
    }
    const backupPath = `${profileDataPath}.bak`;
    if (existsSync(backupPath)) {
      try {
        unlinkSync(backupPath);
      } catch {
        // Best effort backup cleanup.
      }
    }

    if (this.activeProfileId === normalizedId) {
      this.activeProfileId = this.profiles[0].id;
      this.persistActiveProfile();
    }
    this.persistProfiles();
    return { activeProfileId: this.activeProfileId };
  }

  private requireDuckDbManifest(): StorageBackendManifest {
    if (!this.duckdbManifest || !this.duckdbRoot || !this.duckdbOptions) {
      throw new Error("DuckDB storage is active without complete runtime metadata.");
    }
    return this.duckdbManifest;
  }

  private requireDuckDbOpenOptions(options: OpenProfileStoreManagerOptions): DuckDbActivationOptions {
    if (!options.duckdb) {
      throw new Error("DuckDB startup requires DuckDB activation options.");
    }
    return options.duckdb;
  }

  syncProfileEntry(profile: Profile): void {
    const normalizedId = normalizeProfileId(profile.id);
    const next = profileListEntryFromProfile(profile);
    const index = this.profiles.findIndex((entry) => entry.id === normalizedId);
    if (index === -1) {
      this.profiles.push(next);
    } else {
      this.profiles[index] = next;
    }
    this.persistProfiles();
  }

  private initialize(): void {
    this.migrateLegacyIfNeeded();
    this.profiles = loadProfileRegistry();
    if (this.profiles.length === 0) {
      const store = this.getStore("self");
      this.profiles = [profileListEntryFromProfile(store.snapshot().profile)];
      this.persistProfiles();
    }

    this.refreshProfileEntriesFromStores();

    const active = loadActiveProfileId();
    if (active && this.profiles.some((entry) => entry.id === active)) {
      this.activeProfileId = active;
    } else {
      this.activeProfileId = this.profiles[0].id;
      this.persistActiveProfile();
    }
  }

  private initializeDuckDbBootstrap(): void {
    const manifest = loadStorageBackendManifest();
    if (!manifest) {
      throw new Error("DuckDB bootstrap requires an activation manifest.");
    }
    const manifestProfileIds = new Set(manifest.profiles.map((profile) => profile.profileId));
    const registry = loadProfileRegistry().filter((profile) => manifestProfileIds.has(profile.id));
    this.profiles = registry.length > 0
      ? registry
      : manifest.profiles.map((profile) => ({
          id: profile.profileId,
          displayName: profile.profileId,
          updatedAt: manifest.activatedAt
        }));

    const active = loadActiveProfileId();
    this.activeProfileId = active && manifestProfileIds.has(active)
      ? active
      : this.profiles[0]?.id ?? "self";
  }

  private refreshProfileEntriesFromStores(): void {
    this.profiles = this.profiles.map((entry) => profileListEntryFromProfile(this.getStore(entry.id).snapshot().profile));
    this.persistProfiles();
  }

  private migrateLegacyIfNeeded(): void {
    if (existsSync(profilesPath())) {
      return;
    }

    if (existsSync(legacyDataPath())) {
      const targetPath = resolveStorePath("self");
      if (!existsSync(targetPath)) {
        copyFileSync(legacyDataPath(), targetPath);
      }
      const legacyBackupPath = `${legacyDataPath()}.bak`;
      const targetBackupPath = `${targetPath}.bak`;
      if (existsSync(legacyBackupPath) && !existsSync(targetBackupPath)) {
        copyFileSync(legacyBackupPath, targetBackupPath);
      }
      const store = this.getStore("self");
      this.profiles = [profileListEntryFromProfile(store.snapshot().profile)];
      this.activeProfileId = "self";
      this.persistProfiles();
      this.persistActiveProfile();
      return;
    }

    const store = this.getStore("self");
    this.profiles = [profileListEntryFromProfile(store.snapshot().profile)];
    this.activeProfileId = "self";
    this.persistProfiles();
    this.persistActiveProfile();
  }

  private persistProfiles(): void {
    persistProfileRegistry(this.profiles);
  }

  private persistActiveProfile(): void {
    writeFileSync(activeProfilePath(), JSON.stringify({ profileId: this.activeProfileId }, null, 2), { encoding: "utf8" });
  }
}

function createEmptyStore(profileId = "self"): HealthStoreData {
  return {
    schemaVersion: 2,
    profile: {
      id: normalizeProfileId(profileId),
      displayName: "Local user",
      units: "metric",
      updatedAt: new Date().toISOString()
    },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: defaultMeasurementTypes,
    observations: [],
    observationGroups: [],
    timeSeriesSamples: [],
    activitySessions: [],
    insights: [],
    auditEvents: []
  };
}

function normalizeGroupLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function reconcileDefaultMeasurementTypes(data: HealthStoreData): boolean {
  const existingCodes = new Set(data.measurementTypes.map((type) => type.code));
  const missingTypes = defaultMeasurementTypes.filter((type) => !existingCodes.has(type.code));
  if (missingTypes.length === 0) {
    return false;
  }
  data.measurementTypes.push(...missingTypes);
  return true;
}

function redactRawImport(sourceImport: SourceImport, includeRaw: boolean): SourceImport {
  if (includeRaw) {
    return sourceImport;
  }
  const { rawContent: _rawContent, ...safe } = sourceImport;
  return safe;
}

function appendUniqueById<T extends { id: string }>(existing: T[], additions: T[]): T[] {
  if (additions.length === 0) {
    return existing;
  }
  const seen = new Set(existing.map((item) => item.id));
  const uniqueAdditions = additions.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
  if (uniqueAdditions.length === 0) {
    return existing;
  }
  return [...existing, ...uniqueAdditions];
}

function resolveDataDir(): string {
  if (process.env.LFA_DATA_DIR) {
    return resolve(process.env.LFA_DATA_DIR);
  }
  const candidates = [
    // Prefer repository-level data first so workspace runs do not accidentally use apps/api/data shadow state.
    resolve(process.cwd(), "..", "..", "data"),
    resolve(process.cwd(), "data")
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? candidates[0];
}

function resolveStorePath(profileId: string): string {
  const normalizedId = normalizeProfileId(profileId);
  const dataDir = resolveDataDir();
  return normalizedId === "self"
    ? resolve(dataDir, "health-store-self.enc")
    : resolve(dataDir, `health-store-${normalizedId}.enc`);
}

export function resolveStoreSecurityConfig(): StoreSecurityConfig {
  const configuredSecret = process.env.LFA_SECRET;
  if (configuredSecret && configuredSecret.length >= 16) {
    return { passphrase: configuredSecret, securityMode: "env-secret" };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production health storage requires LFA_SECRET or an OS-secure key injected by the desktop host.");
  }
  return { passphrase: getOrCreateLocalKey(), securityMode: "generated-local-key" };
}

function getOrCreateLocalKey(): string {
  const keyPath = localKeyPath();
  mkdirSync(dirname(keyPath), { recursive: true });
  if (existsSync(keyPath)) {
    return readFileSync(keyPath, "utf8").trim();
  }
  const key = randomBytes(32).toString("base64url");
  writeFileSync(keyPath, key, { encoding: "utf8", mode: 0o600 });
  return key;
}

function sanitizeSourceImport(sourceImport: SourceImport): SourceImport {
  if (!sourceImport.rawContent) {
    return sourceImport;
  }
  if (sourceImport.rawContent.length <= maxRawImportChars) {
    return sourceImport;
  }
  return {
    ...sourceImport,
    rawContent: sourceImport.rawContent.slice(0, maxRawImportChars)
  };
}

function limitByNewest<T>(
  items: T[],
  maxItems: number,
  key: (item: T) => string,
  groupKey?: (item: T) => string,
  minPerGroup = 0
): T[] {
  if (items.length <= maxItems) {
    return items;
  }
  if (!groupKey || minPerGroup <= 0) {
    return [...items].sort((a, b) => key(b).localeCompare(key(a))).slice(0, maxItems);
  }

  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groupKey(item) || "unknown";
    const bucket = groups.get(group);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(group, [item]);
    }
  }

  for (const bucket of groups.values()) {
    bucket.sort((a, b) => key(b).localeCompare(key(a)));
  }

  const selected: T[] = [];
  for (const bucket of groups.values()) {
    for (let index = 0; index < Math.min(minPerGroup, bucket.length); index += 1) {
      const item = bucket[index];
      selected.push(item);
      if (selected.length >= maxItems) {
        return selected.sort((a, b) => key(b).localeCompare(key(a))).slice(0, maxItems);
      }
    }
  }

  const remainder: T[] = [];
  for (const bucket of groups.values()) {
    for (let index = Math.min(minPerGroup, bucket.length); index < bucket.length; index += 1) {
      remainder.push(bucket[index]);
    }
  }
  remainder.sort((a, b) => key(b).localeCompare(key(a)));
  for (const item of remainder) {
    if (selected.length >= maxItems) {
      break;
    }
    selected.push(item);
  }

  return selected;
}

function normalizeProfileId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "self";
}

function generateProfileId(displayName: string, existing: Set<string>): string {
  const base = normalizeProfileId(displayName);
  if (!existing.has(base)) {
    return base;
  }
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function profileListEntryFromProfile(profile: Profile): ProfileListEntry {
  return {
    id: normalizeProfileId(profile.id),
    displayName: profile.displayName,
    updatedAt: profile.updatedAt
  };
}

function loadProfileRegistry(): ProfileListEntry[] {
  const path = profilesPath();
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ProfileRegistryFile;
    if (!Array.isArray(parsed.profiles)) {
      return [];
    }
    return parsed.profiles
      .map((entry) => ({
        id: normalizeProfileId(entry.id),
        displayName: typeof entry.displayName === "string" && entry.displayName.trim() ? entry.displayName : "Local user",
        updatedAt: typeof entry.updatedAt === "string" && entry.updatedAt ? entry.updatedAt : new Date().toISOString()
      }))
      .filter((entry, index, list) => list.findIndex((candidate) => candidate.id === entry.id) === index);
  } catch {
    return [];
  }
}

function loadActiveProfileId(): string | undefined {
  const path = activeProfilePath();
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { profileId?: string };
    return typeof parsed.profileId === "string" ? normalizeProfileId(parsed.profileId) : undefined;
  } catch {
    return undefined;
  }
}

function profilesPath(): string {
  return resolve(resolveDataDir(), "profiles.json");
}

function activeProfilePath(): string {
  return resolve(resolveDataDir(), "active-profile.json");
}

function persistProfileRegistry(profiles: ProfileListEntry[]): void {
  const path = profilesPath();
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ profiles }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fsyncPath(temporaryPath);
    renameSync(temporaryPath, path);
    fsyncPath(path);
    fsyncPath(dirname(path));
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function removeProfileStorageFiles(profileId: string, databasePath?: string): void {
  const sourcePath = resolveStorePath(profileId);
  for (const path of [sourcePath, `${sourcePath}.bak`, databasePath, databasePath ? `${databasePath}.wal` : undefined]) {
    if (path) {
      rmSync(path, { force: true });
    }
  }
}

function removeLegacyWarehouseArtifacts(): void {
  for (const fileName of readdirSync(resolveDataDir())) {
    if (/^health-warehouse(?:-[^.]+)?\.duckdb(?:\.wal)?$/.test(fileName)) {
      rmSync(resolve(resolveDataDir(), fileName), { force: true });
    }
  }
}

function legacyDataPath(): string {
  return resolve(resolveDataDir(), "health-store.enc");
}

function localKeyPath(): string {
  return resolve(resolveDataDir(), "local.key");
}

export function hasDuckDbActivationManifest(): boolean {
  return existsSync(storageBackendManifestPath());
}

export function rollbackDuckDbActivation(options: {
  security: StoreSecurityConfig;
  discardDuckDbChanges: true;
}): string {
  const startedAt = performance.now();
  if (options.discardDuckDbChanges !== true) {
    throw new Error("DuckDB rollback requires explicit acknowledgement that post-activation changes will be discarded.");
  }
  const manifest = loadStorageBackendManifest();
  if (!manifest) {
    throw new Error("DuckDB storage is not activated for this data directory.");
  }
  assertManifestProfiles(manifest, loadProfileRegistry());
  for (const entry of manifest.profiles) {
    const sourcePath = resolve(resolveDataDir(), entry.sourceFile);
    if (!existsSync(sourcePath) || hashFile(sourcePath) !== entry.sourceSha256) {
      throw new Error(`Retained JSON rollback artifact changed for profile ${entry.profileId}.`);
    }
    const parsed = parsePersistedHealthStore(readEncryptedStoreAtPath(sourcePath, options.security.passphrase));
    if (digestHealthStoreData(parsed.data) !== entry.baselineDigest) {
      throw new Error(`Retained JSON rollback artifact does not match the activation baseline for profile ${entry.profileId}.`);
    }
    if (hashFile(sourcePath) !== entry.sourceSha256) {
      throw new Error(`Retained JSON rollback artifact changed while validating profile ${entry.profileId}.`);
    }
  }
  const archivedManifestPath = archiveStorageBackendManifest();
  recordStoragePilotEvent("storage-duckdb-rolled-back", "json", manifest.profiles.length, startedAt);
  return archivedManifestPath;
}

function recordStoragePilotEvent(
  code: "storage-duckdb-activated" | "storage-duckdb-reopened" | "storage-duckdb-rolled-back",
  storageBackend: "json" | "duckdb",
  profileCount: number,
  startedAt: number
): void {
  const record = {
    ts: new Date().toISOString(),
    code,
    storageBackend,
    profileCount,
    durationMs: Math.round(performance.now() - startedAt)
  };
  const message = code === "storage-duckdb-activated"
    ? "DuckDB storage activation completed."
    : code === "storage-duckdb-reopened"
      ? "DuckDB storage reopened from the activation manifest."
      : "DuckDB storage was explicitly rolled back to the retained JSON baseline.";
  (code === "storage-duckdb-rolled-back" ? log.warn : log.info)(message, record);
  try {
    appendFileSync(resolve(resolveDataDir(), "storage-pilot.ndjson"), `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  } catch (error) {
    log.warn("Storage pilot telemetry could not be persisted locally.", {
      code: "storage-pilot-telemetry-write-failed"
    });
  }
}

function duckdbStorageRoot(): string {
  return resolve(resolveDataDir(), "duckdb-storage");
}

function storageBackendManifestPath(): string {
  return resolve(resolveDataDir(), "storage-backend.json");
}

function loadStorageBackendManifest(): StorageBackendManifest | undefined {
  const path = storageBackendManifestPath();
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as StorageBackendManifest;
  if (
    parsed.version !== 1 ||
    parsed.backend !== "duckdb" ||
    !Array.isArray(parsed.profiles) ||
    parsed.profiles.some((entry) =>
      !entry ||
      typeof entry.profileId !== "string" ||
      typeof entry.sourceFile !== "string" ||
      typeof entry.sourceSha256 !== "string" ||
      typeof entry.baselineDigest !== "string" ||
      typeof entry.databaseFile !== "string" ||
      normalizeProfileId(entry.profileId) !== entry.profileId ||
      !isDirectChildFileName(entry.sourceFile) ||
      !isDirectChildFileName(entry.databaseFile) ||
      !/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
      !/^[a-f0-9]{64}$/.test(entry.baselineDigest)
    )
  ) {
    throw new Error("Storage backend activation manifest is invalid.");
  }
  return parsed;
}

function isDirectChildFileName(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/]/.test(value);
}

function persistStorageBackendManifest(manifest: StorageBackendManifest): void {
  const path = storageBackendManifestPath();
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fsyncPath(temporaryPath);
    renameSync(temporaryPath, path);
    fsyncPath(path);
    fsyncPath(dirname(path));
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function archiveStorageBackendManifest(): string {
  const path = storageBackendManifestPath();
  const archivedPath = `${path}.rolled-back-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  renameSync(path, archivedPath);
  fsyncPath(dirname(path));
  return archivedPath;
}

function assertManifestProfiles(manifest: StorageBackendManifest, profiles: ProfileListEntry[]): void {
  const expected = profiles.map((profile) => profile.id).sort();
  const actual = manifest.profiles.map((profile) => normalizeProfileId(profile.profileId)).sort();
  if (expected.length !== actual.length || expected.some((profileId, index) => profileId !== actual[index])) {
    throw new Error("Storage backend activation manifest does not match the profile registry.");
  }
}

function relativeDataFile(path: string): string {
  const relativePath = path.slice(resolveDataDir().length + 1);
  if (!relativePath || relativePath.includes("..") || /[\\/]/.test(relativePath)) {
    throw new Error("Storage backend manifest source paths must be direct children of the data directory.");
  }
  return relativePath;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadFailureStage(error: unknown): "decryption" | "validation" | "migration" {
  return error instanceof StoreLoadError ? error.stage : "decryption";
}

function readEncryptedStoreAtPath(path: string, passphrase: string): unknown {
  const envelope = JSON.parse(readFileSync(path, "utf8")) as EncryptedEnvelope;
  const key = scryptSync(passphrase, Buffer.from(envelope.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.payload, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

function writeEncryptedStore(filePath: string, backupPath: string, passphrase: string, data: HealthStoreData): void {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    version: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: encrypted.toString("base64")
  };
  const serialized = JSON.stringify(envelope, null, 2);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  let oldStoreMoved = false;
  try {
    writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
    parsePersistedHealthStore(readEncryptedStoreAtPath(tempPath, passphrase));
    fsyncPath(tempPath);

    if (existsSync(filePath)) {
      renameSync(filePath, backupPath);
      oldStoreMoved = true;
    }
    renameSync(tempPath, filePath);
    fsyncPath(filePath);
    fsyncPath(dirname(filePath));
  } catch (error) {
    if (oldStoreMoved && !existsSync(filePath) && existsSync(backupPath)) {
      renameSync(backupPath, filePath);
    }
    throw error;
  } finally {
    if (existsSync(tempPath)) {
      rmSync(tempPath, { force: true });
    }
  }
}

function observationDeleteDetail(observation: Observation): string {
  return `Observation ${observation.measurementCode} deleted at ${observation.observedAt} (${observation.value} ${observation.unit}).`;
}

function fsyncPath(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
    // Best-effort durability: some filesystems/OS combinations do not support fsync on all path types.
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}
