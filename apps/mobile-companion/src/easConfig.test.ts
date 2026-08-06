import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const eas = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8")) as {
  build: Record<string, {
    distribution?: string;
    channel?: string;
    ios?: { simulator?: boolean; resourceClass?: string };
    env?: { VITANA_ALLOW_CLEARTEXT?: string };
  }>;
};
const packageConfig = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  expo: { autolinking: { ios: { exclude: string[] } } };
};

describe("iOS EAS profiles", () => {
  it("keeps simulator builds separate from distributable profiles", () => {
    expect(eas.build["ios-simulator"]?.ios?.simulator).toBe(true);
    expect(eas.build["ios-device-farm"]?.ios?.simulator).not.toBe(true);
    expect(eas.build.production?.ios?.simulator).not.toBe(true);
  });

  it("uses App Store distribution for the Device Farm IPA", () => {
    expect(eas.build["ios-device-farm"]?.distribution).toBe("store");
    expect(eas.build["ios-device-farm"]?.channel).toBe("preview");
  });

  it("requires HTTPS in every distributable iOS profile", () => {
    expect(eas.build["ios-device-farm"]?.env?.VITANA_ALLOW_CLEARTEXT).toBe("0");
    expect(eas.build.production?.env?.VITANA_ALLOW_CLEARTEXT).toBe("0");
  });

  it("does not introduce an ad hoc internal-device profile", () => {
    expect(eas.build).not.toHaveProperty("ios-internal");
  });

  it("keeps retained billing modules out of the iOS native project", () => {
    expect(packageConfig.expo.autolinking.ios.exclude).toEqual(expect.arrayContaining([
      "react-native-iap",
      "react-native-nitro-modules"
    ]));
  });
});