import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  browserCors,
  browserOriginAllowlist,
  browserOriginIsAllowed
} from "../browserOriginPolicy.js";

const packagedOrigin = "https://127.0.0.1:4317";

function app() {
  const application = express();
  application.use(browserCors(new Set([packagedOrigin])));
  application.get("/api/health", (_request, response) => response.json({ ok: true }));
  return application;
}

describe("browser origin policy", () => {
  it("adds only the known Vite origins in development", () => {
    const origins = browserOriginAllowlist({}, "development");

    expect(origins).toEqual(new Set([
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ]));
    expect(origins.has("http://localhost:5174")).toBe(false);
  });

  it("allows an explicitly configured browser origin", async () => {
    const response = await request(app()).get("/api/health").set("origin", packagedOrigin);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(packagedOrigin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not grant CORS to arbitrary localhost ports", async () => {
    const response = await request(app()).get("/api/health").set("origin", "http://localhost:61234");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers allowed preflight requests with the configured origin", async () => {
    const response = await request(app())
      .options("/api/health")
      .set("origin", packagedOrigin)
      .set("access-control-request-method", "GET");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(packagedOrigin);
  });

  it("allows absent Origin for native clients and rejects unconfigured browser origins", () => {
    const origins = new Set([packagedOrigin]);

    expect(browserOriginIsAllowed(undefined, origins)).toBe(true);
    expect(browserOriginIsAllowed(packagedOrigin, origins)).toBe(true);
    expect(browserOriginIsAllowed("http://127.0.0.1:61234", origins)).toBe(false);
  });
});