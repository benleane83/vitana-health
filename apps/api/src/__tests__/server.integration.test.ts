import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { PairingStore } from "../pairing.js";
import { createApp } from "../createApp.js";
import { buildManualLabEntryImport, defaultMeasurementTypes } from "@vitana/shared";
import { requirePreparedExtension } from "./support/duckdbExtension.js";

let tempDir: string;
let storeManager: ProfileStoreManager;
let pairingStore: PairingStore;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
const ownerToken = "test-owner-token-for-server-tests";
const ownerAuthorization = "Bearer " + ownerToken;

const httpfsExtensionPath = requirePreparedExtension();

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "vitana-server-test-"));
  process.env.VITANA_DATA_DIR = tempDir;
  process.env.VITANA_SECRET = "test-secret-for-server-tests-1234";
  process.env.VITANA_OWNER_TOKEN = ownerToken;

  storeManager = await ProfileStoreManager.open({
    storageBackend: "duckdb",
    duckdb: { httpfsExtensionPath, root: join(tempDir, "duckdb-storage") }
  });
  pairingStore = new PairingStore();
  app = createApp(storeManager, pairingStore, {
    assertSafeCloudModelEndpoint: async () => "openai"
  });
});

afterEach(async () => {
  await storeManager?.closeAll();
  delete process.env.VITANA_DATA_DIR;
  delete process.env.VITANA_SECRET;
  delete process.env.VITANA_OWNER_TOKEN;
  rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ─── GET /api/health ──────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it.each([
    ["anonymous", undefined],
    ["authenticated", ownerAuthorization]
  ])("returns a public liveness response for %s requests", async (_label, authorization) => {
    const pendingRequest = request(app).get("/api/health");
    const res = authorization ? await pendingRequest.set("authorization", authorization) : await pendingRequest;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body).not.toHaveProperty("app");
    expect(res.body).not.toHaveProperty("storage");
    expect(res.body).not.toHaveProperty("counts");
    expect(res.body).not.toHaveProperty("modelRuntime");
  });

  describe("GET /api/biological-age", () => {
    it("requires authentication and returns an incomplete result without profile data", async () => {
      expect((await request(app).get("/api/biological-age")).status).toBe(401);

      const response = await request(app).get("/api/biological-age").set("authorization", ownerAuthorization);
      expect(response.status).toBe(200);
      expect(response.body.models).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "phenoage-levine-2018", status: "incomplete" })])
      );
    });
  });

});

describe("query endpoint lifecycle", () => {
  it("marks the supported AI query endpoint with its lifecycle", async () => {
    const aiResponse = await request(app)
      .post("/api/query/ai")
      .set("authorization", ownerAuthorization)
      .send({ question: "x" });

    expect(aiResponse.headers["x-vitana-lifecycle"]).toBe("supported");
  });

  it("reports active DuckDB analytics storage without rebuilding data", async () => {
    const response = await request(app)
      .get("/api/analytics/storage")
      .set("authorization", ownerAuthorization);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      databasePath: "encrypted-profile:self",
      engine: "duckdb",
      counts: { imports: 0, observations: 0, samples: 0, activities: 0 }
    });
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

  describe("generic import routes", () => {
    it("imports manual observations and generic CSV data", async () => {
      const manual = await request(app)
        .post("/api/import/observations/manual")
        .set("authorization", ownerAuthorization)
        .send({
          observedAt: "2026-06-15",
          label: "Home scale",
          observations: [{ measurementName: "Weight", value: 82, unit: "kg" }]
        });
      expect(manual.status).toBe(201);
      expect(manual.body).toMatchObject({
        outcome: {
          observations: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 },
          observationGroups: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 }
        },
        import: { sourceKind: "manual-entry" }
      });
      expect(manual.body.store).toBeUndefined();

      const csv = await request(app)
        .post("/api/import/observations/csv")
        .set("authorization", ownerAuthorization)
        .send({ fileName: "observations.csv", content: "observedAt,measurement,value,unit\n2026-06-16,Body fat,21,%" });
      expect(csv.status).toBe(201);
      expect(csv.body.import).toMatchObject({ sourceKind: "observation-csv" });
      expect(csv.body.import.rawContent).toBeUndefined();
    });
  });

  it("allows the owner credential", async () => {
    const first = await request(app)
      .post("/api/import/health-connect")
      .set("authorization", ownerAuthorization)
      .send(minimalHealthConnectPayload);
    expect(first.status).toBe(201);
    expect(first.body.outcome).toMatchObject({
      sourceImport: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 },
      dataSource: { attempted: 1, accepted: 1, duplicates: 0, rejected: 0 }
    });

    const repeated = await request(app)
      .post("/api/import/health-connect")
      .set("authorization", ownerAuthorization)
      .send(minimalHealthConnectPayload);
    expect(repeated.status).toBe(201);
    expect(repeated.body.outcome).toMatchObject({
      sourceImport: { attempted: 1, accepted: 0, duplicates: 1, rejected: 0 },
      dataSource: { attempted: 1, accepted: 0, duplicates: 1, rejected: 0 }
    });
  });

  it("accepts a valid single-delivery companion token", async () => {
    const challenge = pairingStore.createChallenge();
    const requested = pairingStore.request("device-1", "Test Phone", challenge.code)!;
    pairingStore.approve(requested.record.id, "self");
    const status = pairingStore.getStatus(requested.record.id, requested.pollingSecret)!;
    const token = status.token!;

    const res = await request(app)
      .post("/api/import/health-connect")
      .set("x-companion-token", token)
      .send({ ...minimalHealthConnectPayload, profileId: "self" });
    expect(res.status).toBe(201);
    expect(pairingStore.getStatus(requested.record.id, requested.pollingSecret)?.token).toBeUndefined();
  });
});

