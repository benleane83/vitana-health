import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { PairingStore } from "../pairing.js";
import { makeDataRoutes } from "../routes/dataRoutes.js";
import { makeProfilesRoutes } from "../routes/profileRoutes.js";
import { makeQueryRoutes } from "../routes/queryRoutes.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

function entitlement(tier: "free" | "pro") {
  return { get: () => ({ tier, source: null, overridden: false }) } as const;
}

describe("Pro feature routes", () => {
  it.each([
    ["/api/calendar?month=2026-08", "track-calendar"],
    ["/api/body-trend", "track-body-trend"]
  ])("blocks free-tier access to %s when gating is active", async (path) => {
    const app = express().use("/api", makeDataRoutes({} as ProfileStoreManager, entitlement("free"), true));
    const response = await request(app).get(path).expect(403);
    expect(response.body.code).toBe("PRO_REQUIRED");
  });

  it("blocks free-tier AI Query before executing it when gating is active", async () => {
    const getActiveStore = vi.fn();
    const app = express()
      .use(express.json())
      .use("/api/query", makeQueryRoutes({ getActiveStore } as unknown as ProfileStoreManager, entitlement("free"), true));

    const response = await request(app).post("/api/query/ai").send({ question: "How am I doing?" }).expect(403);
    expect(response.body.code).toBe("PRO_REQUIRED");
    expect(getActiveStore).not.toHaveBeenCalled();
  });

  it("blocks only additional profile creation for the free tier", async () => {
    const createProfile = vi.fn();
    const manager = {
      listProfiles: () => [{ id: "self", displayName: "Local user", updatedAt: "2026-08-01T00:00:00.000Z" }],
      createProfile
    } as unknown as ProfileStoreManager;
    const app = express()
      .use(express.json())
      .use("/api/profiles", makeProfilesRoutes(manager, {} as PairingStore, entitlement("free"), true));

    const response = await request(app).post("/api/profiles").send({ displayName: "Family" }).expect(403);
    expect(response.body.code).toBe("PRO_REQUIRED");
    expect(createProfile).not.toHaveBeenCalled();
  });

  it("allows the first free-tier profile and additional Pro profiles", async () => {
    const created = { id: "family", displayName: "Family", updatedAt: "2026-08-01T00:00:00.000Z" };
    const createProfile = vi.fn().mockResolvedValue(created);
    let profiles: unknown[] = [];
    const manager = {
      listProfiles: () => profiles,
      createProfile
    } as unknown as ProfileStoreManager;
    const pairingStore = {} as PairingStore;

    const freeApp = express().use(express.json()).use("/api/profiles", makeProfilesRoutes(manager, pairingStore, entitlement("free"), true));
    await request(freeApp).post("/api/profiles").send({ displayName: "Family" }).expect(201);

    profiles = [created];
    const proApp = express().use(express.json()).use("/api/profiles", makeProfilesRoutes(manager, pairingStore, entitlement("pro"), true));
    await request(proApp).post("/api/profiles").send({ displayName: "Family" }).expect(201);
    expect(createProfile).toHaveBeenCalledTimes(2);
  });
});