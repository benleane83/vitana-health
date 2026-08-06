import { describe, expect, it } from "vitest";
import { assertTransportSecurity } from "./transportSecurity";

describe("transport security assertion", () => {
  it("allows cleartext in a development build", () => {
    expect(() => assertTransportSecurity({ isDevelopmentBuild: true, allowCleartext: true }))
      .not.toThrow();
  });

  it("allows a release build that keeps cleartext off", () => {
    expect(() => assertTransportSecurity({ isDevelopmentBuild: false, allowCleartext: false }))
      .not.toThrow();
  });

  it("rejects a release build that left cleartext on", () => {
    expect(() => assertTransportSecurity({ isDevelopmentBuild: false, allowCleartext: true }))
      .toThrow(/release build with cleartext HTTP enabled/);
  });
});
