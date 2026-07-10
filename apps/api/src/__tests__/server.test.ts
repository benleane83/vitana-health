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

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lfa-server-test-"));
  process.env.LFA_DATA_DIR = tempDir;
  process.env.LFA_SECRET = "test-secret-for-server-tests-1234";

  store = new HealthStore();
  pairingStore = new PairingStore();
  app = createApp(store, pairingStore);
});

afterEach(() => {
  delete process.env.LFA_DATA_DIR;
  delete process.env.LFA_SECRET;
  rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ─── GET /api/health ──────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns ok: true with the expected shape", async () => {
    const res = await request(app).get("/api/health");
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
  it("allows request when no pairings exist (open mode)", async () => {
    const res = await request(app)
      .post("/api/import/health-connect")
      .send(minimalHealthConnectPayload);
    expect(res.status).toBe(201);
  });

  it("returns 401 when pairings exist and no token is provided", async () => {
    // Approve a pairing to activate the token gate
    const req = pairingStore.request("device-1", "Test Phone");
    pairingStore.approve(req.id);

    const res = await request(app)
      .post("/api/import/health-connect")
      .send(minimalHealthConnectPayload);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/companion token required/i);
  });

  it("accepts request when a valid companion token is provided", async () => {
    const req = pairingStore.request("device-1", "Test Phone");
    const approved = pairingStore.approve(req.id)!;
    const token = approved.token!;

    const res = await request(app)
      .post("/api/import/health-connect")
      .set("x-companion-token", token)
      .send(minimalHealthConnectPayload);
    expect(res.status).toBe(201);
  });
});

// ─── DELETE /api/observations/:id ─────────────────────────────────────────────

describe("DELETE /api/observations/:id", () => {
  it("returns 404 for a non-existent observation ID", async () => {
    const res = await request(app).delete("/api/observations/obs_nonexistent123");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 and removes the observation when ID exists", async () => {
    const csv = `date,type,value,unit\n2026-01-01,weight,82,kg`;
    const parsed = parseSamsungHealthCsv("test.csv", csv, "2026-01-01T00:00:00.000Z");
    store.mergeImport(parsed);

    const observationId = store.snapshot().observations[0]?.id;
    expect(observationId).toBeDefined();

    const res = await request(app).delete(`/api/observations/${observationId}`);
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
      .send({ fileName: "test.csv" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when 'fileName' field is missing", async () => {
    const res = await request(app)
      .post("/api/import/samsung")
      .send({ content: "date,type,value\n2026-01-01,heart_rate,72" });
    expect(res.status).toBe(400);
  });
});
