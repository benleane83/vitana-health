import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveProfileDatabaseKey } from "../storage/duckdbHealthStore.js";

describe("DuckDbHealthStore", () => {
  it("derives stable profile-isolated 256-bit database keys", () => {
    const first = deriveProfileDatabaseKey("desktop-passphrase", "self");
    const legacyDuckDbKey = createHash("sha256")
      .update("local-fitness-advisor:duckdb-profile-key:v1\0", "utf8")
      .update("self", "utf8")
      .update("\0", "utf8")
      .update("desktop-passphrase", "utf8")
      .digest("base64");
    expect(first).toBe(deriveProfileDatabaseKey("desktop-passphrase", "self"));
    expect(first).toBe(legacyDuckDbKey);
    expect(first).not.toBe(deriveProfileDatabaseKey("desktop-passphrase", "other"));
    expect(Buffer.from(first, "base64")).toHaveLength(32);
  });
});