import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8"
);

describe("native Android data protection", () => {
  it("does not back up or transfer the encrypted database without its device-local key", () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).not.toContain("android:fullBackupContent");
    expect(manifest).not.toContain("android:dataExtractionRules");
  });
});