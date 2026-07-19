import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const appConfig = require("../app.config.js") as {
  expo: {
    android: {
      allowBackup: boolean;
    };
  };
};

describe("native Android data protection", () => {
  it("disables Android backup for the encrypted database and its device-local key", () => {
    expect(appConfig.expo.android.allowBackup).toBe(false);
  });
});