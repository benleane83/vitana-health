import type { CompanionCapability } from "./pairing.js";

/**
 * Which companion capability, if any, unlocks a given `/api` route.
 *
 * Every entry names the router that registers the route so the two stay findable together, and
 * `companionRouteCapabilities.test.ts` walks the real Express router stack to prove that each
 * entry still matches a registered route and that no route has silently appeared without a
 * decision being recorded here (either a capability or a place in `desktopOnlyApiRoutes`).
 *
 * Matching is fail-closed: a route with no entry is owner-only, so an omission locks companions
 * out rather than granting them something.
 */
export interface CompanionRouteCapability {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path relative to the `/api` mount, exactly as the owning router registers it. */
  path: string | RegExp;
  capability: CompanionCapability;
  /** The router factory that registers this route. */
  router: string;
}

export const companionRouteCapabilities: readonly CompanionRouteCapability[] = [
  // makeProfilesRoutes — routes/profilesRoutes.ts
  { method: "GET", path: "/profiles", capability: "profiles:list-minimal", router: "makeProfilesRoutes" },

  // makeDataRoutes — routes/dataRoutes.ts
  { method: "GET", path: "/bootstrap", capability: "assigned-profile:read", router: "makeDataRoutes" },
  { method: "GET", path: "/analytics", capability: "assigned-profile:read", router: "makeDataRoutes" },
  { method: "GET", path: "/summary", capability: "assigned-profile:read", router: "makeDataRoutes" },
  { method: "GET", path: "/body-trend", capability: "assigned-profile:read", router: "makeDataRoutes" },
  { method: "GET", path: /^\/body-trend\/[^/]+$/, capability: "assigned-profile:read", router: "makeDataRoutes" },
  { method: "GET", path: "/calendar", capability: "assigned-profile:read", router: "makeDataRoutes" },
  { method: "GET", path: /^\/summary\/[^/]+$/, capability: "assigned-profile:read", router: "makeDataRoutes" },
  { method: "PATCH", path: /^\/observations\/[^/]+$/, capability: "observations:write", router: "makeDataRoutes" },
  { method: "DELETE", path: /^\/observations\/[^/]+$/, capability: "observations:write", router: "makeDataRoutes" },

  // makeProfileRoutes — routes/profileRoutes.ts
  { method: "GET", path: "/profile/photo", capability: "assigned-profile:read", router: "makeProfileRoutes" },

  // makeCompanionSyncRoutes — routes/companionSyncRoutes.ts
  { method: "GET", path: "/companion/sync/handshake", capability: "replica:read", router: "makeCompanionSyncRoutes" },
  { method: "GET", path: "/companion/sync/snapshot", capability: "replica:read", router: "makeCompanionSyncRoutes" },
  { method: "GET", path: "/companion/sync/deltas", capability: "replica:read", router: "makeCompanionSyncRoutes" },

  // makeCompanionMigrationRoutes — routes/companionMigrationRoutes.ts
  { method: "POST", path: "/companion/migrations", capability: "standalone:migrate", router: "makeCompanionMigrationRoutes" },
  { method: "POST", path: /^\/companion\/migrations\/[^/]+\/batches$/, capability: "standalone:migrate", router: "makeCompanionMigrationRoutes" },
  { method: "POST", path: /^\/companion\/migrations\/[^/]+\/complete$/, capability: "standalone:migrate", router: "makeCompanionMigrationRoutes" },

  // makeDataRoutes (care section) — routes/dataRoutes.ts
  { method: "GET", path: "/care/health-events", capability: "care:read", router: "makeDataRoutes" },
  { method: "GET", path: "/care/items", capability: "care:read", router: "makeDataRoutes" },
  { method: "POST", path: "/care/health-events", capability: "care:write", router: "makeDataRoutes" },
  { method: "POST", path: "/care/items", capability: "care:write", router: "makeDataRoutes" },
  { method: "PATCH", path: /^\/care\/health-events\/[^/]+$/, capability: "care:write", router: "makeDataRoutes" },
  { method: "DELETE", path: /^\/care\/health-events\/[^/]+$/, capability: "care:write", router: "makeDataRoutes" },
  { method: "PATCH", path: /^\/care\/items\/[^/]+$/, capability: "care:write", router: "makeDataRoutes" },
  { method: "DELETE", path: /^\/care\/items\/[^/]+$/, capability: "care:write", router: "makeDataRoutes" },
  { method: "POST", path: /^\/care\/items\/[^/]+\/complete$/, capability: "care:write", router: "makeDataRoutes" },

  // makeImportRoutes — routes/importRoutes.ts
  { method: "POST", path: "/import/observations/manual", capability: "observations:import-manual", router: "makeImportRoutes" },
  { method: "POST", path: "/import/body-composition/preview", capability: "reports:preview", router: "makeImportRoutes" },
  { method: "POST", path: "/import/blood-test/preview", capability: "reports:preview", router: "makeImportRoutes" },
  { method: "POST", path: "/import/body-composition/commit", capability: "reports:commit", router: "makeImportRoutes" },
  { method: "POST", path: "/import/blood-test/commit", capability: "reports:commit", router: "makeImportRoutes" },
  { method: "POST", path: "/import/health-connect", capability: "health-connect:import", router: "makeImportRoutes" },
  { method: "POST", path: "/import/health-connect/sessions", capability: "health-connect:import", router: "makeImportRoutes" },
  { method: "POST", path: /^\/import\/health-connect\/sessions\/[^/]+\/chunks$/, capability: "health-connect:import", router: "makeImportRoutes" },

  // makePairingRoutes — routes/pairingRoutes.ts, mounted at both /api/pair and /api/pairing
  { method: "POST", path: "/pairing/revoke-self", capability: "pairing:self-revoke", router: "makePairingRoutes" },
  { method: "POST", path: "/pair/revoke-self", capability: "pairing:self-revoke", router: "makePairingRoutes" }
];

export function companionCapabilityFor(method: string, path: string): CompanionCapability | null {
  for (const entry of companionRouteCapabilities) {
    if (entry.method !== method) continue;
    if (typeof entry.path === "string" ? entry.path === path : entry.path.test(path)) {
      return entry.capability;
    }
  }
  return null;
}
