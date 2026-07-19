import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../createApp.js";
import { PairingStore } from "../pairing.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

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
    }))
  };
}

describe("companion route profile isolation", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "lfa-companion-routes-"));
    process.env.LFA_DATA_DIR = dataDir;
    process.env.LFA_OWNER_TOKEN = ownerToken;
  });

  afterEach(() => {
    delete process.env.LFA_DATA_DIR;
    delete process.env.LFA_OWNER_TOKEN;
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

    expect((await request(app).post("/api/import/body-composition/preview").set(headers).send({})).status).toBe(400);
    expect((await request(app).post("/api/import/blood-test/preview").set(headers).send({})).status).toBe(400);
    expect((await request(app).get("/api/care/health-events").set(headers)).status).toBe(200);
    expect((await request(app).get("/api/care/items").set(headers)).status).toBe(200);
    expect((await request(app).post("/api/care/health-events").set(headers).send({ kind: "other", status: "completed", occurredAt: "2026-01-01T00:00:00.000Z" })).status).toBe(201);
    expect((await request(app).post("/api/care/items").set(headers).send({ title: "Follow up", kind: "follow-up", priority: "normal", status: "open" })).status).toBe(201);
    const observationInput = {
      measurementCode: "weight",
      observedAt: "2026-01-02T08:00:00.000Z",
      value: 69,
      unit: "kg"
    };
    expect((await request(app).patch("/api/observations/phone-observation").set(headers).send(observationInput)).status).toBe(200);
    expect((await request(app).delete("/api/observations/phone-observation").set(headers)).status).toBe(200);
    expect((await request(app).get("/api/settings/ai").set(headers)).status).toBe(403);
    expect((await request(app).post("/api/query/ai").set(headers).send({ question: "test" })).status).toBe(403);
    expect(assigned.listHealthEvents).toHaveBeenCalledOnce();
    expect(assigned.listCareItems).toHaveBeenCalledOnce();
    expect(assigned.createHealthEvent).toHaveBeenCalledOnce();
    expect(assigned.createCareItem).toHaveBeenCalledOnce();
    expect(assigned.updateObservation).toHaveBeenCalledWith("phone-observation", observationInput);
    expect(assigned.deleteObservation).toHaveBeenCalledWith("phone-observation");
    expect(active.updateObservation).not.toHaveBeenCalled();
    expect(active.deleteObservation).not.toHaveBeenCalled();
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
});
