import { describe, expect, it } from "vitest";
import {
  PINNED_DUCKDB_HTTPFS_SHA256,
  SUPPORTED_HOST_PLATFORMS,
  pinnedHttpfsSha256,
  supportedHostPlatform
} from "../duckdbPin.js";

describe("duckdb host platform table", () => {
  it("has a pinned extension digest for every approved host", () => {
    // Approving a host without preparing its signed extension would fail the digest check at
    // startup rather than at review time, so the table has to stay self-consistent.
    for (const [host, platform] of Object.entries(SUPPORTED_HOST_PLATFORMS)) {
      expect(PINNED_DUCKDB_HTTPFS_SHA256[platform], `${host} has no pinned digest`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses hosts that are not in the table instead of throwing", () => {
    // The startup gate treats `undefined` as "not approved"; a throw here would surface as an
    // unhandled crash rather than the intended message.
    expect(supportedHostPlatform("linux", "x64")).toBeUndefined();
    expect(pinnedHttpfsSha256("linux", "x64")).toBeUndefined();
    expect(pinnedHttpfsSha256("plan9", "sparc")).toBeUndefined();
  });
});
