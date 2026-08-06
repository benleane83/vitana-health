import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const pairingLifetimeMs = 5 * 60 * 1000;
const authorizationSchemaVersion = 6;

export type CompanionCapability =
  | "profiles:list-minimal"
  | "assigned-profile:read"
  | "care:read"
  | "care:write"
  | "observations:import-manual"
  | "observations:write"
  | "reports:preview"
  | "reports:commit"
  | "health-connect:import"
  | "standalone:migrate"
  | "replica:read"
  | "entitlement:read"
  | "entitlement:write"
  | "pairing:self-revoke";
export const companionCapabilities: readonly CompanionCapability[] = [
  "profiles:list-minimal",
  "assigned-profile:read",
  "care:read",
  "care:write",
  "observations:import-manual",
  "observations:write",
  "reports:preview",
  "reports:commit",
  "health-connect:import",
  "standalone:migrate",
  "replica:read",
  "entitlement:read",
  "entitlement:write",
  "pairing:self-revoke"
] as const;

export interface PairingRecord {
  id: string;
  deviceId: string;
  deviceName: string;
  status: "pending" | "approved" | "denied";
  requestedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  tokenDelivered: boolean;
  authorizationSchemaVersion: number;
  capabilities: CompanionCapability[];
  allowedProfileIds: [] | [string];
}

interface InternalPairingRecord extends PairingRecord {
  pollingSecretHash: string;
  tokenHash: string | null;
  pendingToken: string | null;
}

export interface CompanionPrincipal {
  kind: "companion";
  pairingId: string;
  deviceId: string;
  capabilities: readonly CompanionCapability[];
  allowedProfileIds: readonly [string];
}

