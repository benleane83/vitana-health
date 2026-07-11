import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStoreManager } from "../store.js";
import { PairingStore } from "../pairing.js";
import { createApp } from "../createApp.js";
import { buildManualLabEntryImport } from "@local-fitness-advisor/shared";

// Mock the DuckDB warehouse so tests don't need the native binary.
vi.mock("../warehouse.js", () => ({
  rebuildWarehouseFromStore: vi.fn().mockResolvedValue({ tables: [], rowCounts: {} }),
  runWarehouseQuery: vi.fn().mockResolvedValue([])
}));

let tempDir: string;
let storeManager: ProfileStoreManager;
let pairingStore: PairingStore;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
const ownerToken = "test-owner-token-for-server-tests";
const ownerAuthorization = "Bearer " + ownerToken;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lfa-server-test-"));
  process.env.LFA_DATA_DIR = tempDir;
  process.env.LFA_SECRET = "test-secret-for-server-tests-1234";
  process.env.LFA_OWNER_TOKEN = ownerToken;

  storeManager = new ProfileStoreManager();
  pairingStore = new PairingStore();
  app = createApp(storeManager, pairingStore);
});

afterEach(() => {
  delete process.env.LFA_DATA_DIR;
  delete process.env.LFA_SECRET;
  delete process.env.LFA_OWNER_TOKEN;
  rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ─── GET /api/health ──────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns ok: true with the expected shape", async () => {
    const res = await request(app).get("/api/health").set("authorization", ownerAuthorization);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    // Health endpoint intentionally does not expose internals
    expect(res.body.app).toBeUndefined();
    expect(res.body.storage).toBeUndefined();
    expect(res.body.counts).toBeUndefined();
    expect(res.body.modelRuntime).toBeUndefined();
  });

  it("returns ok: true without a credential (public liveness check)", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── Auth middleware ───────────────────────────────────────────────────────────

const minimalHealthConnectPayload = {
  syncedAt: "2026-06-01T12:00:00.000Z",
  rangeStart: "2026-05-01T00:00:00.000Z",
  rangeEnd: "2026-06-01T00:00:00.000Z",
  deviceLabel: "Test Phone",
  steps: [],
  heartRate: [],
  oxygenSaturation: [],
  hrvRmssd: [],
  weightKg: [],
  exerciseSessions: []
};

describe("POST /api/import/health-connect — auth middleware", () => {
  it("rejects an unpaired anonymous request", async () => {
    const res = await request(app)
      .post("/api/import/health-connect")
      .send(minimalHealthConnectPayload);
    expect(res.status).toBe(401);
  });

  it("allows the owner credential", async () => {
    const res = await request(app)
      .post("/api/import/health-connect")
      .set("authorization", ownerAuthorization)
      .send(minimalHealthConnectPayload);
    expect(res.status).toBe(201);
  });

  it("accepts a valid single-delivery companion token", async () => {
    const challenge = pairingStore.createChallenge();
    const requested = pairingStore.request("device-1", "Test Phone", challenge.code)!;
    pairingStore.approve(requested.record.id);
    const status = pairingStore.getStatus(requested.record.id, requested.pollingSecret)!;
    const token = status.token!;

    const res = await request(app)
      .post("/api/import/health-connect")
      .set("x-companion-token", token)
      .send(minimalHealthConnectPayload);
    expect(res.status).toBe(201);
    expect(pairingStore.getStatus(requested.record.id, requested.pollingSecret)?.token).toBeUndefined();
  });
});

describe("central owner authorization", () => {
  it("protects data and model routes", async () => {
    const paths = ["/api/store", "/api/profile", "/api/export"];
    for (const path of paths) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).post("/api/llm/simple").send({ prompt: "hello" })).status).toBe(401);
  });

  it("allows a paired companion to use non-administrative APIs", async () => {
    const challenge = pairingStore.createChallenge();
    const requested = pairingStore.request("device-api", "API Phone", challenge.code)!;
    pairingStore.approve(requested.record.id);
    const token = pairingStore.getStatus(requested.record.id, requested.pollingSecret)!.token!;

    expect((await request(app).get("/api/store").set("x-companion-token", token)).status).toBe(200);
    expect((await request(app).get("/api/pairing/devices").set("x-companion-token", token)).status).toBe(401);
  });

  it("creates an owner session only for a local client", async () => {
    const agent = request.agent(app);
    const authenticated = await agent.post("/api/auth/local");
    expect(authenticated.status).toBe(204);
    expect((await agent.get("/api/health")).status).toBe(200);
  });
});

