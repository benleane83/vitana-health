import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  CURRENT_SCHEMA_VERSION,
  defaultMeasurementTypes,
  pinnedHttpfsSha256,
  type HealthStoreData,
  type Profile,
  type ProfilePhotoMetadata,
  type ProfileListEntry
} from "@vitana/shared";
import { initializeDuckDbRoot, type DuckDbOptions } from "./duckdbRuntime.js";
import { DuckDbHealthStore } from "./duckdbHealthStore.js";
import type { ManagedProfileRepository } from "./profileRepository.js";
import { RestoreJournal } from "./restoreJournal.js";
import { sweepOrphanedTempFiles } from "./orphanedTempFiles.js";

export type StoreSecurityMode = "env-secret" | "generated-local-key" | "os-secure-storage";

export interface StoreSecurityConfig {
  passphrase: string;
  securityMode: StoreSecurityMode;
}

export interface DuckDbActivationOptions {
  httpfsExtensionPath: string;
  root?: string;
}

export interface OpenProfileStoreManagerOptions {
  security?: StoreSecurityConfig;
  storageBackend: "duckdb";
  duckdb: DuckDbActivationOptions;
}

interface StorageBackendManifest {
  version: 1;
  backend: "duckdb";
  activatedAt: string;
  /**
   * Provenance for the store as a whole. When a user reports a broken profile this is the only
   * record of which build last touched it, and it is what tells a downgraded build that it is
   * looking at data from the future.
   */
  lastWrittenByAppVersion?: string;
  lastWrittenAt?: string;
  profiles: Array<{ profileId: string; databaseFile: string }>;
}

export interface RestoreProfileRequest {
  sourceProfileId: string;
  decision: "replace" | "create-copy";
  displayName: string;
  data: HealthStoreData;
}

export interface RestoreProfileResult {
  profileId: string;
  decision: "replace" | "create-copy";
  newProfileId?: string;
  success: true;
}

const windowsX64HttpfsSha256 = pinnedHttpfsSha256("win32", "x64");

/**
 * A caller asked for a profile that does not exist. Carries `status` so the centralized error
 * handler answers 404 rather than burying a routine typo in an opaque 500.
 */
export class ProfileNotFoundError extends Error {
  readonly status = 404;
  readonly code = "PROFILE_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "ProfileNotFoundError";
  }
}

/** The request was understood but conflicts with the current profile state (for example, deleting the last profile). */
export class ProfileConflictError extends Error {
  readonly status = 409;
  readonly code = "PROFILE_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "ProfileConflictError";
  }
}

export class ProfileStoreManager {
  readonly securityMode: StoreSecurityMode;

  private readonly passphrase: string;
  private stores = new Map<string, DuckDbHealthStore>();
  private profiles: ProfileListEntry[] = [];
  private activeProfileId = "self";
  private manifest: StorageBackendManifest | undefined;
  private root: string | undefined;
  private duckdbOptions: DuckDbOptions | undefined;

  private constructor(security?: StoreSecurityConfig) {
    mkdirSync(resolveDataDir(), { recursive: true });
    const resolvedSecurity = security ?? resolveStoreSecurityConfig();
    this.passphrase = resolvedSecurity.passphrase;
    this.securityMode = resolvedSecurity.securityMode;
  }

  static async open(options: OpenProfileStoreManagerOptions): Promise<ProfileStoreManager> {
    const manager = new ProfileStoreManager(options.security);
    await manager.openDuckDb(options.duckdb);
    return manager;
  }

  listProfiles(): ProfileListEntry[] {
    return [...this.profiles];
  }

  syncProfilePhotoMetadata(profileId: string, profilePhoto?: ProfilePhotoMetadata): void {
    this.profiles = this.profiles.map((entry) =>
      entry.id === profileId ? { ...entry, profilePhoto: photoMetadata(profilePhoto) } : entry
    );
    persistProfileRegistry(this.profiles);
  }

  getActiveProfileId(): string {
    return this.activeProfileId;
  }

  getActiveStore(): ManagedProfileRepository {
    return this.getStore(this.activeProfileId);
  }

  getStore(profileId: string): ManagedProfileRepository {
    const normalizedId = normalizeProfileId(profileId);
    const store = this.stores.get(normalizedId);
    if (!store) {
      throw new ProfileNotFoundError(`DuckDB profile ${normalizedId} is not registered.`);
    }
    return store;
  }

