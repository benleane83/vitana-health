import { describe, expect, it } from "vitest";
import type express from "express";
import { createApp } from "../createApp.js";
import { PairingStore } from "../pairing.js";
import { companionCapabilityFor } from "../companionRouteCapabilities.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";

// Only route registration is inspected here, never invoked, so a hollow manager is enough.
const stubManager = {
  getActiveProfileId: () => "self",
  listProfiles: () => []
} as unknown as ProfileStoreManager;

interface Layer {
  name: string;
  regexp: RegExp;
  handle?: { stack?: Layer[] };
  route?: { path: string; methods: Record<string, boolean> };
}

function mountPrefix(layer: Layer): string {
  const source = layer.regexp.source;
  if (source === "^\\/?$") return "";
  return source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\//g, "/");
}

/** Every `${METHOD} ${path}` the app actually serves under `/api`, with `:params` filled in. */
function registeredApiRoutes(app: express.Application): string[] {
  const routes = new Set<string>();
  const walk = (layers: Layer[], prefix: string): void => {
    for (const layer of layers) {
      if (layer.route) {
        const path = `${prefix}${layer.route.path}`.replace(/\/:[^/]+/g, "/sample").replace(/\/$/, "") || "/";
        for (const method of Object.keys(layer.route.methods)) {
          routes.add(`${method.toUpperCase()} ${path}`);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, `${prefix}${mountPrefix(layer)}`);
      }
    }
  };
  walk(((app as unknown as { _router: { stack: Layer[] } })._router).stack, "");
  // The companion auth middleware is mounted at /api, so it sees paths without that prefix.
  return [...routes]
    .filter((route) => route.includes(" /api"))
    .map((route) => route.replace(" /api", " "))
    .map((route) => (route.endsWith(" ") ? `${route}/` : route))
    .sort();
}

describe("companion route capabilities", () => {
  it("records a deliberate decision for every route the API actually registers", () => {
    const app = createApp(stubManager, new PairingStore());

    // Anything not listed is owner-only by omission, which is the fail-closed default. This
    // snapshot exists so a new router or a moved path cannot quietly change who can reach it.
    const decisions = Object.fromEntries(
      registeredApiRoutes(app).map((route) => {
        const [method, path] = route.split(" ", 2);
        return [route, companionCapabilityFor(method!, path!)];
      })
    );

    expect(decisions).toMatchSnapshot();
  });

  it("resolves the companion-reachable routes to their capability", () => {
    expect(companionCapabilityFor("GET", "/profiles")).toBe("profiles:list-minimal");
    expect(companionCapabilityFor("GET", "/sleep-sessions")).toBe("assigned-profile:read");
    expect(companionCapabilityFor("GET", "/summary/vo2max")).toBe("assigned-profile:read");
    expect(companionCapabilityFor("GET", "/calendar")).toBe("assigned-profile:read");
    expect(companionCapabilityFor("PATCH", "/care/items/care-1")).toBe("care:write");
    expect(companionCapabilityFor("POST", "/care/items/care-1/complete")).toBe("care:write");
    expect(companionCapabilityFor("GET", "/care/medications")).toBe("care:read");
    expect(companionCapabilityFor("POST", "/care/medications")).toBe("care:write");
    expect(companionCapabilityFor("PATCH", "/care/medications/medication-1")).toBe("care:write");
    expect(companionCapabilityFor("DELETE", "/care/medications/medication-1")).toBe("care:write");
    expect(companionCapabilityFor("POST", "/companion/migrations/session-1/batches")).toBe("standalone:migrate");
    expect(companionCapabilityFor("POST", "/import/health-connect/sessions")).toBe("health-connect:import");
    expect(companionCapabilityFor("POST", "/import/health-connect/sessions/session-1/chunks")).toBe("health-connect:import");
    expect(companionCapabilityFor("DELETE", "/observations/obs-1")).toBe("observations:write");
    expect(companionCapabilityFor("GET", "/entitlement")).toBe("entitlement:read");
    expect(companionCapabilityFor("POST", "/entitlement/claim")).toBe("entitlement:write");
  });

  it("does not leak access through near-miss paths or the wrong method", () => {
    expect(companionCapabilityFor("DELETE", "/profiles")).toBeNull();
    expect(companionCapabilityFor("GET", "/summary/vo2max/chart")).toBeNull();
    expect(companionCapabilityFor("PATCH", "/care/items/care-1/complete")).toBeNull();
    expect(companionCapabilityFor("GET", "/import/health-connect/sessions")).toBeNull();
    expect(companionCapabilityFor("POST", "/import/health-connect/sessions/session-1")).toBeNull();
    expect(companionCapabilityFor("GET", "/export")).toBeNull();
  });
});