describe("profile lifecycle routes", () => {
  it("creates, switches, and deletes profiles", async () => {
    const created = await request(app)
      .post("/api/profiles")
      .set("authorization", ownerAuthorization)
      .send({ displayName: "Shabnam" });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe("shabnam");

    const switched = await request(app)
      .put("/api/profiles/active")
      .set("authorization", ownerAuthorization)
      .send({ profileId: "shabnam" });
    expect(switched.status).toBe(200);
    expect(switched.body.profileId).toBe("shabnam");

    const saved = await request(app)
      .put("/api/profile")
      .set("authorization", ownerAuthorization)
      .send({ displayName: "Shabnam S", units: "metric" });
    expect(saved.status).toBe(200);
    expect(saved.body.id).toBe("shabnam");

    const listed = await request(app)
      .get("/api/profiles")
      .set("authorization", ownerAuthorization);
    expect(listed.status).toBe(200);
    expect(listed.body.activeProfileId).toBe("shabnam");
    expect(listed.body.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "self" }),
        expect.objectContaining({ id: "shabnam", displayName: "Shabnam S" })
      ])
    );

    const removed = await request(app)
      .delete("/api/profiles/shabnam")
      .set("authorization", ownerAuthorization);
    expect(removed.status).toBe(200);
    expect(removed.body.activeProfileId).toBe("self");
  });

  it("imports Health Connect data into the targeted profile", async () => {
    await request(app)
      .post("/api/profiles")
      .set("authorization", ownerAuthorization)
      .send({ displayName: "Shabnam" });

    const res = await request(app)
      .post("/api/import/health-connect")
      .set("authorization", ownerAuthorization)
      .send({ ...minimalHealthConnectPayload, profileId: "shabnam" });
    expect(res.status).toBe(201);
    expect(storeManager.getStore("shabnam").snapshot().sourceImports).toHaveLength(1);
    expect(storeManager.getStore("self").snapshot().sourceImports).toHaveLength(0);
  });
});

describe("companion pairing lifecycle", () => {
  it("requires a one-time code and polling secret, then supports revocation", async () => {
    const challenge = pairingStore.createChallenge();
    const pairingResponse = await request(app)
      .post("/api/pairing/request")
      .send({ deviceId: "device-2", deviceName: "Second Phone", pairingCode: challenge.code });
    expect(pairingResponse.status).toBe(201);
    expect((await request(app).post("/api/pairing/request").send({
      deviceId: "attacker",
      deviceName: "Replay",
      pairingCode: challenge.code
    })).status).toBe(401);

    const pairingId = pairingResponse.body.pairingId as string;
    const pollingSecret = pairingResponse.body.pollingSecret as string;
    expect((await request(app).get(`/api/pairing/status/${pairingId}`)).status).toBe(401);
    expect((await request(app)
      .post(`/api/pairing/approve/${pairingId}`)
      .set("authorization", ownerAuthorization)).status).toBe(200);

    const approved = await request(app)
      .get(`/api/pairing/status/${pairingId}`)
      .set("x-pairing-secret", pollingSecret);
    const companionToken = approved.body.token as string;
    expect(companionToken).toBeTruthy();
    expect((await request(app)
      .get(`/api/pairing/status/${pairingId}`)
      .set("x-pairing-secret", pollingSecret)).body.token).toBeUndefined();

    expect((await request(app)
      .post(`/api/pairing/revoke/${pairingId}`)
      .set("authorization", ownerAuthorization)).status).toBe(200);
    expect((await request(app)
      .post("/api/import/health-connect")
      .set("x-companion-token", companionToken)
      .send(minimalHealthConnectPayload)).status).toBe(401);
  });
});

// ─── DELETE /api/observations/:id ─────────────────────────────────────────────

describe("DELETE /api/observations/:id", () => {
  it("returns 404 for a non-existent observation ID", async () => {
    const res = await request(app).delete("/api/observations/obs_nonexistent123").set("authorization", ownerAuthorization);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 and removes the observation when ID exists", async () => {
    const parsed = buildManualLabEntryImport(
      {
        collectedAt: "2026-01-01T00:00:00.000Z",
        panelName: "Test panel",
        markers: [{ markerName: "Weight", value: 82, unit: "kg" }]
      },
      "2026-01-01T00:00:00.000Z"
    );
    const store = storeManager.getActiveStore();
    store.mergeImport(parsed);

    const observationId = store.snapshot().observations[0]?.id;
    expect(observationId).toBeDefined();

    const res = await request(app).delete(`/api/observations/${observationId}`).set("authorization", ownerAuthorization);
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(1);
    expect(store.snapshot().observations.find((o) => o.id === observationId)).toBeUndefined();
  });
});

// ─── Schema validation ─────────────────────────────────────────────────────────

describe("POST /api/import/blood-test — schema validation", () => {
  it("returns 400 when 'content' field is missing", async () => {
    const res = await request(app)
      .post("/api/import/blood-test")
      .set("authorization", ownerAuthorization)
      .send({ fileName: "test.csv" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when 'fileName' field is missing", async () => {
    const res = await request(app)
      .post("/api/import/blood-test")
      .set("authorization", ownerAuthorization)
      .send({ content: "date,type,value\n2026-01-01,heart_rate,72" });
    expect(res.status).toBe(400);
  });
});
