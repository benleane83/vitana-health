import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  EXPORT_FORMAT_VERSION,
  defaultMeasurementTypes,
  pinnedHttpfsSha256,
  supportedHostPlatform,
  supportedHostPlatformsDescription,
  type HealthStoreData,
  type Profile,
  type ProfilePhotoMetadata,
  type ProfileListEntry
} from "@vitana/shared";
import { initializeDuckDbRoot, type DuckDbOptions } from "./duckdbRuntime.js";
import { DuckDbHealthStore } from "./duckdbHealthStore.js";
import { LazyProfileStore, defaultIdleTimeoutMs } from "./lazyProfileStore.js";
import type { ManagedProfileRepository } from "./profileRepository.js";
import type { CompiledQuery } from "../queryCompiler.js";
import type { StorageBackend, StoreSecurityConfig, StoreSecurityMode } from "./types.js";
import { RestoreJournal } from "./restoreJournal.js";
import { sweepOrphanedTempFiles } from "./orphanedTempFiles.js";

export interface DuckDbActivationOptions {
  httpfsExtensionPath: string;
  root?: string;
}

// Defined in the neutral module and re-exported here, which is where callers have always found
// them. A second engine has to satisfy the same security contract, so it is not DuckDB's to own.
export type { StorageBackend, StoreSecurityConfig, StoreSecurityMode };

export interface OpenProfileStoreManagerOptions {
  security?: StoreSecurityConfig;
  storageBackend: StorageBackend;
  duckdb: DuckDbActivationOptions;
  /** Overridable so tests can assert eviction without waiting out the real idle window. */
  idleTimeoutMs?: number;
}

interface StorageBackendManifest {
  version: 1;
  backend: StorageBackend;
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
  private readonly idleTimeoutMs: number;
  private stores = new Map<string, LazyProfileStore>();
  private profiles: ProfileListEntry[] = [];
  private activeProfileId = "self";
  private manifest: StorageBackendManifest | undefined;
  private root: string | undefined;
  private duckdbOptions: DuckDbOptions | undefined;

  private constructor(security: StoreSecurityConfig, idleTimeoutMs: number) {
    this.passphrase = security.passphrase;
    this.securityMode = security.securityMode;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  static async open(options: OpenProfileStoreManagerOptions): Promise<ProfileStoreManager> {
    await mkdir(resolveDataDir(), { recursive: true });
    const manager = new ProfileStoreManager(
      options.security ?? resolveStoreSecurityConfig(),
      options.idleTimeoutMs ?? defaultIdleTimeoutMs
    );
    await manager.openDuckDb(options.duckdb);
    return manager;
  }

  listProfiles(): ProfileListEntry[] {
    return [...this.profiles];
  }

  async syncProfilePhotoMetadata(profileId: string, profilePhoto?: ProfilePhotoMetadata): Promise<void> {
    this.profiles = this.profiles.map((entry) =>
      entry.id === profileId ? { ...entry, profilePhoto: photoMetadata(profilePhoto) } : entry
    );
    await persistProfileRegistry(this.profiles);
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
    this.evictIdleStores(normalizedId);
    return store.repository;
  }

  /**
   * Opportunistic sweep, run whenever a store is handed out. There is no background timer to unref,
   * stop or leak, and the moment attention moves to one profile is exactly the moment the others
   * became reclaimable.
   */
  private evictIdleStores(keepProfileId: string): void {
    for (const [profileId, store] of this.stores) {
      if (profileId === keepProfileId || !store.isOpen) {
        continue;
      }
      void store.evictIfIdle(this.idleTimeoutMs).catch((error: unknown) => {
        console.error(`Failed to close the idle profile store ${profileId}.`, error);
      });
    }
  }

  getStorageBackend(): StorageBackend {
    return "duckdb";
  }

  runActiveCompiledQuery(query: CompiledQuery): Promise<Array<Record<string, unknown>>> {
    return this.getActiveStore().runCompiledQuery(query);
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
      await persistProfileRegistry(nextProfiles);
      try {
        await persistStorageBackendManifest(nextManifest);
      } catch (error) {
        await persistProfileRegistry(this.profiles);
        throw error;
      }
      this.profiles = nextProfiles;
      this.manifest = nextManifest;
      this.stores.set(id, this.lazyStore(id, databasePath, store));
      return entry;
    } catch (error) {
      await store?.close().catch(() => undefined);
      await removeDuckDbProfileFiles(databasePath);
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
          await rename(item.livePath, item.rollbackPath!);
        }
        await rename(item.stagedPath, item.livePath);
        this.stores.set(item.targetId, this.lazyStore(item.targetId, item.livePath));
        journal.updateEntryStatus(item.request.sourceProfileId, "committed");
      }

