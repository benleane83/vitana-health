import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { makeSettingsRoutes } from "../routes/settingsRoutes.js";

function settingsApp(desktopRuntimeController?: NonNullable<Parameters<typeof makeSettingsRoutes>[0]>["desktopRuntimeController"]) {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", makeSettingsRoutes({ desktopRuntimeController }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ code: "VALIDATION_ERROR" });
      return;
    }
    response.status(500).json({ code: "INTERNAL_ERROR" });
  });
  return app;
}

describe("desktop runtime settings routes", () => {
  it("reports unsupported hosts and rejects updates with a stable error", async () => {
    expect((await request(settingsApp()).get("/api/settings/desktop")).body).toEqual({
      supported: false,
      backgroundServiceEnabled: false
    });
    const update = await request(settingsApp()).put("/api/settings/desktop").send({ backgroundServiceEnabled: true });
    expect(update.status).toBe(501);
    expect(update.body.code).toBe("DESKTOP_RUNTIME_UNSUPPORTED");
  });

  it("delegates owner settings reads and strict updates", async () => {
    const controller = {
      getSettings: vi.fn().mockResolvedValue({ supported: true, backgroundServiceEnabled: false }),
      updateSettings: vi.fn().mockResolvedValue({ supported: true, backgroundServiceEnabled: true })
    };
    expect((await request(settingsApp(controller)).get("/api/settings/desktop")).body.backgroundServiceEnabled).toBe(false);
    const update = await request(settingsApp(controller))
      .put("/api/settings/desktop")
      .send({ backgroundServiceEnabled: true });
    expect(update.body.backgroundServiceEnabled).toBe(true);
    expect(controller.updateSettings).toHaveBeenCalledWith({ backgroundServiceEnabled: true });

    const invalid = await request(settingsApp(controller))
      .put("/api/settings/desktop")
      .send({ backgroundServiceEnabled: true, platform: "win32" });
    expect(invalid.status).toBe(400);
    expect(controller.updateSettings).toHaveBeenCalledOnce();
  });

  it("passes controller failures to the API error boundary", async () => {
    const controller = {
      getSettings: vi.fn().mockRejectedValue(new Error("failed")),
      updateSettings: vi.fn().mockRejectedValue(new Error("failed"))
    };
    expect((await request(settingsApp(controller)).get("/api/settings/desktop")).status).toBe(500);
    expect((await request(settingsApp(controller)).put("/api/settings/desktop")
      .send({ backgroundServiceEnabled: true })).status).toBe(500);
  });
});
