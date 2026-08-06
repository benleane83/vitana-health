import { describe, expect, it } from "vitest";
import { PRO_FEATURE_GATING_ENABLED, hasFeature, healthConnectSyncWindowForTier, type ProFeature } from "./entitlement.js";

const proFeatures: ProFeature[] = [
  "extended-health-connect-history",
  "ai-query",
  "additional-profile-creation",
  "track-calendar",
  "track-body-trend"
];

describe("hasFeature", () => {
  it("keeps feature gating inactive until the Pro product is ready", () => {
    expect(PRO_FEATURE_GATING_ENABLED).toBe(false);
  });

  it.each(proFeatures)("keeps %s available to the free tier while gating is inactive", (feature) => {
    expect(hasFeature("free", feature)).toBe(true);
  });

  it.each(proFeatures)("keeps %s unavailable to the free tier when gating is active", (feature) => {
    expect(hasFeature("free", feature, true)).toBe(false);
  });

  it.each(proFeatures)("makes %s available on the Pro tier when gating is active", (feature) => {
    expect(hasFeature("pro", feature, true)).toBe(true);
  });
});

describe("healthConnectSyncWindowForTier", () => {
  it("keeps 30 days available to the free tier when gating is active", () => {
    expect(healthConnectSyncWindowForTier("free", 30, true)).toBe(30);
  });

  it("caps stale extended free-tier settings when gating is active", () => {
    expect(healthConnectSyncWindowForTier("free", 365, true)).toBe(30);
  });

  it("preserves extended history for Pro and while gating is inactive", () => {
    expect(healthConnectSyncWindowForTier("pro", 365, true)).toBe(365);
    expect(healthConnectSyncWindowForTier("free", 365)).toBe(365);
  });
});