      const restoredIds = new Set(prepared.map((item) => item.targetId));
      const restoredProfiles = await Promise.all(
        prepared.map(async (item) => profileListEntryFromProfile(await this.stores.get(item.targetId)!.repository.getProfile()))
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
      await persistProfileRegistry(this.profiles);
      await persistStorageBackendManifest(this.manifest);
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
      // The surviving handles reopen on demand, so putting the original map back is the whole
      // recovery: any handle closed during the commit loop simply reopens the rolled-back file.
      this.stores = originalStores;
      throw error;
    }
  }

  async setActiveProfile(profileId: string): Promise<string> {
    const normalizedId = normalizeProfileId(profileId);
    if (!this.profiles.some((entry) => entry.id === normalizedId)) {
      throw new ProfileNotFoundError("Profile not found.");
    }
    this.activeProfileId = normalizedId;
    await this.persistActiveProfile();
    // Drop the handle if it is resident but idle so it reopens with the active profile's larger
    // memory limit rather than the one it was given as a background profile.
    await this.stores.get(normalizedId)?.evictIfIdle(0);
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
    await persistProfileRegistry(nextProfiles);
    try {
      await persistStorageBackendManifest(nextManifest);
    } catch (error) {
      await persistProfileRegistry(this.profiles);
      throw error;
    }
    this.profiles = nextProfiles;
    this.manifest = nextManifest;
    this.stores.delete(normalizedId);
    if (this.activeProfileId === normalizedId) {
      this.activeProfileId = this.profiles[0].id;
      await this.persistActiveProfile();
    }
    await store.close();
    await removeDuckDbProfileFiles(resolve(this.root!, "databases", manifestEntry.databaseFile));
    return { activeProfileId: this.activeProfileId };
  }

  async syncProfileEntry(profile: Profile): Promise<void> {
    const normalizedId = normalizeProfileId(profile.id);
    const index = this.profiles.findIndex((entry) => entry.id === normalizedId);
    if (index < 0) {
      throw new ProfileNotFoundError(`DuckDB profile ${normalizedId} is not registered.`);
    }
    this.profiles[index] = profileListEntryFromProfile(profile, this.profiles[index].profilePhoto);
    await persistProfileRegistry(this.profiles);
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
    await validateDuckDbRuntime(options);
    RestoreJournal.recover(resolveDataDir());
    this.root = initializeDuckDbRoot(options.root ?? duckdbStorageRoot());
    sweepOrphanedTempFiles([resolveDataDir(), this.root, resolve(this.root, "databases")]);
    this.duckdbOptions = { httpfsExtensionPath: options.httpfsExtensionPath };
    const existingManifest = await loadStorageBackendManifest();
    const manifest = existingManifest ?? createInitialManifest();
    const opened = new Map<string, LazyProfileStore>();

    try {
      for (const entry of manifest.profiles) {
        const databasePath = resolve(this.root, "databases", entry.databaseFile);
        if (existingManifest) {
          if (!(await fileExists(databasePath))) {
            throw new Error(`DuckDB database is missing for profile ${entry.profileId}: ${databasePath}`);
          }
          // Registered, not opened. Nothing has asked to read this profile yet.
          opened.set(entry.profileId, this.lazyStore(entry.profileId, databasePath));
        } else {
          const store = await DuckDbHealthStore.hydrate(
            this.storeOptions(entry.profileId, databasePath),
            createEmptyStore(entry.profileId)
          );
          opened.set(entry.profileId, this.lazyStore(entry.profileId, databasePath, store));
        }
      }
      if (!existingManifest) {
        await persistStorageBackendManifest(manifest);
      }
      this.stores = opened;
      this.manifest = manifest;
      this.profiles = await this.resolveProfileList(manifest);
      await persistProfileRegistry(this.profiles);
      const selectedProfileId = await loadActiveProfileId();
      this.activeProfileId = selectedProfileId && opened.has(selectedProfileId)
        ? selectedProfileId
        : this.profiles[0].id;
      await this.persistActiveProfile();
    } catch (error) {
      await Promise.all([...opened.values()].map((store) => store.close().catch(() => undefined)));
      throw error;
    }
  }

  /**
   * The registry file is this manager's own projection of every profile's identity, rewritten on
   * every change that could invalidate it. Trusting it while it still lines up with the manifest is
   * what keeps startup from opening a database per family member just to read a display name.
   */
  private async resolveProfileList(manifest: StorageBackendManifest): Promise<ProfileListEntry[]> {
    const expectedIds = manifest.profiles.map((entry) => entry.profileId);
    const registered = await loadProfileRegistry();
    if (
      registered &&
      registered.length === expectedIds.length &&
      expectedIds.every((profileId, index) => registered[index].id === profileId)
    ) {
      return registered;
    }
    return Promise.all(expectedIds.map(async (profileId) => {
      const store = this.stores.get(profileId)!.repository;
      const [profile, photo] = await Promise.all([store.getProfile(), store.getProfilePhoto()]);
      return profileListEntryFromProfile(profile, photo);
    }));
  }

  private lazyStore(profileId: string, databasePath: string, initial?: DuckDbHealthStore): LazyProfileStore {
    return new LazyProfileStore({
      profileId,
      open: () => DuckDbHealthStore.open(this.storeOptions(profileId, databasePath)),
      ...(initial ? { initial } : {})
    });
  }

  private storeOptions(profileId: string, databasePath: string) {
    return {
      root: this.root!,
      databasePath,
      profileId,
      passphrase: this.passphrase,
      securityMode: this.securityMode,
      duckdb: {
        ...this.duckdbOptions!,
        // Only the profile being looked at gets the import-sized budget. Reserving it for every
        // registered family member multiplied the configured limit by the size of the household.
        memoryLimit: profileId === this.activeProfileId ? "256MB" : "64MB"
      } satisfies DuckDbOptions
    };
  }

  private requireOpenStorage(): StorageBackendManifest {
    if (!this.manifest || !this.root || !this.duckdbOptions) {
      throw new Error("DuckDB storage is not open.");
    }
    return this.manifest;
  }

  private persistActiveProfile(): Promise<void> {
    return atomicWriteJson(activeProfilePath(), { profileId: this.activeProfileId });
  }
}

