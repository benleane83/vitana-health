import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const pairingLifetimeMs = 5 * 60 * 1000;

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
}

interface InternalPairingRecord extends PairingRecord {
  pollingSecretHash: string;
  tokenHash: string | null;
  pendingToken: string | null;
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

  createChallenge(): { code: string; expiresAt: string } {
    this.prune();
    const code = randomBytes(6).toString("base64url");
    const expiresAt = Date.now() + pairingLifetimeMs;
    this.challenges.set(hash(code), { codeHash: hash(code), expiresAt });
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
      pollingSecretHash: hash(pollingSecret),
      tokenHash: null,
      pendingToken: null
    };
    this.records.set(id, record);
    return { record: this.publicRecord(record), pollingSecret };
  }

  approve(id: string): PairingRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== "pending" || Date.parse(record.expiresAt) <= Date.now()) return null;
    const token = randomBytes(32).toString("base64url");
    record.status = "approved";
    record.tokenHash = hash(token);
    record.pendingToken = token;
    record.resolvedAt = new Date().toISOString();
    return this.publicRecord(record);
  }

  deny(id: string): PairingRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== "pending") return null;
    record.status = "denied";
    record.resolvedAt = new Date().toISOString();
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
    }
    return result;
  }

  validateToken(token: string): boolean {
    const candidate = hash(token);
    for (const record of this.records.values()) {
      if (record.status === "approved" && !record.revokedAt && record.tokenHash && hashesMatch(record.tokenHash, candidate)) {
        record.lastUsedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  listDevices(): PairingRecord[] {
    return [...this.records.values()].filter((record) => record.status === "approved").map((record) => this.publicRecord(record));
  }

  revoke(id: string): PairingRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== "approved") return null;
    record.revokedAt = new Date().toISOString();
    record.tokenHash = null;
    record.pendingToken = null;
    return this.publicRecord(record);
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
  }

  private publicRecord(record: InternalPairingRecord): PairingRecord {
    const { pollingSecretHash: _pollingSecretHash, tokenHash: _tokenHash, pendingToken: _pendingToken, ...publicRecord } = record;
    return publicRecord;
  }
}
