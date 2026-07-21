import { describe, expect, it } from "vitest";
import { deriveProfileDatabaseKey } from "../storage/duckdbHealthStore.js";

describe("DuckDbHealthStore", () => {
  it("derives stable profile-isolated 256-bit database keys", () => {
    const first = deriveProfileDatabaseKey("desktop-passphrase", "self");
    expect(first).toBe(deriveProfileDatabaseKey("desktop-passphrase", "self"));
    expect(first).toBe("HnxPucxVz3i2tU+P7bbQtcqaRkxospB438VtFcTsXV4=");
    expect(first).not.toBe(deriveProfileDatabaseKey("desktop-passphrase", "other"));
    expect(Buffer.from(first, "base64")).toHaveLength(32);
  });
});