  getStorageBackend(): "duckdb" {
    return "duckdb";
  }

  runActiveCompiledQuery(sql: string): Promise<Array<Record<string, unknown>>> {
    return this.getActiveStore().runCompiledQuery(sql);
  }

  async createProfile(displayName: string): Promise<ProfileListEntry> {
    const manifest = this.requireOpenStorage();
    const name = displayName.trim() || "Local user";
    const id = generateProfileId(name, new Set(this.profiles.map((entry) => entry.id)));
    const databaseFile = `health-store-${id}.duckdb`;
    const databasePath = resolve(this.root!, "databases", databaseFile);
    let store: DuckDbHealthStore | undefined;

    try {
      store = await DuckDbHealthStore.hydrate(this.storeOptions(id, databasePath), createEmptyStore(id, name));
      const entry = profileListEntryFromProfile(await store.getProfile());
      const nextProfiles = [...this.profiles, entry];
      const nextManifest = { ...manifest, profiles: [...manifest.profiles, { profileId: id, databaseFile }] };
      persistProfileRegistry(nextProfiles);
      try {
        persistStorageBackendManifest(nextManifest);
      } catch (error) {
        persistProfileRegistry(this.profiles);
        throw error;
      }
      this.profiles = nextProfiles;
      this.manifest = nextManifest;
      this.stores.set(id, store);
      return entry;
    } catch (error) {
      await store?.close().catch(() => undefined);
      removeDuckDbProfileFiles(databasePath);
      throw error;
    }
  }

  async restoreProfiles(requests: RestoreProfileRequest[], journal: RestoreJournal): Promise<RestoreProfileResult[]> {
    const manifest = this.requireOpenStorage();
    const originalProfiles = [...this.profiles];
    const originalManifest: StorageBackendManifest = {
      ...manifest,
      profiles: manifest.profiles.map((entry) => ({ ...entry }))
    };
    const originalStores = new Map(this.stores);
    const reservedIds = new Set(this.profiles.map((profile) => profile.id));
    const prepared: Array<{
      request: RestoreProfileRequest;
      targetId: string;
      databaseFile: string;
      livePath: string;
      stagedPath: string;
      rollbackPath?: string;
      existed: boolean;
    }> = [];

    journal.snapshotMetadataFile(profilesPath());
    journal.snapshotMetadataFile(storageBackendManifestPath());
    journal.snapshotMetadataFile(activeProfilePath());
    journal.setPhase("hydrating");

    try {
      for (const request of requests) {
        const existsLocally = reservedIds.has(request.sourceProfileId);
        const copyName = `${request.displayName} (restored ${new Date().toISOString().slice(0, 10)})`;
        const targetId = request.decision === "replace" && existsLocally
          ? request.sourceProfileId
          : generateProfileId(request.decision === "create-copy" ? copyName : request.displayName, reservedIds);
        reservedIds.add(targetId);
        const displayName = request.decision === "create-copy" ? copyName : request.displayName;
        const databaseFile = `health-store-${targetId}.duckdb`;
        const livePath = resolve(this.root!, "databases", databaseFile);
        const stagedPath = `${livePath}.restore-${journal.id}`;
        const rollbackPath = existsLocally && targetId === request.sourceProfileId
          ? `${livePath}.pre-restore-${journal.id}`
          : undefined;
        const snapshot: HealthStoreData = {
          ...request.data,
          profile: { ...request.data.profile, id: targetId, displayName }
        };

        journal.addEntry({
          profileId: request.sourceProfileId,
          decision: request.decision,
          newProfileId: targetId === request.sourceProfileId ? undefined : targetId,
          originalDatabaseFile: rollbackPath ? livePath : undefined,
          newDatabaseFile: livePath,
          stagedDatabaseFile: stagedPath,
          rollbackDatabaseFile: rollbackPath,
          status: "pending"
        });
        const stagedStore = await DuckDbHealthStore.hydrate(this.storeOptions(targetId, stagedPath), snapshot);
        await stagedStore.close();
        journal.updateEntryStatus(request.sourceProfileId, "hydrated");
        prepared.push({ request, targetId, databaseFile, livePath, stagedPath, rollbackPath, existed: Boolean(rollbackPath) });
      }

      journal.setPhase("committing");
      for (const item of prepared) {
        if (item.existed) {
          await this.stores.get(item.targetId)!.close();
          renameSync(item.livePath, item.rollbackPath!);
        }
        renameSync(item.stagedPath, item.livePath);
        const replacement = await DuckDbHealthStore.open(this.storeOptions(item.targetId, item.livePath));
        this.stores.set(item.targetId, replacement);
        journal.updateEntryStatus(item.request.sourceProfileId, "committed");
      }

      const restoredIds = new Set(prepared.map((item) => item.targetId));
      const restoredProfiles = await Promise.all(
        prepared.map(async (item) => profileListEntryFromProfile(await this.stores.get(item.targetId)!.getProfile()))
      );
      this.profiles = [
        ...this.profiles.filter((profile) => !restoredIds.has(profile.id)),
        ...restoredProfiles
      ];
      this.manifest = {
        ...manifest,
        profiles: [
          ...manifest.profiles.filter((entry) => !restoredIds.has(entry.profileId)),
          ...prepared.map((item) => ({ profileId: item.targetId, databaseFile: item.databaseFile }))
        ]
      };
      persistProfileRegistry(this.profiles);
      persistStorageBackendManifest(this.manifest);
      journal.complete();
      return prepared.map((item) => ({
        profileId: item.request.sourceProfileId,
        decision: item.request.decision,
        ...(item.targetId === item.request.sourceProfileId ? {} : { newProfileId: item.targetId }),
        success: true
      }));
    } catch (error) {
      await Promise.all(prepared.map(async (item) => {
        const store = this.stores.get(item.targetId);
        if (store && store !== originalStores.get(item.targetId)) await store.close().catch(() => undefined);
      }));
      if (!journal.rollback()) throw new Error("Restore failed and compensation could not be verified.", { cause: error });
      this.profiles = originalProfiles;
      this.manifest = originalManifest;
      this.stores = originalStores;
      for (const item of prepared.filter((candidate) => candidate.existed)) {
        this.stores.set(item.targetId, await DuckDbHealthStore.open(this.storeOptions(item.targetId, item.livePath)));
      }
      throw error;
    }
  }

