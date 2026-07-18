import { describe, expect, it, vi } from "vitest";
import { getOrCreateDatabaseKey, openWithDatabaseKey, type SecureKeyStore } from "./databaseKey";

function fakeStore(initial: string | null = null): SecureKeyStore & { value: string | null } {
  return {
    value: initial,
    async get() { return this.value; },
    async set(value) { this.value = value; },
    async remove() { this.value = null; }
  };
}

describe("standalone database key", () => {
  it("generates and persists exactly 256 random bits", async () => {
    const store = fakeStore();
    const key = await getOrCreateDatabaseKey(store, async () => Uint8Array.from({ length: 32 }, (_, index) => index));
    expect(key).toEqual({
      hex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      created: true
    });
    expect(store.value).toBe(key.hex);
  });

  it("reuses a valid device-protected key without generating another", async () => {
    const store = fakeStore("ab".repeat(32));
    const random = vi.fn<() => Promise<Uint8Array>>();
    await expect(getOrCreateDatabaseKey(store, random)).resolves.toEqual({ hex: "ab".repeat(32), created: false });
    expect(random).not.toHaveBeenCalled();
  });

  it("fails closed for malformed keys", async () => {
    await expect(getOrCreateDatabaseKey(fakeStore("not-a-key"), async () => new Uint8Array(32)))
      .rejects.toThrow("cannot be opened safely");
  });

  it("removes a newly generated key when encrypted database initialization fails", async () => {
    const store = fakeStore();
    await expect(openWithDatabaseKey(store, async () => new Uint8Array(32), async () => {
      throw new Error("file is encrypted");
    })).rejects.toThrow("file is encrypted");
    expect(store.value).toBeNull();
  });
});
