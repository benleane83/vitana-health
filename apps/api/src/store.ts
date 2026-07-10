import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  defaultMeasurementTypes,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type HealthDataDetailEntry,
  type HealthStoreData,
  type Observation,
  type Profile,
  type ProfileListEntry,
  type SourceImport
} from "@local-fitness-advisor/shared";
import { listHealthDataDetailEntries } from "./summary.js";

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

interface ActiveProfileFile {
  profileId: string;
}

const profileIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const dataDir = process.env.LFA_DATA_DIR ? resolve(process.env.LFA_DATA_DIR) : resolveDataDir();
const localKeyPath = resolve(dataDir, "local.key");
const profilesPath = resolve(dataDir, "profiles.json");
const activeProfilePath = resolve(dataDir, "active-profile.json");
const legacyDataPath = resolve(dataDir, "health-store.enc");
const maxRawImportChars = 1_000_000;
const maxObservations = 250_000;
const maxTimeSeriesSamples = 10_000;
const minPerMeasurementCode = 500;
const maxActivitySessions = 75_000;
const maxLabPanels = 20_000;
const maxLabMarkers = 200_000;

export interface StoreSecurityConfig {
  passphrase: string;
  securityMode: "env-secret" | "generated-local-key";
}

export class HealthStore {
  private data: HealthStoreData;
  private readonly passphrase: string;
  readonly securityMode: "env-secret" | "generated-local-key";
  readonly profileId: string;
  private readonly dataPath: string;

