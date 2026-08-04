import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { makeDataRoutes } from "../routes/dataRoutes.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

describe("calendar data route", () => {
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
