import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { makeDataRoutes } from "../routes/dataRoutes.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

describe("calendar data route", () => {
  it("validates a bounded Journal query and scopes it to the companion profile", async () => {
    const journal = vi.fn(async () => ({ timezone: "UTC", days: [], nextBeforeDate: "2026-07-31" }));
    const assigned = { journal };
    const storeManager = {
      getActiveStore: vi.fn(),
      getStore: vi.fn(() => assigned)
    } as unknown as ProfileStoreManager;
    const app = express();
    app.use((request, response, next) => {
      response.locals.principal = { kind: "companion", allowedProfileIds: ["assigned-profile"] };
      next();
    });
    app.use("/api", makeDataRoutes(storeManager));

    const response = await request(app).get("/api/journal?timezone=UTC&dayLimit=2&beforeDate=2026-08-01");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ timezone: "UTC", days: [], nextBeforeDate: "2026-07-31" });
    expect(storeManager.getStore).toHaveBeenCalledWith("assigned-profile");
    expect(journal).toHaveBeenCalledWith({ timezone: "UTC", dayLimit: 2, beforeDate: "2026-08-01" });
  });

  it("returns the requested page of sleep sessions", async () => {
    const sleepSessions = vi.fn(async () => ({
      generatedAt: "2026-08-03T06:05:00.000Z",
      sessions: [],
      total: 0,
      limit: 2,
      offset: 4,
      hasMore: false
    }));
    const storeManager = {
      getActiveStore: vi.fn(() => ({ sleepSessions })),
      getStore: vi.fn()
    } as unknown as ProfileStoreManager;
    const app = express();
    app.use((_request, response, next) => {
      response.locals.principal = { kind: "owner" };
      next();
    });
    app.use("/api", makeDataRoutes(storeManager));

    const response = await request(app).get("/api/sleep-sessions?limit=2&offset=4");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 0, limit: 2, offset: 4, hasMore: false });
    expect(sleepSessions).toHaveBeenCalledWith({ limit: 2, offset: 4 });
  });

  it("uses the principal-scoped store and returns the strict calendar response", async () => {
    const calendarMonth = vi.fn(async () => ({
      month: "2026-08",
      timezone: "UTC",
      measurements: [],
      events: []
    }));
    const assigned = { calendarMonth };
    const storeManager = {
      getActiveStore: vi.fn(),
      getStore: vi.fn(() => assigned)
    } as unknown as ProfileStoreManager;
    const app = express();
    app.use((request, response, next) => {
      response.locals.principal = {
        kind: "companion",
        allowedProfileIds: ["assigned-profile"]
      };
      next();
    });
    app.use("/api", makeDataRoutes(storeManager));

    const response = await request(app).get(
      "/api/calendar?month=2026-08&timezone=UTC&measurementCodes=steps%2Cweight"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      month: "2026-08",
      timezone: "UTC",
      measurements: [],
      events: []
    });
    expect(storeManager.getStore).toHaveBeenCalledWith("assigned-profile");
    expect(calendarMonth).toHaveBeenCalledWith({
      month: "2026-08",
      timezone: "UTC",
      measurementCodes: ["steps", "weight"]
    });
    expect(storeManager.getActiveStore).not.toHaveBeenCalled();
  });
});