  setActiveProfile(profileId: string): string {
    const normalizedId = normalizeProfileId(profileId);
    if (!this.profiles.some((entry) => entry.id === normalizedId)) {
      throw new ProfileNotFoundError("Profile not found.");
    }
    this.activeProfileId = normalizedId;
    this.persistActiveProfile();
    return normalizedId;
  }

  async deleteProfile(profileId: string): Promise<{ activeProfileId: string }> {
    const normalizedId = normalizeProfileId(profileId);
    if (this.profiles.length <= 1) {
      throw new ProfileConflictError("Cannot delete the last remaining profile.");
    }
    const manifest = this.requireOpenStorage();
    const manifestEntry = manifest.profiles.find((entry) => entry.profileId === normalizedId);
    const store = this.stores.get(normalizedId);
    if (!manifestEntry || !store) {
      throw new ProfileNotFoundError("Profile not found.");
    }

    const nextProfiles = this.profiles.filter((entry) => entry.id !== normalizedId);
    const nextManifest = {
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
    this.manifest = nextManifest;
    this.stores.delete(normalizedId);
    if (this.activeProfileId === normalizedId) {
      this.activeProfileId = this.profiles[0].id;
      this.persistActiveProfile();
    }
    await store.close();
    removeDuckDbProfileFiles(resolve(this.root!, "databases", manifestEntry.databaseFile));
    return { activeProfileId: this.activeProfileId };
  }

  syncProfileEntry(profile: Profile): void {
    const normalizedId = normalizeProfileId(profile.id);
    const index = this.profiles.findIndex((entry) => entry.id === normalizedId);
    if (index < 0) {
      throw new ProfileNotFoundError(`DuckDB profile ${normalizedId} is not registered.`);
    }
    this.profiles[index] = profileListEntryFromProfile(profile, this.profiles[index].profilePhoto);
    persistProfileRegistry(this.profiles);
  }

  async closeAll(): Promise<void> {
    // `allSettled`, not `all`: a single store that fails to check point must not abort shutdown and
    // leave every other store open with an unflushed WAL.
    const results = await Promise.allSettled([...this.stores.values()].map((store) => store.close()));
    this.stores.clear();
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Failed to close a profile store during shutdown.", result.reason);
      }
    }
  }

  private async openDuckDb(options: DuckDbActivationOptions): Promise<void> {
    validateDuckDbRuntime(options);
    RestoreJournal.recover(resolveDataDir());
    this.root = initializeDuckDbRoot(options.root ?? duckdbStorageRoot());
    sweepOrphanedTempFiles([resolveDataDir(), this.root, resolve(this.root, "databases")]);
    this.duckdbOptions = { httpfsExtensionPath: options.httpfsExtensionPath, memoryLimit: "256MB" };
    const existingManifest = loadStorageBackendManifest();
    const manifest = existingManifest ?? createInitialManifest();
    const opened = new Map<string, DuckDbHealthStore>();

    try {
      for (const entry of manifest.profiles) {
        const databasePath = resolve(this.root, "databases", entry.databaseFile);
        if (existingManifest && !existsSync(databasePath)) {
          throw new Error(`DuckDB database is missing for profile ${entry.profileId}: ${databasePath}`);
        }
        const store = existingManifest
          ? await DuckDbHealthStore.open(this.storeOptions(entry.profileId, databasePath))
          : await DuckDbHealthStore.hydrate(
              this.storeOptions(entry.profileId, databasePath),
              createEmptyStore(entry.profileId)
            );
        opened.set(entry.profileId, store);
      }
      if (!existingManifest) {
        persistStorageBackendManifest(manifest);
      }
      this.stores = opened;
      this.manifest = manifest;
      this.profiles = await Promise.all([...opened.values()].map(async (store) => {
        const [profile, photo] = await Promise.all([store.getProfile(), store.getProfilePhoto()]);
        return profileListEntryFromProfile(profile, photo);
      }));
      persistProfileRegistry(this.profiles);
      const selectedProfileId = loadActiveProfileId();
      this.activeProfileId = selectedProfileId && opened.has(selectedProfileId)
        ? selectedProfileId
        : this.profiles[0].id;
      this.persistActiveProfile();
    } catch (error) {
      await Promise.all([...opened.values()].map((store) => store.close().catch(() => undefined)));
      throw error;
    }
  }

  private storeOptions(profileId: string, databasePath: string) {
    return {
      root: this.root!,
      databasePath,
      profileId,
      passphrase: this.passphrase,
      securityMode: this.securityMode,
      duckdb: this.duckdbOptions!
    };
  }

  private requireOpenStorage(): StorageBackendManifest {
    if (!this.manifest || !this.root || !this.duckdbOptions) {
      throw new Error("DuckDB storage is not open.");
    }
    return this.manifest;
  }

  private persistActiveProfile(): void {
    atomicWriteJson(activeProfilePath(), { profileId: this.activeProfileId });
  }
}

