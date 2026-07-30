import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const appConfig = require("../app.config.js") as {
  expo: {
    version: string;
    runtimeVersion: unknown;
    android: {
      allowBackup: boolean;
      usesCleartextTraffic: boolean;
    };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = appConfig.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === name
  );
  return Array.isArray(entry) ? entry[1] : undefined;
}

describe("native Android data protection", () => {
  it("disables Android backup for the encrypted database and its device-local key", () => {
    expect(appConfig.expo.android.allowBackup).toBe(false);
  });

  it("does not let the SecureStore plugin re-enable Android backup", () => {
    expect(pluginOptions("expo-secure-store")).toEqual({ configureAndroidBackup: false });
  });

  it("disables cleartext network traffic by default", () => {
    expect(appConfig.expo.android.usesCleartextTraffic).toBe(false);
  });
});

describe("over-the-air update targeting", () => {
  it("pins an explicit runtime version that is independent of the marketing version", () => {
    expect(typeof appConfig.expo.runtimeVersion).toBe("string");
    expect(appConfig.expo.runtimeVersion).not.toBe(appConfig.expo.version);
  });
});