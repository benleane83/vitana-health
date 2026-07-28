import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PairingStore } from "../pairing.js";

let dataDir: string;
let stores: PairingStore[];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "vitana-pairing-test-"));
  process.env.VITANA_DATA_DIR = dataDir;
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.flushPendingWrites();
  delete process.env.VITANA_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

function approvedPairing(store: PairingStore, deviceId = "device-1", profileId = "self") {
  const challenge = store.createChallenge();
  const request = store.request(deviceId, "Phone", challenge.code)!;
  store.approve(request.record.id, profileId);
  return { request, token: store.getStatus(request.record.id, request.pollingSecret)!.token! };
}

describe("PairingStore authorization grants", () => {
  it("resolves a token to its persisted device and profile grant", () => {
    const store = new PairingStore();
    stores.push(store);
    const { token, request } = approvedPairing(store, "phone-a", "profile-a");

    expect(store.validateToken(token)).toMatchObject({
      pairingId: request.record.id,
      deviceId: "phone-a",
      allowedProfileIds: ["profile-a"],
      capabilities: [
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
        "pairing:self-revoke"
      ]
    });
    const reloaded = new PairingStore();
    stores.push(reloaded);
    expect(reloaded.validateToken(token)?.allowedProfileIds).toEqual(["profile-a"]);
  });

  it("rejects legacy pairing records without versioned grants", () => {
    writeFileSync(join(dataDir, "paired-devices.json"), JSON.stringify([{
      id: "legacy", deviceId: "old-phone", deviceName: "Old phone", status: "approved",
      requestedAt: "", expiresAt: "", resolvedAt: "", lastUsedAt: null, revokedAt: null,
      tokenDelivered: true, tokenHash: "a".repeat(64), pollingSecretHash: "b".repeat(64)
    }]));

    expect(new PairingStore().listDevices()).toEqual([]);
  });

  it("rejects tokens issued under the previous authorization schema", () => {
    const store = new PairingStore();
    stores.push(store);
    approvedPairing(store);
    const path = join(dataDir, "paired-devices.json");
    const records = JSON.parse(readFileSync(path, "utf8"));
    records[0].authorizationSchemaVersion = 1;
    writeFileSync(path, JSON.stringify(records));

    expect(new PairingStore().listDevices()).toEqual([]);
  });

  it("revokes the previous token when the same device is paired again", () => {
    const store = new PairingStore();
    stores.push(store);
    const first = approvedPairing(store, "phone-a", "self");
    const second = approvedPairing(store, "phone-a", "other");

    expect(store.validateToken(first.token)).toBeNull();
    expect(store.validateToken(second.token)?.allowedProfileIds).toEqual(["other"]);
  });

  it("lists connected devices before revoked devices, with latest revocation first", () => {
    vi.useFakeTimers();
    try {
      const store = new PairingStore();
      stores.push(store);

      vi.setSystemTime(new Date("2026-07-22T10:00:00.000Z"));
      const firstRevoked = approvedPairing(store, "phone-a");
      store.revoke(firstRevoked.request.record.id);

      vi.setSystemTime(new Date("2026-07-23T10:00:00.000Z"));
      const secondRevoked = approvedPairing(store, "phone-b");
      store.revoke(secondRevoked.request.record.id);

      vi.setSystemTime(new Date("2026-07-24T10:00:00.000Z"));
      const active = approvedPairing(store, "phone-c");

      expect(store.listDevices().map((record) => record.id)).toEqual([
        active.request.record.id,
        secondRevoked.request.record.id,
        firstRevoked.request.record.id
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the persisted registry valid while coalescing usage updates", async () => {
    const store = new PairingStore();
    stores.push(store);
    const { token } = approvedPairing(store);

    expect(store.validateToken(token)).not.toBeNull();
    expect(store.validateToken(token)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const persisted = JSON.parse(readFileSync(join(dataDir, "paired-devices.json"), "utf8"));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].lastUsedAt).toEqual(expect.any(String));
    const reloaded = new PairingStore();
    stores.push(reloaded);
    expect(reloaded.validateToken(token)).not.toBeNull();
  });
});
