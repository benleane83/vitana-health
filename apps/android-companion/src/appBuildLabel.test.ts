import { describe, expect, it } from "vitest";
import { formatAppBuildLabel } from "./appBuildLabel";

describe("app build label", () => {
  it("shows the installed version and running update publication date", () => {
    expect(formatAppBuildLabel({
      version: "1.2.3",
      publishedAt: new Date("2026-07-27T23:30:00.000Z")
    })).toBe("Version 1.2.3 · Published 27 Jul 2026");
  });

  it("includes the build number so two testers on the same version are distinguishable", () => {
    expect(formatAppBuildLabel({
      version: "1.2.3",
      build: "42",
      publishedAt: new Date("2026-07-27T23:30:00.000Z")
    })).toBe("Version 1.2.3 (42) · Published 27 Jul 2026");
  });

  it("identifies local builds when update metadata is unavailable", () => {
    expect(formatAppBuildLabel({ version: null, build: null, publishedAt: null }))
      .toBe("Version development · Local build");
  });
});