function createEmptyStore(profileId = "self", displayName = "Local user"): HealthStoreData {
  return {
    schemaVersion: EXPORT_FORMAT_VERSION,
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
    measurementAggregates: [],
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

async function validateDuckDbRuntime(options: DuckDbActivationOptions): Promise<void> {
  if (!supportedHostPlatform(process.platform, process.arch)) {
    throw new Error(
      `DuckDB storage is not approved for ${process.platform}/${process.arch}. `
        + `Approved hosts: ${supportedHostPlatformsDescription()}.`
    );
  }
  const extension = await readFile(options.httpfsExtensionPath).catch(() => undefined);
  if (!extension) {
    throw new Error(`Pinned DuckDB extension is unavailable at ${options.httpfsExtensionPath}.`);
  }
  const digest = createHash("sha256").update(extension).digest("hex");
  const expected = pinnedHttpfsSha256(process.platform, process.arch);
  if (!expected || digest !== expected) {
    throw new Error("Pinned DuckDB extension failed SHA-256 verification.");
  }
}

async function loadStorageBackendManifest(): Promise<StorageBackendManifest | undefined> {
  const raw = await readFileIfPresent(storageBackendManifestPath());
  if (raw === undefined) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as StorageBackendManifest;
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

function persistStorageBackendManifest(manifest: StorageBackendManifest): Promise<void> {
  return atomicWriteJson(storageBackendManifestPath(), {
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

function persistProfileRegistry(profiles: ProfileListEntry[]): Promise<void> {
  return atomicWriteJson(profilesPath(), { profiles });
}

/** Returns the persisted profile list, or `undefined` when it is absent or does not parse. */
async function loadProfileRegistry(): Promise<ProfileListEntry[] | undefined> {
  const raw = await readFileIfPresent(profilesPath());
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { profiles?: unknown };
    if (!Array.isArray(parsed.profiles) || !parsed.profiles.every(isProfileListEntry)) {
      return undefined;
    }
    return parsed.profiles.map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      updatedAt: entry.updatedAt,
      profilePhoto: photoMetadata(entry.profilePhoto)
    }));
  } catch {
    return undefined;
  }
}

function isProfileListEntry(value: unknown): value is ProfileListEntry {
  const entry = value as ProfileListEntry | null;
  return Boolean(
    entry &&
    typeof entry.id === "string" &&
    typeof entry.displayName === "string" &&
    typeof entry.updatedAt === "string" &&
    (entry.profilePhoto === undefined ||
      (typeof entry.profilePhoto.revision === "string" && typeof entry.profilePhoto.updatedAt === "string"))
  );
}

async function readFileIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fsyncPath(temporaryPath);
    await rename(temporaryPath, path);
    await fsyncPath(path);
    await fsyncPath(dirname(path));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function loadActiveProfileId(): Promise<string | undefined> {
  const raw = await readFileIfPresent(activeProfilePath());
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { profileId?: string };
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

async function removeDuckDbProfileFiles(databasePath: string): Promise<void> {
  await rm(databasePath, { force: true });
  await rm(`${databasePath}.wal`, { force: true });
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
  try {
    return readFileSync(keyPath, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const key = randomBytes(32).toString("base64url");
  try {
    writeFileSync(keyPath, key, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readFileSync(keyPath, "utf8").trim();
  }
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

async function fsyncPath(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    // Best-effort durability on filesystems that do not support fsync for every path type.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
