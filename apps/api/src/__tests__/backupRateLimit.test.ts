import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../createApp.js";
import { PairingStore } from "../pairing.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

const ownerToken = "test-owner-token-for-backup-rate-limits";
const ownerAuthorization = `Bearer ${ownerToken}`;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "vitana-backup-rate-limit-"));
  process.env.VITANA_DATA_DIR = dataDir;
  process.env.VITANA_OWNER_TOKEN = ownerToken;
});

afterEach(() => {
  delete process.env.VITANA_DATA_DIR;
  delete process.env.VITANA_OWNER_TOKEN;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("backup rate limits", () => {
  it("allows the full pairing status polling budget before rate limiting", async () => {
    const manager = {} as ProfileStoreManager;
    const pairings = new PairingStore();
    const app = createApp(manager, pairings);
    const challenge = pairings.createChallenge();
    const pairing = pairings.request("polling-phone", "Polling Phone", challenge.code)!;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(app)
        .get(`/api/pairing/status/${pairing.record.id}`)
        .set("x-pairing-secret", pairing.pollingSecret);
      expect(response.status).toBe(200);
    }

    const limited = await request(app)
      .get(`/api/pairing/status/${pairing.record.id}`)
      .set("x-pairing-secret", pairing.pollingSecret);
    expect(limited.status).toBe(429);
  });

  it("uses independent buckets for create, inspect, and restore", async () => {
    const manager = {} as ProfileStoreManager;
    const app = createApp(manager, new PairingStore());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post("/api/backups/create")
        .set("authorization", ownerAuthorization)
        .send({});
      expect(response.status).toBe(400);
    }

    const limitedCreate = await request(app)
      .post("/api/backups/create")
      .set("authorization", ownerAuthorization)
      .send({});
    expect(limitedCreate.status).toBe(429);

    const inspect = await request(app)
      .post("/api/backups/inspect")
      .set("authorization", ownerAuthorization);
    expect(inspect.status).toBe(400);
    expect(inspect.body.code).toBe("MULTIPART_REQUIRED");

    const restore = await request(app)
      .post("/api/backups/restore")
      .set("authorization", ownerAuthorization);
    expect(restore.status).toBe(400);
    expect(restore.body.code).toBe("MULTIPART_REQUIRED");
  });
});