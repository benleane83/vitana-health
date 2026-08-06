import { describe, expect, it } from "vitest";
import { companionDeviceName } from "./deviceName";

describe("companion device name", () => {
  it("uses platform-specific labels for pairing", () => {
    expect(companionDeviceName("ios")).toBe("iOS Companion");
    expect(companionDeviceName("android")).toBe("Android Companion");
  });

  it("keeps the established Android label for other preview platforms", () => {
    expect(companionDeviceName("web")).toBe("Android Companion");
  });
});