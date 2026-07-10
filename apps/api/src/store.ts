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
import { dirname, resolve } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  defaultMeasurementTypes,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type HealthDataDetailEntry,
  type HealthStoreData,
  type Observation,
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

const maxRawImportChars = 1_000_000;
const maxObservations = 250_000;
const maxTimeSeriesSamples = 10_000;
const minPerMeasurementCode = 500;
const maxActivitySessions = 75_000;
const maxLabPanels = 20_000;
const maxLabMarkers = 200_000;

export class HealthStore {
  private data: HealthStoreData;
  private readonly passphrase: string;
  private readonly dataPath: string;
  private readonly backupPath: string;
  private readonly localKeyPath: string;
  readonly securityMode: "env-secret" | "generated-local-key";

  constructor() {
    const dataDir = process.env.LFA_DATA_DIR ? resolve(process.env.LFA_DATA_DIR) : resolveDataDir();
    this.dataPath = resolve(dataDir, "health-store.enc");
    this.backupPath = `${this.dataPath}.bak`;
    this.localKeyPath = resolve(dataDir, "local.key");
    mkdirSync(dirname(this.dataPath), { recursive: true });
    const configuredSecret = process.env.LFA_SECRET;
    if (configuredSecret && configuredSecret.length >= 16) {
      this.passphrase = configuredSecret;
      this.securityMode = "env-secret";
    } else {
      this.passphrase = this.getOrCreateLocalKey();
      this.securityMode = "generated-local-key";
    }
    this.data = existsSync(this.dataPath) ? this.readEncryptedStore() : createEmptyStore();
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
    this.data.profile = { ...profile, id: "self", updatedAt: new Date().toISOString() };
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

  private getOrCreateLocalKey(): string {
    mkdirSync(dirname(this.localKeyPath), { recursive: true });
    if (existsSync(this.localKeyPath)) {
      return readFileSync(this.localKeyPath, "utf8").trim();
    }
    const key = randomBytes(32).toString("base64url");
    writeFileSync(this.localKeyPath, key, { encoding: "utf8", mode: 0o600 });
    return key;
  }

  private readEncryptedStore(): HealthStoreData {
    try {
      return this.readEncryptedStoreAtPath(this.dataPath);
    } catch (primaryError) {
      if (!existsSync(this.backupPath)) {
        throw primaryError;
      }
      const recovered = this.readEncryptedStoreAtPath(this.backupPath);
      writeFileSync(this.dataPath, readFileSync(this.backupPath), { encoding: "utf8", mode: 0o600 });
      return recovered;
    }
  }

  private readEncryptedStoreAtPath(path: string): HealthStoreData {
    const envelope = JSON.parse(readFileSync(path, "utf8")) as EncryptedEnvelope;
    const key = scryptSync(this.passphrase, Buffer.from(envelope.salt, "base64"), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.payload, "base64")),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString("utf8")) as HealthStoreData;
  }

  private persist(): void {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.passphrase, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(this.data)), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      payload: encrypted.toString("base64")
    };
    const serialized = JSON.stringify(envelope, null, 2);
    const tempPath = `${this.dataPath}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    let oldStoreMoved = false;
    try {
      writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
      this.readEncryptedStoreAtPath(tempPath);
      fsyncPath(tempPath);

      if (existsSync(this.dataPath)) {
        renameSync(this.dataPath, this.backupPath);
        oldStoreMoved = true;
      }
      renameSync(tempPath, this.dataPath);
      fsyncPath(this.dataPath);
      fsyncPath(dirname(this.dataPath));
    } catch (error) {
      if (oldStoreMoved && !existsSync(this.dataPath) && existsSync(this.backupPath)) {
        renameSync(this.backupPath, this.dataPath);
      }
      throw error;
    } finally {
      if (existsSync(tempPath)) {
        rmSync(tempPath, { force: true });
      }
    }
  }
}

function createEmptyStore(): HealthStoreData {
  return {
    profile: {
      id: "self",
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
