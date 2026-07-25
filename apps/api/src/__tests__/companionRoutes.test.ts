import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../createApp.js";
import { PairingStore } from "../pairing.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { CareItemCompletionConflictError } from "../storage/profileRepository.js";

const ownerToken = "test-owner-token-for-companion-routes";
let dataDir: string;

function outcome() {
  const empty = { attempted: 0, accepted: 0, duplicates: 0, evicted: 0 };
  return {
    sourceImport: empty,
    dataSource: empty,
    observations: empty,
    observationGroups: empty,
    timeSeriesSamples: empty,
    activitySessions: empty
  };
}

function store(profileId: string) {
  return {
    profileId,
    appBootstrap: vi.fn(async () => ({ profile: { id: profileId }, counts: { observations: profileId === "phone" ? 1 : 0 } })),
    analyticsSummary: vi.fn(async () => ({ profileId, counts: { observations: profileId === "phone" ? 1 : 0 } })),
    summary: vi.fn(async () => ({ profileId, totals: { observations: profileId === "phone" ? 1 : 0 } })),
    measurementDetail: vi.fn(async (measurementCode: string) => ({ profileId, measurement: { code: measurementCode } })),
    listHealthEvents: vi.fn(async () => ({ items: [{ id: `${profileId}-event`, kind: "other", status: "completed", occurredAt: "2026-01-01T00:00:00.000Z", source: "manual-entry" }], total: 1, offset: 0, limit: 20, hasMore: false })),
    createHealthEvent: vi.fn(async () => ({ healthEvent: { id: `${profileId}-event`, kind: "other", status: "completed", occurredAt: "2026-01-01T00:00:00.000Z", source: "manual-entry" }, counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 1, careItems: 0 } })),
    deleteHealthEvent: vi.fn(async () => ({ deletedCount: 1, counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 0 } })),
    listCareItems: vi.fn(async () => ({ items: [{ id: `${profileId}-care`, title: "Follow up", kind: "follow-up", priority: "normal", status: "open" }], total: 1, offset: 0, limit: 20, hasMore: false })),
    createCareItem: vi.fn(async () => ({ careItem: { id: `${profileId}-care`, title: "Follow up", kind: "follow-up", priority: "normal", status: "open" }, counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 1 } })),
    completeCareItem: vi.fn(async () => ({
      careItem: { id: `${profileId}-care`, title: "Follow up", kind: "follow-up", priority: "normal", status: "completed", completedAt: "2026-01-02T00:00:00.000Z", completedHealthEventId: `${profileId}-completed-event` },
      healthEvent: { id: `${profileId}-completed-event`, kind: "visit", status: "completed", occurredAt: "2026-01-02T00:00:00.000Z", source: "manual-entry" },
      counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 1, careItems: 1 }
    })),
    deleteCareItem: vi.fn(async () => ({ deletedCount: 1, counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 0 } })),
    updateObservation: vi.fn(async (id: string, input: object) => ({
      updatedObservation: { id, ...input, sourceId: "manual" },
      counts: { imports: 1, observations: 1, samples: 0, activities: 0, healthEvents: 0, careItems: 0 }
    })),
    deleteObservation: vi.fn(async () => ({
      deletedCount: 1,
      counts: { imports: 1, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 0 }
    })),
    mergeImport: vi.fn(async () => ({
      outcome: outcome(),
      counts: { imports: 1, observations: 1, samples: 0, activities: 0 }
    })),
    startMobileMigration: vi.fn(async () => ({
      sessionId: "migration-1",
      destinationProfileId: profileId,
      processedBatchIds: [],
      completed: false
    })),
    applyMobileMigrationBatch: vi.fn(async (_pairingId: string, batch: { sessionId: string; batchId: string }) => ({
      sessionId: batch.sessionId,
      batchId: batch.batchId,
      counts: { accepted: 0, duplicates: 0, conflicts: 0 },
      duplicates: [],
      conflicts: []
    })),
    completeMobileMigration: vi.fn(async () => ({
      receiptId: "receipt-1",
      sessionId: "migration-1",
      pairingId: "pairing-1",
      destinationProfileId: profileId,
      datasetFingerprint: "standalone:phone",
      completedAt: "2026-07-25T00:00:00.000Z",
      counts: { accepted: 0, duplicates: 0, conflicts: 0 }
    })),
    getReplicaHighWaterMark: vi.fn(async () => ({ revision: 2, sequence: 4 })),
    startReplicaSnapshot: vi.fn(async () => "snapshot-1"),
    replicaSnapshotPage: vi.fn(async () => ({
      changes: [{
        revision: 2,
        sequence: 0,
        entityType: "profile",
        entityId: profileId,
        operation: "upsert",
        payload: { id: profileId }
      }],
      highWaterMark: { revision: 2, sequence: 4 }
    })),
    replicaDeltaPage: vi.fn(async () => ({
      changes: [],
      highWaterMark: { revision: 2, sequence: 4 }
    }))
  };
}

