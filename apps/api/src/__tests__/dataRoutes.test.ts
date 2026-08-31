import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { makeDataRoutes } from "../routes/dataRoutes.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { ObservationGroupConflictError, ObservationGroupReadOnlyError } from "../storage/profileRepository.js";

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

  describe("observation group data routes", () => {
    const group = {
      id: "group-1",
      kind: "custom" as const,
      label: "Morning vitals",
      collectedAt: "2026-08-07T08:15:00.000Z",
      source: { kind: "manual-entry" as const, label: "Manual observations" },
      editable: true,
      observations: [{
        id: "observation-1", measurementCode: "weight", displayName: "Weight",
        observedAt: "2026-08-07T08:15:00.000Z", value: 80, unit: "kg"
      }]
    };

    function appFor(store: object) {
      const storeManager = {
        getActiveStore: vi.fn(() => store),
        getStore: vi.fn()
      } as unknown as ProfileStoreManager;
      const app = express();
      app.use((_request, response, next) => {
        response.locals.principal = { kind: "owner" };
        next();
      });
      app.use(express.json());
      app.use("/api", makeDataRoutes(storeManager));
      return app;
    }

    it("returns a strict recorded group and validates updates", async () => {
      const getObservationGroup = vi.fn(async () => group);
      const updateObservationGroup = vi.fn(async () => group);
      const app = appFor({ getObservationGroup, updateObservationGroup });
      expect((await request(app).get("/api/observation-groups/group-1")).body).toEqual(group);
      expect((await request(app).patch("/api/observation-groups/group-1").send({
        label: "", collectedAt: "not-a-date", creates: [], updates: [], removals: []
      })).status).toBe(400);
      expect(updateObservationGroup).not.toHaveBeenCalled();
    });

    it("lists groups with validated filters before matching the detail route", async () => {
      const result = {
        items: [{ id: "group-1", kind: "custom", label: "Morning vitals", measurementCount: 1 }],
        total: 1,
        offset: 0,
        limit: 10,
        hasMore: false
      };
      const listObservationGroups = vi.fn(async () => result);
      const app = appFor({ listObservationGroups });

      const response = await request(app)
        .get("/api/observation-groups?kinds=custom&dateFrom=2026-08-01&dateTo=2026-08-31&limit=10");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(result);
      expect(listObservationGroups).toHaveBeenCalledWith({
        kinds: ["custom"],
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
        limit: 10,
        offset: 0
      });
    });

    it("maps read-only and concurrent update failures explicitly", async () => {
      const input = {
        label: "Morning vitals", collectedAt: "2026-08-07T08:15:00.000Z",
        creates: [], updates: [], removals: []
      };
      const readOnly = appFor({ updateObservationGroup: vi.fn(async () => { throw new ObservationGroupReadOnlyError(); }) });
      const conflict = appFor({ updateObservationGroup: vi.fn(async () => { throw new ObservationGroupConflictError(); }) });
      expect((await request(readOnly).patch("/api/observation-groups/group-1").send(input)).body.code)
        .toBe("OBSERVATION_GROUP_READ_ONLY");
      expect((await request(conflict).patch("/api/observation-groups/group-1").send(input)).body.code)
        .toBe("OBSERVATION_GROUP_CONFLICT");
    });
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