describe("central owner authorization", () => {
  it("protects data and model routes", async () => {
    const paths = ["/api/profile", "/api/export"];
    for (const path of paths) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).post("/api/llm/simple").send({ prompt: "hello" })).status).toBe(401);
  });

  describe("AI settings routes", () => {
    it("saves model settings without exposing the API key", async () => {
      const saved = await request(app)
        .put("/api/settings/ai")
        .set("authorization", ownerAuthorization)
        .send({
          provider: "openai",
          endpoint: "https://api.openai.com/v1/chat/completions",
          apiKey: "test-api-key",
          model: "test-model",
          timeoutMs: 30000
        });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({
        provider: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        model: "test-model",
        hasApiKey: true
      });
      expect(saved.text).not.toContain("test-api-key");

      const current = await request(app).get("/api/settings/ai").set("authorization", ownerAuthorization);
      expect(current.status).toBe(200);
      expect(current.body.hasApiKey).toBe(true);
      expect(current.text).not.toContain("test-api-key");
    });

    it("requires a new API key when the cloud endpoint origin changes", async () => {
      const initial = await request(app)
        .put("/api/settings/ai")
        .set("authorization", ownerAuthorization)
        .send({
          provider: "openai",
          endpoint: "https://openrouter.ai/api/v1/chat/completions",
          apiKey: "openrouter-key",
          model: "openrouter/free",
          timeoutMs: 30000
        });
      expect(initial.status).toBe(200);

      const changedWithoutKey = await request(app)
        .put("/api/settings/ai")
        .set("authorization", ownerAuthorization)
        .send({
          provider: "openai",
          endpoint: "https://api.openai.com/v1/responses",
          model: "gpt-5.4-mini",
          timeoutMs: 30000
        });
      expect(changedWithoutKey.status).toBe(400);
      expect(changedWithoutKey.body.error).toContain("Enter the API key again");

      const changedWithKey = await request(app)
        .put("/api/settings/ai")
        .set("authorization", ownerAuthorization)
        .send({
          provider: "openai",
          endpoint: "https://api.openai.com/v1/responses",
          apiKey: "new-openai-key",
          model: "gpt-5.4-mini",
          timeoutMs: 30000
        });
      expect(changedWithKey.status).toBe(200);
    });

    it("rejects unsupported and private model endpoints", async () => {
      for (const [provider, endpoint] of [
        ["openai", "https://attacker.example/v1/chat/completions"],
        ["openai", "http://169.254.169.254/latest/meta-data"],
        ["ollama", "http://192.168.1.20:11434/api/generate"]
      ]) {
        const response = await request(app)
          .put("/api/settings/ai")
          .set("authorization", ownerAuthorization)
          .send({ provider, endpoint, model: "test-model", timeoutMs: 30000 });
        expect(response.status).toBe(400);
      }
    });

    it("completes the OpenRouter callback without an owner cookie and consumes its state", async () => {
      const exchange = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ key: "openrouter-test-key" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

      const connect = await request(app)
        .get("/api/settings/ai/openrouter/connect")
        .set("authorization", ownerAuthorization);
      expect(connect.status).toBe(302);

      const authorizationUrl = new URL(connect.headers.location);
      const state = authorizationUrl.searchParams.get("state");
      expect(state).toBeTruthy();
      expect(authorizationUrl.searchParams.get("callback_url")).toBe("http://127.0.0.1:4317/api/settings/ai/openrouter/callback");

      const callbackPath = `/api/settings/ai/openrouter/callback?code=test-code&state=${encodeURIComponent(state!)}`;
      const callback = await request(app).get(callbackPath);
      expect(callback.status).toBe(200);
      expect(callback.text).toContain("OpenRouter connected");
      expect(exchange).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/auth/keys",
        expect.objectContaining({ method: "POST", redirect: "manual", body: JSON.stringify({ code: "test-code" }) })
      );

      const current = await request(app).get("/api/settings/ai").set("authorization", ownerAuthorization);
      expect(current.body).toMatchObject({
        provider: "openai",
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        hasApiKey: true
      });
      expect(current.text).not.toContain("openrouter-test-key");

      const replay = await request(app).get(callbackPath);
      expect(replay.status).toBe(400);
      expect(exchange).toHaveBeenCalledTimes(1);
    });
  });

  it("limits a paired companion to explicit capabilities", async () => {
    const challenge = pairingStore.createChallenge();
    const requested = pairingStore.request("device-api", "API Phone", challenge.code)!;
    pairingStore.approve(requested.record.id, "self");
    const token = pairingStore.getStatus(requested.record.id, requested.pollingSecret)!.token!;

    const denied = [
      ["/api/profile", "get"], ["/api/export", "get"], ["/api/pairing/devices", "get"],
      ["/api/settings/ai", "get"], ["/api/settings/ai", "put"], ["/api/query/ai", "post"],
      ["/api/profile/measurement-types/reset", "post"]
    ] as const;
    for (const [path, method] of denied) {
      expect((await request(app)[method](path).set("x-companion-token", token).send({})).status).toBe(403);
    }
    const profiles = await request(app).get("/api/profiles").set("x-companion-token", token);
    expect(profiles.status).toBe(200);
    expect(profiles.body).toEqual({ profiles: [{ id: "self", displayName: "Local user" }] });
    expect((await request(app)
      .post("/api/import/health-connect")
      .set("x-companion-token", token)
      .send({ ...minimalHealthConnectPayload, profileId: "self" })).status).toBe(201);
    expect((await request(app)
      .post("/api/import/health-connect")
      .set("x-companion-token", token)
      .send({ ...minimalHealthConnectPayload, profileId: "other" })).status).toBe(403);
    expect((await request(app)
      .delete("/api/observations/missing")
      .set("x-companion-token", token)).status).toBe(404);
  });

  it("isolates companion reads and imports from the PC active profile", async () => {
    await request(app)
      .post("/api/profiles")
      .set("authorization", ownerAuthorization)
      .send({ displayName: "Phone Profile" });

    const challenge = pairingStore.createChallenge();
    const requested = pairingStore.request("assigned-phone", "Assigned Phone", challenge.code)!;
    pairingStore.approve(requested.record.id, "phone-profile");
    const token = pairingStore.getStatus(requested.record.id, requested.pollingSecret)!.token!;
    const companion = { "x-companion-token": token };

    const manual = await request(app)
      .post("/api/import/observations/manual")
      .set(companion)
      .send({
        profileId: "self",
        observedAt: "2026-07-01T08:00:00.000Z",
        label: "Mobile entry",
        observations: [{ measurementCode: "weight", value: 72, unit: "kg" }]
      });
    expect(manual.status).toBe(201);
    expect((await storeManager.getStore("phone-profile").storageCounts()).observations).toBe(1);
    expect((await storeManager.getStore("self").storageCounts()).observations).toBe(0);

    const bootstrap = await request(app).get("/api/bootstrap?profileId=self").set(companion);
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.profile).toMatchObject({ id: "phone-profile", displayName: "Phone Profile" });
    expect(bootstrap.body.counts.observations).toBe(1);

    const analytics = await request(app).get("/api/analytics?profileId=self").set(companion);
    expect(analytics.status).toBe(200);
    expect(analytics.body.counts.observations).toBe(1);

    const summary = await request(app).get("/api/summary?profileId=self").set(companion);
    expect(summary.status).toBe(200);
    expect(summary.body.totals.observations).toBe(1);

    const detail = await request(app).get("/api/summary/weight?profileId=self&limit=1").set(companion);
    expect(detail.status).toBe(200);
    expect(detail.body.entries).toHaveLength(1);
    expect(detail.body.entries[0]).toMatchObject({ measurementCode: "weight", value: 72 });

    const companionPin = await request(app).put("/api/summary/weight/pin?profileId=self").set(companion);
    expect(companionPin.status).toBe(403);

    const pinned = await request(app).put("/api/summary/weight/pin").set("authorization", ownerAuthorization);
    expect(pinned.status).toBe(200);
    expect(pinned.body).toMatchObject({ measurementCode: "weight", isPinned: true });
    expect((await request(app).get("/api/summary/weight").set("authorization", ownerAuthorization)).body.isPinned).toBe(true);
    expect((await storeManager.getStore("self").exportData()).pinnedMeasurements[0]).toMatchObject({ measurementCode: "weight" });
    expect((await storeManager.getStore("phone-profile").exportData()).pinnedMeasurements).toEqual([]);

    const unpinned = await request(app).delete("/api/summary/weight/pin").set("authorization", ownerAuthorization);
    expect(unpinned.status).toBe(200);
    expect(unpinned.body).toEqual({ measurementCode: "weight", isPinned: false });

    const commit = await request(app)
      .post("/api/import/body-composition/commit")
      .set(companion)
      .send({
        profileId: "self",
        fileName: "mobile-report.jpg",
        reportDate: "2026-07-02",
        rows: [{
          id: "body-fat",
          label: "Body fat",
          measurementCode: "body_fat_percentage",
          displayName: "Body fat",
          value: 20,
          unit: "%",
          confidence: "high",
          included: true
        }]
      });
    expect(commit.status).toBe(201);
    expect((await storeManager.getStore("phone-profile").storageCounts()).observations).toBe(2);
    expect((await storeManager.getStore("self").storageCounts()).observations).toBe(0);

    for (const [path, method] of [
      ["/api/profile", "put"],
      ["/api/insights/generate", "post"],
      ["/api/export", "get"],
      ["/api/settings/ai", "get"],
      ["/api/query/ai", "post"]
    ] as const) {
      expect((await request(app)[method](path).set(companion).send({ profileId: "phone-profile" })).status).toBe(403);
    }
    expect((await request(app)
      .delete("/api/observations/missing")
      .set(companion)).status).toBe(404);
  });

  it("creates an owner session only for a local client", async () => {
    const agent = request.agent(app);
    const authenticated = await agent.post("/api/auth/local");
    expect(authenticated.status).toBe(204);
    expect((await agent.get("/api/health")).status).toBe(200);
  });
});