function createEmptyStore(profileId = "self", displayName = "Local user"): HealthStoreData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: {
      id: normalizeProfileId(profileId),
      displayName,
      subjectKind: "adult",
      units: "metric",
      updatedAt: new Date().toISOString()
    },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: defaultMeasurementTypes,
    personalReferenceRanges: [],
    pinnedMeasurements: [],
    observations: [],
    observationGroups: [],
    timeSeriesSamples: [],
    activitySessions: [],
    healthEvents: [],
    careItems: [],
    insights: [],
    auditEvents: []
  };
}

function createInitialManifest(): StorageBackendManifest {
  return {
    version: 1,
    backend: "duckdb",
    activatedAt: new Date().toISOString(),
    profiles: [{ profileId: "self", databaseFile: "health-store-self.duckdb" }]
  };
}

function validateDuckDbRuntime(options: DuckDbActivationOptions): void {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("DuckDB storage productionization is currently approved only for Windows x64.");
  }
  if (!existsSync(options.httpfsExtensionPath)) {
    throw new Error(`Pinned DuckDB extension is unavailable at ${options.httpfsExtensionPath}.`);
  }
  const digest = createHash("sha256").update(readFileSync(options.httpfsExtensionPath)).digest("hex");
  if (!windowsX64HttpfsSha256 || digest !== windowsX64HttpfsSha256) {
    throw new Error("Pinned DuckDB extension failed SHA-256 verification.");
  }
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
    typeof parsed.activatedAt !== "string" ||
    !Array.isArray(parsed.profiles) ||
    parsed.profiles.length === 0 ||
    parsed.profiles.some((entry) =>
      !entry ||
      typeof entry.profileId !== "string" ||
      normalizeProfileId(entry.profileId) !== entry.profileId ||
      typeof entry.databaseFile !== "string" ||
      !isDirectChildFileName(entry.databaseFile)
    )
  ) {
    throw new Error("Storage backend manifest is invalid.");
  }
  return {
    version: 1,
    backend: "duckdb",
    activatedAt: parsed.activatedAt,
    ...(typeof parsed.lastWrittenByAppVersion === "string"
      ? { lastWrittenByAppVersion: parsed.lastWrittenByAppVersion }
      : {}),
    ...(typeof parsed.lastWrittenAt === "string" ? { lastWrittenAt: parsed.lastWrittenAt } : {}),
    profiles: parsed.profiles.map(({ profileId, databaseFile }) => ({ profileId, databaseFile }))
  };
}

