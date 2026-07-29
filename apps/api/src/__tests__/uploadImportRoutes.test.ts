import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../createApp.js";
import { PairingStore } from "../pairing.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

const ownerToken = "test-owner-token-for-upload-import-routes";
const ownerAuthorizationHeader = "Bearer " + ownerToken;
let dataDir: string;

function outcome() {
  const empty = { attempted: 0, accepted: 0, duplicates: 0, rejected: 0 };
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
    mergeImport: vi.fn(async () => ({
      outcome: outcome(),
      counts: { imports: 1, observations: 1, samples: 0, activities: 0 }
    }))
  };
}

function makeManager(active: ReturnType<typeof store>) {
  return {
    getActiveProfileId: () => active.profileId,
    getActiveStore: () => active,
    getStore: () => active,
    listProfiles: () => [{ id: active.profileId, displayName: "Active", updatedAt: "" }]
  } as unknown as ProfileStoreManager;
}

const longFormatCsv = "observedAt,measurement,value,unit\n2026-07-01T08:00:00Z,glucose,95,mg/dL";

describe("POST /api/import/upload/preview", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vitana-upload-import-routes-"));
    process.env.VITANA_DATA_DIR = dataDir;
    process.env.VITANA_OWNER_TOKEN = ownerToken;
  });

  afterEach(() => {
    delete process.env.VITANA_DATA_DIR;
    delete process.env.VITANA_OWNER_TOKEN;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("parses a long-format CSV without touching the store", async () => {
    const active = store("active");
    const app = createApp(makeManager(active), new PairingStore());
    const response = await request(app)
      .post("/api/import/upload/preview")
      .set("authorization", ownerAuthorizationHeader)
      .send({ fileName: "labs.csv", content: longFormatCsv });

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty("layout");
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].measurementCode).toBe("glucose");
    expect(active.mergeImport).not.toHaveBeenCalled();
  });

  it("rejects structured files over the 2 MB limit", async () => {
    const active = store("active");
    const app = createApp(makeManager(active), new PairingStore());
    const oversizedContent = `observedAt,measurement,value,unit\n${"2026-07-01T08:00:00Z,glucose,95,mg/dL\n".repeat(90_000)}`;
    expect(Buffer.byteLength(oversizedContent, "utf8")).toBeGreaterThan(2_000_000);

    const response = await request(app)
      .post("/api/import/upload/preview")
      .set("authorization", ownerAuthorizationHeader)
      .send({ fileName: "labs.csv", content: oversizedContent });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(active.mergeImport).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/upload/commit", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vitana-upload-import-routes-"));
    process.env.VITANA_DATA_DIR = dataDir;
    process.env.VITANA_OWNER_TOKEN = ownerToken;
  });

  afterEach(() => {
    delete process.env.VITANA_DATA_DIR;
    delete process.env.VITANA_OWNER_TOKEN;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("commits included rows to the owner's active store", async () => {
    const active = store("active");
    const app = createApp(makeManager(active), new PairingStore());
    const response = await request(app)
      .post("/api/import/upload/commit")
      .set("authorization", ownerAuthorizationHeader)
      .send({
        fileName: "labs.csv",
        rows: [{
          id: "row-1",
          label: "glucose",
          measurementCode: "glucose",
          displayName: "Glucose",
          value: 95,
          unit: "mg/dL",
          confidence: "high",
          included: true
        }]
      });

    expect(response.status).toBe(201);
    expect(response.body.import.sourceKind).toBe("structured-upload");
    expect(active.mergeImport).toHaveBeenCalledOnce();
  });

  it("rejects drafts submitted with more than the 200-row ceiling", async () => {
    const active = store("active");
    const app = createApp(makeManager(active), new PairingStore());
    const rows = Array.from({ length: 201 }, (_, index) => ({
      id: `row-${index}`,
      label: "glucose",
      measurementCode: "glucose",
      displayName: "Glucose",
      value: 95,
      unit: "mg/dL",
      confidence: "high",
      included: true
    }));

    const response = await request(app)
      .post("/api/import/upload/commit")
      .set("authorization", ownerAuthorizationHeader)
      .send({ fileName: "labs.csv", rows });

    expect(response.status).toBe(400);
    expect(active.mergeImport).not.toHaveBeenCalled();
  });

  it("rejects companion tokens — the generic upload path is owner-only", async () => {
    const active = store("phone");
    const manager = makeManager(active);
    const pairings = new PairingStore();
    const challenge = pairings.createChallenge();
    const pairing = pairings.request("phone", "Phone", challenge.code)!;
    pairings.approve(pairing.record.id, "phone");
    const token = pairings.getStatus(pairing.record.id, pairing.pollingSecret)!.token!;
    const app = createApp(manager, pairings);

    const response = await request(app)
      .post("/api/import/upload/commit")
      .set("x-companion-token", token)
      .send({
        fileName: "labs.csv",
        rows: [{
          id: "row-1",
          label: "glucose",
          measurementCode: "glucose",
          displayName: "Glucose",
          value: 95,
          unit: "mg/dL",
          confidence: "high",
          included: true
        }]
      });

    // Companion tokens have no mapped capability for this route, so the
    // shared auth middleware itself rejects it before the owner-only check runs.
    expect(response.status).toBe(403);
    expect(active.mergeImport).not.toHaveBeenCalled();
  });
});
