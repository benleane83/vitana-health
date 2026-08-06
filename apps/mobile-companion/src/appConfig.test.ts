import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../app.config.js");

function loadConfig(env: Record<string, string | undefined>): {
  expo: {
    slug: string;
    android: { usesCleartextTraffic: boolean };
    ios: {
      bundleIdentifier: string;
      entitlements?: Record<string, unknown>;
      infoPlist: {
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: boolean };
        NSLocalNetworkUsageDescription: string;
        NSCameraUsageDescription: string;
        NSPhotoLibraryUsageDescription: string;
      };
    };
    plugins: (string | [string, Record<string, unknown>])[];
    runtimeVersion: unknown;
    updates: { url: string };
    extra: { allowCleartext: boolean; eas: { projectId: string } };
  };
} {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[configPath];
  try {
    return require(configPath);
  } finally {
    process.env = previous;
  }
}

afterEach(() => {
  delete require.cache[configPath];
});

describe("cleartext build policy", () => {
  it("permits cleartext on the development profile", () => {
    const config = loadConfig({ VITANA_ALLOW_CLEARTEXT: "1", EAS_BUILD_PROFILE: "development" });
    expect(config.expo.extra.allowCleartext).toBe(true);
  });

  it("permits cleartext outside EAS, where no distributable artifact is produced", () => {
    const config = loadConfig({ VITANA_ALLOW_CLEARTEXT: "1", EAS_BUILD_PROFILE: undefined });
    expect(config.expo.extra.allowCleartext).toBe(true);
  });

  it("fails the build when a distributable profile enables cleartext", () => {
    expect(() => loadConfig({ VITANA_ALLOW_CLEARTEXT: "1", EAS_BUILD_PROFILE: "preview" }))
      .toThrow(/only permitted on the "development" profile/);
    expect(() => loadConfig({ VITANA_ALLOW_CLEARTEXT: "1", EAS_BUILD_PROFILE: "production" }))
      .toThrow(/only permitted on the "development" profile/);
    expect(() => loadConfig({ VITANA_ALLOW_CLEARTEXT: "1", EAS_BUILD_PROFILE: "ios-device-farm" }))
      .toThrow(/only permitted on the "development" profile/);
  });

  it("builds distributable profiles with cleartext off", () => {
    const config = loadConfig({ VITANA_ALLOW_CLEARTEXT: "0", EAS_BUILD_PROFILE: "production" });
    expect(config.expo.extra.allowCleartext).toBe(false);
    expect(config.expo.android.usesCleartextTraffic).toBe(false);
  });

  it("keeps both platform transports on the same switch", () => {
    // A per-platform drift here would ship a build that is secure on Android and downgraded on
    // iOS, which no single-platform test would catch.
    const permitted = loadConfig({ VITANA_ALLOW_CLEARTEXT: "1", EAS_BUILD_PROFILE: "development" });
    expect(permitted.expo.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(true);
    expect(permitted.expo.android.usesCleartextTraffic).toBe(true);

    const distributable = loadConfig({ VITANA_ALLOW_CLEARTEXT: "0", EAS_BUILD_PROFILE: "production" });
    expect(distributable.expo.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(false);
    expect(distributable.expo.android.usesCleartextTraffic).toBe(false);
  });
});

describe("iOS release configuration", () => {
  const config = loadConfig({
    VITANA_ALLOW_CLEARTEXT: "0",
    EAS_BUILD_PROFILE: "production",
    EAS_BUILD_PLATFORM: "ios"
  });

  it("keeps the existing EAS project identity and explicit runtime", () => {
    expect(config.expo.slug).toBe("local-fitness-companion");
    expect(config.expo.extra.eas.projectId).toBe("2cc5cf1b-57e8-4e6f-8709-662259497a57");
    expect(config.expo.updates.url).toBe("https://u.expo.dev/2cc5cf1b-57e8-4e6f-8709-662259497a57");
    expect(config.expo.ios.bundleIdentifier).toBe("app.vitanahealth");
    expect(config.expo.runtimeVersion).toBe("4");
  });

  it("declares local-network, camera, and photo-library purposes", () => {
    expect(config.expo.ios.infoPlist.NSLocalNetworkUsageDescription).toMatch(/local network/i);
    expect(config.expo.ios.infoPlist.NSCameraUsageDescription).toMatch(/camera/i);
    expect(config.expo.ios.infoPlist.NSPhotoLibraryUsageDescription).toMatch(/health report/i);
  });

  it("does not generate HealthKit or billing capabilities", () => {
    const pluginNames = config.expo.plugins.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);
    expect(pluginNames).not.toContain("react-native-iap");
    expect(config.expo.ios.entitlements?.["com.apple.developer.healthkit"]).toBeUndefined();
  });

  it("retains the IAP config plugin for the future Android billing implementation", () => {
    const androidConfig = loadConfig({
      VITANA_ALLOW_CLEARTEXT: "0",
      EAS_BUILD_PROFILE: "production",
      EAS_BUILD_PLATFORM: "android"
    });
    const pluginNames = androidConfig.expo.plugins.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);
    expect(pluginNames).toContain("react-native-iap");
  });
});