  constructor(options: { profileId?: string; passphrase?: string; securityMode?: "env-secret" | "generated-local-key" } = {}) {
    this.profileId = normalizeProfileId(options.profileId ?? "self");
    this.dataPath = resolveStorePath(this.profileId);
    mkdirSync(dirname(this.dataPath), { recursive: true });

    if (options.passphrase && options.securityMode) {
      this.passphrase = options.passphrase;
      this.securityMode = options.securityMode;
    } else {
      const security = resolveStoreSecurityConfig();
      this.passphrase = security.passphrase;
      this.securityMode = security.securityMode;
    }

    this.data = existsSync(this.dataPath) ? readEncryptedStore(this.dataPath, this.passphrase) : createEmptyStore(this.profileId);
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
    timeSeriesSamples: HealthStoreData["timeSeriesSamples"];
    activitySessions: HealthStoreData["activitySessions"];
    labPanels: HealthStoreData["labPanels"];
    labMarkers: HealthStoreData["labMarkers"];
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
    this.data.labPanels = limitByNewest(
      appendUniqueById(this.data.labPanels, parsed.labPanels),
      maxLabPanels,
      (item) => item.collectedAt
    );
    this.data.labMarkers = limitByNewest(
      appendUniqueById(this.data.labMarkers, parsed.labMarkers),
      maxLabMarkers,
      (item) => item.id
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

  listDetailEntries(measurementCode: string): HealthDataDetailEntry[] {
    return listHealthDataDetailEntries(this.snapshot(), measurementCode);
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

  private persist(): void {
    writeEncryptedStore(this.dataPath, this.passphrase, this.data);
  }
}

export class ProfileStoreManager {
  readonly securityMode: "env-secret" | "generated-local-key";

  private readonly passphrase: string;
  private stores = new Map<string, HealthStore>();
  private profiles: ProfileListEntry[] = [];
  private activeProfileId = "self";

  constructor() {
    mkdirSync(dataDir, { recursive: true });
    const security = resolveStoreSecurityConfig();
    this.passphrase = security.passphrase;
    this.securityMode = security.securityMode;
    this.initialize();
  }

  listProfiles(): ProfileListEntry[] {
    return [...this.profiles];
  }

  getActiveProfileId(): string {
    return this.activeProfileId;
  }

  getActiveStore(): HealthStore {
    return this.getStore(this.activeProfileId);
  }

  getStore(profileId: string): HealthStore {
    const normalizedId = normalizeProfileId(profileId);
    const existing = this.stores.get(normalizedId);
    if (existing) {
      return existing;
    }
    const created = new HealthStore({
      profileId: normalizedId,
      passphrase: this.passphrase,
      securityMode: this.securityMode
    });
    this.stores.set(normalizedId, created);
    return created;
  }

  createProfile(displayName: string): ProfileListEntry {
    const name = displayName.trim() || "Local user";
    const id = generateProfileId(name, new Set(this.profiles.map((entry) => entry.id)));
    const store = this.getStore(id);
    store.replaceProfile({
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

  deleteProfile(profileId: string): { activeProfileId: string } {
    const normalizedId = normalizeProfileId(profileId);
    if (this.profiles.length <= 1) {
      throw new Error("Cannot delete the last remaining profile.");
    }
    if (!this.profiles.some((entry) => entry.id === normalizedId)) {
      throw new Error("Profile not found.");
    }

    this.profiles = this.profiles.filter((entry) => entry.id !== normalizedId);
    this.stores.delete(normalizedId);

    const profileDataPath = resolveStorePath(normalizedId);
    if (existsSync(profileDataPath)) {
      try {
        unlinkSync(profileDataPath);
      } catch {
        // best effort; keep registry consistent even if filesystem cleanup fails
      }
    }

    if (this.activeProfileId === normalizedId) {
      this.activeProfileId = this.profiles[0].id;
      this.persistActiveProfile();
    }
    this.persistProfiles();
    return { activeProfileId: this.activeProfileId };
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

  private refreshProfileEntriesFromStores(): void {
    this.profiles = this.profiles.map((entry) => {
      const store = this.getStore(entry.id);
      return profileListEntryFromProfile(store.snapshot().profile);
    });
    this.persistProfiles();
  }

  private migrateLegacyIfNeeded(): void {
    if (existsSync(profilesPath)) {
      return;
    }

    if (existsSync(legacyDataPath)) {
      const targetPath = resolveStorePath("self");
      if (!existsSync(targetPath)) {
        copyFileSync(legacyDataPath, targetPath);
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
    writeFileSync(profilesPath, JSON.stringify({ profiles: this.profiles }, null, 2), { encoding: "utf8" });
  }

  private persistActiveProfile(): void {
    writeFileSync(activeProfilePath, JSON.stringify({ profileId: this.activeProfileId }, null, 2), { encoding: "utf8" });
  }
}

export function resolveStoreSecurityConfig(): StoreSecurityConfig {
  const configuredSecret = process.env.LFA_SECRET;
  if (configuredSecret && configuredSecret.length >= 16) {
    return { passphrase: configuredSecret, securityMode: "env-secret" };
  }
  return { passphrase: getOrCreateLocalKey(), securityMode: "generated-local-key" };
}

function readEncryptedStore(filePath: string, passphrase: string): HealthStoreData {
  const envelope = JSON.parse(readFileSync(filePath, "utf8")) as EncryptedEnvelope;
  const key = scryptSync(passphrase, Buffer.from(envelope.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.payload, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as HealthStoreData;
}

function writeEncryptedStore(filePath: string, passphrase: string, data: HealthStoreData): void {
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
  writeFileSync(filePath, JSON.stringify(envelope, null, 2), { encoding: "utf8" });
}

function profileListEntryFromProfile(profile: Profile): ProfileListEntry {
  return {
    id: normalizeProfileId(profile.id),
    displayName: profile.displayName,
    updatedAt: profile.updatedAt
  };
}

function loadProfileRegistry(): ProfileListEntry[] {
  if (!existsSync(profilesPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfileRegistryFile;
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
  if (!existsSync(activeProfilePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(activeProfilePath, "utf8")) as ActiveProfileFile;
    if (!parsed?.profileId) {
      return undefined;
    }
    return normalizeProfileId(parsed.profileId);
  } catch {
    return undefined;
  }
}

function generateProfileId(displayName: string, existing: Set<string>): string {
  const base = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "profile";
  let candidate = base;
  let suffix = 1;
  while (existing.has(candidate) || candidate === "self") {
    suffix += 1;
    candidate = `${base}-${suffix}`.slice(0, 64);
  }
  return normalizeProfileId(candidate);
}

function normalizeProfileId(profileId: string): string {
  const normalized = profileId.trim().toLowerCase();
  if (!profileIdPattern.test(normalized)) {
    throw new Error("Profile id contains unsupported characters.");
  }
  return normalized;
}

function resolveStorePath(profileId: string): string {
  return resolve(dataDir, `health-store-${normalizeProfileId(profileId)}.enc`);
}

function getOrCreateLocalKey(): string {
  mkdirSync(dirname(localKeyPath), { recursive: true });
  if (existsSync(localKeyPath)) {
    return readFileSync(localKeyPath, "utf8").trim();
  }
  const key = randomBytes(32).toString("base64url");
  writeFileSync(localKeyPath, key, { encoding: "utf8", mode: 0o600 });
  return key;
}

function createEmptyStore(profileId: string): HealthStoreData {
  return {
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
    timeSeriesSamples: [],
    activitySessions: [],
    sleepSessions: [],
    sleepStageIntervals: [],
    labPanels: [],
    labMarkers: [],
    insights: [],
    auditEvents: []
  };
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
  const candidates = [
    resolve(process.cwd(), "data"),
    resolve(process.cwd(), "..", "..", "data")
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? candidates[0];
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

function observationDeleteDetail(observation: Observation): string {
  return `Observation ${observation.measurementCode} deleted at ${observation.observedAt} (${observation.value} ${observation.unit}).`;
}
