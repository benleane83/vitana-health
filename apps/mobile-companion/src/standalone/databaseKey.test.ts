import { describe, expect, it, vi } from "vitest";
import {
  getOrCreateDatabaseKey,
  openWithDatabaseKey,
  rekeyDatabase,
  type SecureKeyStore
} from "./databaseKey";

/**
 * A SQLCipher stand-in: it only decrypts while the applied key matches the key the pages were
 * written under, which is what makes the round-trip assertion below meaningful.
 */
function fakeEncryptedDatabase(storedKey: string) {
  let pageKey = storedKey;
  let appliedKey: string | undefined;
  const statements: string[] = [];
  return {
    statements,
    currentKey: () => pageKey,
    database: {
      async execAsync(query: string) {
        statements.push(query);
        const apply = /^PRAGMA key = "x'([a-f0-9]{64})'";$/i.exec(query);
        if (apply) {
          appliedKey = apply[1];
          return;
        }
        const rekey = /^PRAGMA rekey = "x'([a-f0-9]{64})'";$/i.exec(query);
        if (rekey) {
          if (appliedKey !== pageKey) throw new Error("file is not a database");
          pageKey = rekey[1];
          appliedKey = rekey[1];
        }
      },
      async getFirstAsync<T>(): Promise<T | null> {
        if (appliedKey !== pageKey) throw new Error("file is not a database");
        return { user_version: 4 } as T;
      }
    }
  };
}

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

  it("serializes concurrent first-use key creation", async () => {
    const store = fakeStore();
    const random = vi.fn(async () => Uint8Array.from({ length: 32 }, () => 0xab));

    const keys = await Promise.all([
      getOrCreateDatabaseKey(store, random),
      getOrCreateDatabaseKey(store, random)
    ]);

    expect(random).toHaveBeenCalledOnce();
    expect(keys).toEqual([
      { hex: "ab".repeat(32), created: true },
      { hex: "ab".repeat(32), created: false }
    ]);
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

  it("retains an accepted new key when a recoverable migration fails", async () => {
    const store = fakeStore();
    await expect(openWithDatabaseKey(
      store,
      async () => new Uint8Array(32),
      async () => { throw new Error("migration interrupted"); },
      () => false
    )).rejects.toThrow("migration interrupted");
    expect(store.value).toBe("00".repeat(32));
  });

  it("tells the open callback whether the key was freshly generated", async () => {
    const reused = fakeStore("b".repeat(64));
    await expect(openWithDatabaseKey(reused, async () => new Uint8Array(32), async (_, created) => created))
      .resolves.toBe(false);
    await expect(openWithDatabaseKey(fakeStore(), async () => new Uint8Array(32), async (_, created) => created))
      .resolves.toBe(true);
  });
});

describe("database rekey", () => {
  const oldKey = "a".repeat(64);
  const newKey = "b".repeat(64);

  it("re-encrypts under the new key and leaves the old key unable to open the file", async () => {
    const { database, currentKey, statements } = fakeEncryptedDatabase(oldKey);

    await rekeyDatabase(database, oldKey, newKey);

    expect(currentKey()).toBe(newKey);
    expect(statements).toEqual([
      `PRAGMA key = "x'${oldKey}'";`,
      `PRAGMA rekey = "x'${newKey}'";`
    ]);

    // Round trip: the new key opens the file, the old one no longer does.
    const reopened = fakeEncryptedDatabase(newKey);
    await reopened.database.execAsync(`PRAGMA key = "x'${newKey}'";`);
    await expect(reopened.database.getFirstAsync()).resolves.toEqual({ user_version: 4 });
    await reopened.database.execAsync(`PRAGMA key = "x'${oldKey}'";`);
    await expect(reopened.database.getFirstAsync()).rejects.toThrow("file is not a database");
  });

  it("proves the current key before rewriting any page", async () => {
    const { database, currentKey } = fakeEncryptedDatabase(newKey);

    await expect(rekeyDatabase(database, oldKey, "c".repeat(64))).rejects.toThrow("file is not a database");

    expect(currentKey()).toBe(newKey);
  });

  it("rejects malformed and unchanged keys", async () => {
    const { database } = fakeEncryptedDatabase(oldKey);

    await expect(rekeyDatabase(database, "short", newKey)).rejects.toThrow("current database key");
    await expect(rekeyDatabase(database, oldKey, "not-hex")).rejects.toThrow("replacement database key");
    await expect(rekeyDatabase(database, oldKey, oldKey)).rejects.toThrow("must differ");
  });
});