describe("GET /api/export/pdf", () => {
  it("requires authentication and returns a PDF for an empty profile", async () => {
    expect((await request(app).get("/api/export/pdf")).status).toBe(401);

    const report = await request(app).get("/api/export/pdf").set("authorization", ownerAuthorization);
    expect(report.status).toBe(200);
    expect(report.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(report.headers["content-disposition"]).toMatch(/attachment; filename="local-user-health-report\.pdf"/);
    expect(Buffer.isBuffer(report.body)).toBe(true);
    expect(report.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("exports only the active profile and uses its safe display name in the filename", async () => {
    await request(app)
      .post("/api/profiles")
      .set("authorization", ownerAuthorization)
      .send({ displayName: "Second Profile" });
    await request(app)
      .put("/api/profiles/active")
      .set("authorization", ownerAuthorization)
      .send({ profileId: "second-profile" });
    const saved = await request(app)
      .put("/api/profile")
      .set("authorization", ownerAuthorization)
      .send({ displayName: "Doctor / Test", units: "metric" });
    expect(saved.status).toBe(200);

    const report = await request(app).get("/api/export/pdf").set("authorization", ownerAuthorization);
    expect(report.status).toBe(200);
    expect(report.headers["content-disposition"]).toMatch(/doctor-test-health-report\.pdf/);
  });
});

describe("profile lifecycle routes", () => {
  it("resets measurement metadata for the active profile", async () => {
    const response = await request(app)
      .post("/api/profile/measurement-types/reset")
      .set("authorization", ownerAuthorization);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ profileId: "self" }));
    expect(response.body.refreshed + response.body.inserted).toBe(defaultMeasurementTypes.length);
  });

  it.each([
    { subjectKind: "adult", birthDate: "2099-01-01", heightCm: 170 },
    { subjectKind: "adult", birthDate: "2015-01-01", heightCm: 170 },
    { subjectKind: "child", birthDate: "1990-01-01", heightCm: 120 },
    { subjectKind: "adult", heightCm: 1 },
    { subjectKind: "pet", pet: { species: "cat" }, heightCm: 1 }
  ])("rejects implausible profile attributes: $subjectKind $birthDate $heightCm", async (attributes) => {
    const response = await request(app)
      .put("/api/profile")
      .set("authorization", ownerAuthorization)
      .send({ displayName: "Invalid profile", units: "metric", ...attributes });

    expect(response.status).toBe(400);
  });

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
    expect((await storeManager.getStore("shabnam").storageCounts()).imports).toBe(1);
    expect((await storeManager.getStore("self").storageCounts()).imports).toBe(0);
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
      .set("authorization", ownerAuthorization)
      .send({ profileId: "self" })).status).toBe(200);

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
      .send({ ...minimalHealthConnectPayload, profileId: "self" })).status).toBe(401);
  });

  it("revokes only the authenticated companion device", async () => {
    const challenge = pairingStore.createChallenge();
    const requested = pairingStore.request("device-self-revoke", "Phone", challenge.code)!;
    pairingStore.approve(requested.record.id, "self");
    const token = pairingStore.getStatus(requested.record.id, requested.pollingSecret)!.token!;
    expect((await request(app).post("/api/pairing/revoke-self").set("x-companion-token", token)).status).toBe(200);
    expect((await request(app).get("/api/profiles").set("x-companion-token", token)).status).toBe(401);
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
    await store.mergeImport(parsed);

    const observationId = parsed.observations[0]?.id;
    expect(observationId).toBeDefined();

    const res = await request(app).delete(`/api/observations/${observationId}`).set("authorization", ownerAuthorization);
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(1);
    expect((await store.storageCounts()).observations).toBe(0);
  });
});

