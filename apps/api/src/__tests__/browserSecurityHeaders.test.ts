import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../createApp.js";
import { PairingStore } from "../pairing.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

let webRoot: string;

beforeEach(() => {
  webRoot = mkdtempSync(join(tmpdir(), "vitana-web-root-"));
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Vitana</title>");
});

afterEach(() => {
  rmSync(webRoot, { recursive: true, force: true });
});

describe("static browser security headers", () => {
  it("applies the CSP and related browser protections to SPA responses", async () => {
    const app = createApp({} as ProfileStoreManager, new PairingStore(), { webRoot });

    const response = await request(app).get("/summary");

    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });
});