describe("companion route profile isolation", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vitana-companion-routes-"));
    process.env.VITANA_DATA_DIR = dataDir;
    process.env.VITANA_OWNER_TOKEN = ownerToken;
  });

  afterEach(() => {
    delete process.env.VITANA_DATA_DIR;
    delete process.env.VITANA_OWNER_TOKEN;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("routes companion reads and imports only to the assigned store", async () => {
    const active = store("active");
    const assigned = store("phone");
    const manager = {
      getActiveProfileId: () => "active",
      getActiveStore: () => active,
      getStore: (profileId: string) => profileId === "phone" ? assigned : active,
      listProfiles: () => [
        { id: "active", displayName: "PC Active", updatedAt: "" },
        { id: "phone", displayName: "Phone", updatedAt: "" }
      ]
    } as unknown as ProfileStoreManager;
    const pairings = new PairingStore();
    const challenge = pairings.createChallenge();
    const pairing = pairings.request("phone", "Phone", challenge.code)!;
    pairings.approve(pairing.record.id, "phone");
    const token = pairings.getStatus(pairing.record.id, pairing.pollingSecret)!.token!;
    const app = createApp(manager, pairings);
    const headers = { "x-companion-token": token };

    for (const path of ["/api/bootstrap", "/api/analytics", "/api/summary", "/api/summary/weight"]) {
      const response = await request(app).get(`${path}?profileId=active`).set(headers);
      expect(response.status).toBe(200);
      expect(response.body.profileId ?? response.body.profile?.id).not.toBe("active");
    }
    expect(assigned.appBootstrap).toHaveBeenCalledOnce();
    expect(assigned.analyticsSummary).toHaveBeenCalledOnce();
    expect(assigned.summary).toHaveBeenCalledOnce();
    expect(assigned.measurementDetail).toHaveBeenCalledWith("weight", { limit: 100, offset: 0 });
    expect(active.appBootstrap).not.toHaveBeenCalled();

    const manual = await request(app)
      .post("/api/import/observations/manual")
      .set(headers)
      .send({
        profileId: "active",
        observedAt: "2026-01-01",
        label: "Body",
        observations: [{ measurementCode: "weight", value: 70, unit: "kg" }]
      });

    expect(manual.status).toBe(201);

    const commit = await request(app)
      .post("/api/import/body-composition/commit")
      .set(headers)
      .send({
        profileId: "active",
        fileName: "report.jpg",
        rows: [{
          id: "weight",
          label: "Weight",
          measurementCode: "weight",
          displayName: "Weight",
          value: 70,
          unit: "kg",
          confidence: "high",
          included: true
        }]
      });
    expect(commit.status).toBe(201);
    expect(assigned.mergeImport).toHaveBeenCalledTimes(2);
    expect(active.mergeImport).not.toHaveBeenCalled();

    const migration = await request(app)
      .post("/api/companion/migrations")
      .set(headers)
      .send({
        manifest: {
          protocolVersion: 1,
          datasetId: "phone-local",
          datasetFingerprint: "standalone:phone",
          sourceProfileId: "active",
          counts: { sourceImports: 0, dataSources: 0, observationGroups: 0, observations: 0 }
        }
      });
    expect(migration.status).toBe(201);
    expect(migration.body.destinationProfileId).toBe("phone");
    expect(assigned.startMobileMigration).toHaveBeenCalledWith(
      pairing.record.id,
      expect.objectContaining({ sourceProfileId: "active" })
    );
    expect(active.startMobileMigration).not.toHaveBeenCalled();

    expect((await request(app).post("/api/import/body-composition/preview").set(headers).send({})).status).toBe(400);
    expect((await request(app).post("/api/import/blood-test/preview").set(headers).send({})).status).toBe(400);
    expect((await request(app).get("/api/care/health-events").set(headers)).status).toBe(200);
    expect((await request(app).get("/api/care/items").set(headers)).status).toBe(200);
    expect((await request(app).post("/api/care/health-events").set(headers).send({ kind: "other", status: "completed", occurredAt: "2026-01-01T00:00:00.000Z" })).status).toBe(201);
    expect((await request(app).post("/api/care/items").set(headers).send({ title: "Follow up", kind: "follow-up", priority: "normal", status: "open" })).status).toBe(201);
    expect((await request(app).post("/api/care/items/phone-care/complete").set(headers).send({ occurredAt: "2026-01-02T00:00:00.000Z", kind: "visit" })).status).toBe(200);
    const observationInput = {
      measurementCode: "weight",
      observedAt: "2026-01-02T08:00:00.000Z",
      value: 69,
      unit: "kg"
    };
    expect((await request(app).patch("/api/observations/phone-observation").set(headers).send(observationInput)).status).toBe(200);
    expect((await request(app).delete("/api/observations/phone-observation").set(headers)).status).toBe(200);
    expect((await request(app).get("/api/settings/ai").set(headers)).status).toBe(403);
    expect((await request(app).get("/api/settings/desktop").set(headers)).status).toBe(403);
    expect((await request(app).put("/api/settings/desktop").set(headers).send({ backgroundServiceEnabled: true })).status).toBe(403);
    expect((await request(app).get("/api/settings/updates").set(headers)).status).toBe(403);
    expect((await request(app).post("/api/settings/updates/check").set(headers)).status).toBe(403);
    expect((await request(app).post("/api/settings/updates/download").set(headers)).status).toBe(403);
    expect((await request(app).post("/api/settings/updates/restart").set(headers)).status).toBe(403);
    expect((await request(app).post("/api/query/ai").set(headers).send({ question: "test" })).status).toBe(403);
    expect(assigned.listHealthEvents).toHaveBeenCalledOnce();
    expect(assigned.listCareItems).toHaveBeenCalledOnce();
    expect(assigned.createHealthEvent).toHaveBeenCalledOnce();
    expect(assigned.createCareItem).toHaveBeenCalledOnce();
    expect(assigned.completeCareItem).toHaveBeenCalledWith("phone-care", { occurredAt: "2026-01-02T00:00:00.000Z", kind: "visit" });
    expect(assigned.updateObservation).toHaveBeenCalledWith("phone-observation", observationInput);
    expect(assigned.deleteObservation).toHaveBeenCalledWith("phone-observation");
    expect(active.updateObservation).not.toHaveBeenCalled();
    expect(active.deleteObservation).not.toHaveBeenCalled();
  });

  it("binds replica handshake, snapshot, and deltas to the authenticated pairing and assigned profile", async () => {
    const active = store("active");
    const assigned = store("phone");
    const manager = {
      getActiveStore: () => active,
      getStore: (profileId: string) => profileId === "phone" ? assigned : active,
      listProfiles: () => [{ id: "active" }, { id: "phone" }]
    } as unknown as ProfileStoreManager;
    const pairings = new PairingStore();
    const challenge = pairings.createChallenge();
    const pairing = pairings.request("phone", "Phone", challenge.code)!;
    pairings.approve(pairing.record.id, "phone");
    const token = pairings.getStatus(pairing.record.id, pairing.pollingSecret)!.token!;
    const app = createApp(manager, pairings);
    const headers = { "x-companion-token": token };

    const handshake = await request(app).get("/api/companion/sync/handshake?profileId=active").set(headers);
    expect(handshake.status).toBe(200);
    expect(handshake.body).toMatchObject({
      protocolVersion: 1,
      serverInstanceId: pairings.getServerInstanceId(),
      profileId: "phone",
      pairingId: pairing.record.id,
      highWaterMark: { revision: 2, sequence: 4 }
    });

    const snapshot = await request(app).get("/api/companion/sync/snapshot?pageSize=1").set(headers);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body).toMatchObject({
      kind: "snapshot",
      profileId: "phone",
      complete: true
    });
    expect(assigned.startReplicaSnapshot).toHaveBeenCalledWith(pairing.record.id);
    expect(active.startReplicaSnapshot).not.toHaveBeenCalled();

    const deltas = await request(app).get("/api/companion/sync/deltas?afterSequence=4").set(headers);
    expect(deltas.status).toBe(200);
    expect(assigned.replicaDeltaPage).toHaveBeenCalledWith(4, undefined, 250);
  });

  it("leaves owner reads on the active store", async () => {
    const active = store("active");
    const manager = {
      getActiveStore: () => active,
      getActiveProfileId: () => "active",
      listProfiles: () => []
    } as unknown as ProfileStoreManager;
    const app = createApp(manager, new PairingStore());

    const response = await request(app)
      .get("/api/bootstrap")
      .set("authorization", "Bearer " + ownerToken);
    expect(response.status).toBe(200);
    expect(active.appBootstrap).toHaveBeenCalledOnce();
  });

  it("maps missing and non-open care completion consistently", async () => {
    const active = store("active");
    const manager = {
      getActiveStore: () => active,
      getActiveProfileId: () => "active",
      listProfiles: () => []
    } as unknown as ProfileStoreManager;
    const app = createApp(manager, new PairingStore());
    const headers = { authorization: `Bearer ${ownerToken}` };
    const input = { occurredAt: "2026-01-02T00:00:00.000Z", kind: "visit" };

    active.completeCareItem.mockResolvedValueOnce(undefined as never);
    const missing = await request(app).post("/api/care/items/missing/complete").set(headers).send(input);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("CARE_ITEM_NOT_FOUND");

    active.completeCareItem.mockRejectedValueOnce(new CareItemCompletionConflictError());
    const conflict = await request(app).post("/api/care/items/active-care/complete").set(headers).send(input);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("CARE_ITEM_NOT_OPEN");
  });
});
