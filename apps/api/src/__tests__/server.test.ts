import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HealthStore } from "../store.js";
import { PairingStore } from "../pairing.js";
import { createApp } from "../createApp.js";
import { parseSamsungHealthCsv } from "@local-fitness-advisor/shared";

// Mock the DuckDB warehouse so tests don't need the native binary.
vi.mock("../warehouse.js", () => ({
  rebuildWarehouseFromStore: vi.fn().mockResolvedValue({ tables: [], rowCounts: {} }),
  runWarehouseQuery: vi.fn().mockResolvedValue([])
}));

let tempDir: string;
let store: HealthStore;
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

  store = new HealthStore();
  pairingStore = new PairingStore();
  app = createApp(store, pairingStore);
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
    expect(res.body.app).toBe("local-fitness-advisor");
    expect(res.body.counts).toBeDefined();
    expect(res.body.modelRuntime).toBeDefined();
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
    const csv = `date,type,value,unit\n2026-01-01,weight,82,kg`;
    const parsed = parseSamsungHealthCsv("test.csv", csv, "2026-01-01T00:00:00.000Z");
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

describe("POST /api/import/samsung — schema validation", () => {
  it("returns 400 when 'content' field is missing", async () => {
    const res = await request(app)
      .post("/api/import/samsung")
      .set("authorization", ownerAuthorization)
      .send({ fileName: "test.csv" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when 'fileName' field is missing", async () => {
    const res = await request(app)
      .post("/api/import/samsung")
      .set("authorization", ownerAuthorization)
      .send({ content: "date,type,value\n2026-01-01,heart_rate,72" });
    expect(res.status).toBe(400);
  });
});
