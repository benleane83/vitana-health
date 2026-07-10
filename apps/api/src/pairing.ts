import { randomBytes } from "node:crypto";

export interface PairingRecord {
  id: string;
  deviceId: string;
  deviceName: string;
  status: "pending" | "approved" | "denied";
  token: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

export class PairingStore {
  private records = new Map<string, PairingRecord>();

  request(deviceId: string, deviceName: string): PairingRecord {
    for (const record of this.records.values()) {
      if (record.deviceId === deviceId && record.status === "approved") {
        return record;
      }
    }
    const id = randomBytes(8).toString("hex");
    const record: PairingRecord = {
      id,
      deviceId,
      deviceName: deviceName.slice(0, 80),
      status: "pending",
      token: null,
      requestedAt: new Date().toISOString(),
      resolvedAt: null
    };
    this.records.set(id, record);
    return record;
  }

  approve(id: string): PairingRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== "pending") return null;
    const updated: PairingRecord = {
      ...record,
      status: "approved",
      token: randomBytes(32).toString("hex"),
      resolvedAt: new Date().toISOString()
    };
    this.records.set(id, updated);
    return updated;
  }

  deny(id: string): PairingRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== "pending") return null;
    const updated: PairingRecord = {
      ...record,
      status: "denied",
      resolvedAt: new Date().toISOString()
    };
    this.records.set(id, updated);
    return updated;
  }

  getPending(): PairingRecord[] {
    return [...this.records.values()].filter((r) => r.status === "pending");
  }

  getById(id: string): PairingRecord | undefined {
    return this.records.get(id);
  }

  validateToken(token: string): boolean {
    for (const record of this.records.values()) {
      if (record.status === "approved" && record.token === token) {
        return true;
      }
    }
    return false;
  }

  hasAnyApproved(): boolean {
    for (const record of this.records.values()) {
      if (record.status === "approved") return true;
    }
    return false;
  }
}
