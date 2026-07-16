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
    expect((await request(app).delete("/api/observations/missing").set(headers)).status).toBe(403);
    expect((await request(app).get("/api/settings/ai").set(headers)).status).toBe(403);
    expect((await request(app).post("/api/query/ai").set(headers).send({ question: "test" })).status).toBe(403);
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