describe("PATCH /api/observations/:id", () => {
  it("returns 404 for a non-existent observation ID", async () => {
    const res = await request(app)
      .patch("/api/observations/obs_nonexistent123")
      .set("authorization", ownerAuthorization)
      .send({ measurementCode: "glucose", observedAt: "2026-02-03T10:30:00.000Z", value: 5.2, unit: "mmol/L" });
    expect(res.status).toBe(404);
  });

  it("updates editable fields while preserving observation provenance", async () => {
    const parsed = buildManualLabEntryImport(
      {
        collectedAt: "2026-01-01T00:00:00.000Z",
        panelName: "Test panel",
        markers: [{ markerName: "Glucose", value: 5.2, unit: "mmol/L" }]
      },
      "2026-01-01T00:00:00.000Z"
    );
    const store = storeManager.getActiveStore();
    await store.mergeImport(parsed);
    const before = parsed.observations[0];
    expect(before).toBeDefined();

    const res = await request(app)
      .patch(`/api/observations/${before!.id}`)
      .set("authorization", ownerAuthorization)
      .send({
        measurementCode: "creatinine",
        observedAt: "2026-02-03T10:30:00.000Z",
        value: 61.4,
        unit: "µmol/L",
        note: "Corrected from source report"
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.updatedObservation).toMatchObject({
      id: before!.id,
      measurementCode: "creatinine",
      observedAt: "2026-02-03T10:30:00.000Z",
      value: 61.4,
      unit: "µmol/L",
      note: "Corrected from source report",
      sourceId: before!.sourceId,
      observationGroupId: before!.observationGroupId
    });
    expect(res.body.updatedObservation.sourceJson).toEqual(before!.sourceJson);
  });
});

// ─── Schema validation ─────────────────────────────────────────────────────────

describe("POST /api/import/blood-test — schema validation", () => {
  it("accepts Lab results preview payloads larger than the global JSON limit", async () => {
    const res = await request(app)
      .post("/api/import/blood-test/preview")
      .set("authorization", ownerAuthorization)
      .send({ fileName: "large.pdf", mimeType: "invalid", contentBase64: "A".repeat(1_100_000) });
    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe("PAYLOAD_TOO_LARGE");
  });

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