function persistStorageBackendManifest(manifest: StorageBackendManifest): void {
  atomicWriteJson(storageBackendManifestPath(), {
    ...manifest,
    lastWrittenByAppVersion: currentAppVersion(),
    lastWrittenAt: new Date().toISOString()
  } satisfies StorageBackendManifest);
}

/**
 * The desktop shell passes its own version through the environment; outside it the workspace
 * version is the best available answer.
 */
function currentAppVersion(): string {
  return process.env.VITANA_APP_VERSION ?? process.env.npm_package_version ?? "unknown";
}

function persistProfileRegistry(profiles: ProfileListEntry[]): void {
  atomicWriteJson(profilesPath(), { profiles });
}

function atomicWriteJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fsyncPath(temporaryPath);
    renameSync(temporaryPath, path);
    fsyncPath(path);
    fsyncPath(dirname(path));
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function loadActiveProfileId(): string | undefined {
  if (!existsSync(activeProfilePath())) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(activeProfilePath(), "utf8")) as { profileId?: string };
    return typeof parsed.profileId === "string" ? normalizeProfileId(parsed.profileId) : undefined;
  } catch {
    return undefined;
  }
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

function profileListEntryFromProfile(profile: Profile, profilePhoto?: ProfilePhotoMetadata): ProfileListEntry {
  return {
    id: normalizeProfileId(profile.id),
    displayName: profile.displayName,
    updatedAt: profile.updatedAt,
    profilePhoto: photoMetadata(profilePhoto)
  };
}

function photoMetadata(profilePhoto?: ProfilePhotoMetadata): ProfilePhotoMetadata | undefined {
  return profilePhoto
    ? { revision: profilePhoto.revision, updatedAt: profilePhoto.updatedAt }
    : undefined;
}

function isDirectChildFileName(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/]/.test(value);
}

function removeDuckDbProfileFiles(databasePath: string): void {
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}.wal`, { force: true });
}

export function resolveStoreSecurityConfig(): StoreSecurityConfig {
  const configuredSecret = process.env.VITANA_SECRET;
  if (configuredSecret && configuredSecret.length >= 16) {
    return { passphrase: configuredSecret, securityMode: "env-secret" };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production health storage requires VITANA_SECRET or an OS-secure key injected by the desktop host.");
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

export function hasDuckDbActivationManifest(): boolean {
  return existsSync(storageBackendManifestPath());
}

function resolveDataDir(): string {
  if (process.env.VITANA_DATA_DIR) {
    return resolve(process.env.VITANA_DATA_DIR);
  }
  const candidates = [resolve(process.cwd(), "..", "..", "data"), resolve(process.cwd(), "data")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function profilesPath(): string {
  return resolve(resolveDataDir(), "profiles.json");
}

function activeProfilePath(): string {
  return resolve(resolveDataDir(), "active-profile.json");
}

function localKeyPath(): string {
  return resolve(resolveDataDir(), "local.key");
}

function duckdbStorageRoot(): string {
  return resolve(resolveDataDir(), "duckdb-storage");
}

function storageBackendManifestPath(): string {
  return resolve(resolveDataDir(), "storage-backend.json");
}

function fsyncPath(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    // Best-effort durability on filesystems that do not support fsync for every path type.
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}