interface PairingChallenge {
  codeHash: string;
  expiresAt: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class PairingStore {
  private records = new Map<string, InternalPairingRecord>();
  private challenges = new Map<string, PairingChallenge>();
  private readonly dataPath: string;
  private readonly serverInstanceId: string;
  private usagePersistTimer: ReturnType<typeof setTimeout> | undefined;
  private exposureRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private exposureListener: ((required: boolean) => void) | undefined;
  private lastExposureState: boolean | undefined;

  constructor() {
    const dataDir = resolve(process.env.VITANA_DATA_DIR ?? "data");
    this.dataPath = resolve(dataDir, "paired-devices.json");
    const serverInstancePath = resolve(dataDir, "server-instance-id");
    mkdirSync(dataDir, { recursive: true });
    this.serverInstanceId = readOrCreateServerInstanceId(serverInstancePath);
    if (!existsSync(this.dataPath)) return;
    try {
      const records = JSON.parse(readFileSync(this.dataPath, "utf8")) as InternalPairingRecord[];
      for (const record of records) {
        if (
          record.status === "approved" &&
          record.authorizationSchemaVersion === authorizationSchemaVersion &&
          record.capabilities?.length === companionCapabilities.length &&
          companionCapabilities.every((capability) => record.capabilities.includes(capability)) &&
          Array.isArray(record.allowedProfileIds) &&
          record.allowedProfileIds.length === 1
        ) {
          this.records.set(record.id, { ...record, pendingToken: null, tokenDelivered: true });
        }

      }
    } catch {
      throw new Error(`Could not read paired device registry at ${this.dataPath}.`);
    }

  }

  getServerInstanceId(): string {
    return this.serverInstanceId;
  }

  setLanExposureListener(listener: (required: boolean) => void): void {
    this.exposureListener = listener;
    this.refreshLanExposure();
  }

  requiresLanExposure(): boolean {
    this.prune();
    return this.computeLanExposure();
  }

  createChallenge(): { code: string; expiresAt: string } {
    this.prune();
    const code = randomBytes(6).toString("base64url");
    const expiresAt = Date.now() + pairingLifetimeMs;
    this.challenges.set(hash(code), { codeHash: hash(code), expiresAt });
    this.refreshLanExposure();
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  request(deviceId: string, deviceName: string, code: string): { record: PairingRecord; pollingSecret: string } | null {
    this.prune();
    const codeHash = hash(code);
    const challenge = this.challenges.get(codeHash);
    if (!challenge || challenge.expiresAt <= Date.now() || !hashesMatch(challenge.codeHash, codeHash)) {
      return null;
    }
    this.challenges.delete(codeHash);

    const id = randomBytes(16).toString("hex");
    const pollingSecret = randomBytes(32).toString("base64url");
    const now = new Date();
    const record: InternalPairingRecord = {
      id,
      deviceId,
      deviceName: deviceName.slice(0, 80),
      status: "pending",
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + pairingLifetimeMs).toISOString(),
      resolvedAt: null,
      lastUsedAt: null,
      revokedAt: null,
      tokenDelivered: false,
      authorizationSchemaVersion,
      capabilities: [...companionCapabilities],
      allowedProfileIds: [],
      pollingSecretHash: hash(pollingSecret),
      tokenHash: null,
      pendingToken: null
    };
    this.records.set(id, record);
    this.refreshLanExposure();
    return { record: this.publicRecord(record), pollingSecret };
  }

  approve(id: string, profileId: string): PairingRecord | null {
    const record = this.records.get(id);
    if (!record || !profileId || record.status !== "pending" || Date.parse(record.expiresAt) <= Date.now()) return null;
    for (const existing of this.records.values()) {
      if (existing.deviceId === record.deviceId && existing.status === "approved" && !existing.revokedAt) {
        existing.revokedAt = new Date().toISOString();
        existing.tokenHash = null;
        existing.pendingToken = null;
      }
    }
    const token = randomBytes(32).toString("base64url");
    record.status = "approved";
    record.tokenHash = hash(token);
    record.pendingToken = token;
    record.resolvedAt = new Date().toISOString();
    record.allowedProfileIds = [profileId];
    this.persist();
    this.refreshLanExposure();
    return this.publicRecord(record);
  }

  deny(id: string): PairingRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== "pending") return null;
    record.status = "denied";
    record.resolvedAt = new Date().toISOString();
    this.refreshLanExposure();
    return this.publicRecord(record);
  }

  getPending(): PairingRecord[] {
    this.prune();
    return [...this.records.values()].filter((record) => record.status === "pending").map((record) => this.publicRecord(record));
  }

  getStatus(id: string, pollingSecret: string): { record: PairingRecord; token?: string } | null {
    const record = this.records.get(id);
    if (!record || !hashesMatch(record.pollingSecretHash, hash(pollingSecret))) return null;
    const result: { record: PairingRecord; token?: string } = { record: this.publicRecord(record) };
    if (record.status === "approved" && !record.tokenDelivered && record.pendingToken) {
      result.token = record.pendingToken;
      record.pendingToken = null;
      record.tokenDelivered = true;
      this.persist();
    }
    return result;
  }

  validateToken(token: string): CompanionPrincipal | null {
    const candidate = hash(token);
    for (const record of this.records.values()) {
      if (record.status === "approved" && !record.revokedAt && record.tokenHash && hashesMatch(record.tokenHash, candidate)) {
        record.lastUsedAt = new Date().toISOString();
        this.scheduleUsagePersist();
        const profileId = record.allowedProfileIds[0];
        if (!profileId) continue;
        return {
          kind: "companion",
          pairingId: record.id,
          deviceId: record.deviceId,
          capabilities: record.capabilities,
          allowedProfileIds: [profileId]
        };
      }
    }
    return null;
  }

  flushPendingWrites(): void {
    if (this.usagePersistTimer) {
      clearTimeout(this.usagePersistTimer);
      this.usagePersistTimer = undefined;
      this.persist();
    }
    if (this.exposureRefreshTimer) {
      clearTimeout(this.exposureRefreshTimer);
      this.exposureRefreshTimer = undefined;
    }
  }

  listDevices(): PairingRecord[] {
    return [...this.records.values()]
      .filter((record) => record.status === "approved")
      .sort((left, right) => {
        if (!left.revokedAt && right.revokedAt) return -1;
        if (left.revokedAt && !right.revokedAt) return 1;
        return Date.parse(right.revokedAt ?? right.requestedAt) - Date.parse(left.revokedAt ?? left.requestedAt);
      })
      .map((record) => this.publicRecord(record));
  }

  revoke(id: string): PairingRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== "approved") return null;
    record.revokedAt = new Date().toISOString();
    record.tokenHash = null;
    record.pendingToken = null;
    this.persist();
    this.refreshLanExposure();
    return this.publicRecord(record);
  }

  revokeProfile(profileId: string): void {
    let changed = false;
    for (const record of this.records.values()) {
      if (record.status === "approved" && !record.revokedAt && record.allowedProfileIds[0] === profileId) {
        record.revokedAt = new Date().toISOString();
        record.tokenHash = null;
        record.pendingToken = null;
        changed = true;
      }
    }
    if (changed) {
      this.persist();
      this.refreshLanExposure();
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(key);
    }
    for (const record of this.records.values()) {
      if (record.status === "pending" && Date.parse(record.expiresAt) <= now) {
        record.status = "denied";
        record.resolvedAt = new Date().toISOString();
      }
    }
    this.refreshLanExposure();
  }

  private computeLanExposure(): boolean {
    if (this.challenges.size > 0) return true;
    return [...this.records.values()].some((record) =>
      (record.status === "pending" && Date.parse(record.expiresAt) > Date.now()) ||
      (record.status === "approved" && !record.revokedAt)
    );
  }

  private refreshLanExposure(): void {
    const required = this.computeLanExposure();
    if (required !== this.lastExposureState) {
      this.lastExposureState = required;
      this.exposureListener?.(required);
    }

    if (this.exposureRefreshTimer) clearTimeout(this.exposureRefreshTimer);
    const expirations = [
      ...[...this.challenges.values()].map((challenge) => challenge.expiresAt),
      ...[...this.records.values()]
        .filter((record) => record.status === "pending")
        .map((record) => Date.parse(record.expiresAt))
    ].filter((expiresAt) => expiresAt > Date.now());
    if (expirations.length === 0) {
      this.exposureRefreshTimer = undefined;
      return;
    }
    const delay = Math.max(1, Math.min(...expirations) - Date.now() + 1);
    this.exposureRefreshTimer = setTimeout(() => this.prune(), delay);
    this.exposureRefreshTimer.unref?.();
  }

  private publicRecord(record: InternalPairingRecord): PairingRecord {
    const { pollingSecretHash: _pollingSecretHash, tokenHash: _tokenHash, pendingToken: _pendingToken, ...publicRecord } = record;
    return publicRecord;
  }

  private persist(): void {
    // Retain revoked records so device management can show their state and prevent token reuse.
    const records = [...this.records.values()].filter((record) => record.status === "approved" && record.tokenDelivered);
    const temporaryPath = `${this.dataPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(records, null, 2), { encoding: "utf8", mode: 0o600 });
      renameSync(temporaryPath, this.dataPath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  private scheduleUsagePersist(): void {
    if (this.usagePersistTimer) return;
    this.usagePersistTimer = setTimeout(() => {
      this.usagePersistTimer = undefined;
      if (existsSync(dirname(this.dataPath))) this.persist();
    }, 250);
    this.usagePersistTimer.unref?.();
  }
}

function readOrCreateServerInstanceId(serverInstancePath: string): string {
  try {
    return parseServerInstanceId(readFileSync(serverInstancePath, "utf8"), serverInstancePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const generated = randomUUID();
  try {
    writeFileSync(serverInstancePath, `${generated}\n`, { mode: 0o600, flag: "wx" });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return parseServerInstanceId(readFileSync(serverInstancePath, "utf8"), serverInstancePath);
  }
}

function parseServerInstanceId(value: string, serverInstancePath: string): string {
  const stored = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(stored)) {
    throw new Error(`Could not read server identity at ${serverInstancePath}.`);
  }
  return stored;
}
