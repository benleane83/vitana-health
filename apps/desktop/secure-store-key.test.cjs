const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { loadOrCreateSecureStoreKey, prepareSecureStoreKey } = require("./secure-store-key.cjs");

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "vitana-secure-key-test-"));
  roots.push(root);
  return root;
}

function makeSafeStorage(options = {}) {
  return {
    isEncryptionAvailable: () => options.available !== false,
    getSelectedStorageBackend: () => options.backend ?? "kwallet6",
    encryptString: (value) => Buffer.from(`wrapped:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("wrapped:")) {
        throw new Error("unwrap failed");
      }
      return decoded.slice("wrapped:".length);
    }
  };
}

test("creates and reloads a wrapped key without persisting plaintext", () => {
  const root = makeRoot();
  const first = loadOrCreateSecureStoreKey({ safeStorage: makeSafeStorage(), userDataPath: root });
  const keyFile = path.join(root, "store-key.v1.json");

  assert.match(first.passphrase, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(readFileSync(keyFile, "utf8").includes(first.passphrase), false);
  assert.equal(loadOrCreateSecureStoreKey({ safeStorage: makeSafeStorage(), userDataPath: root }).passphrase, first.passphrase);
});

test("wraps a legacy key and removes plaintext only after finalize", () => {
  const root = makeRoot();
  const legacyKeyPath = path.join(root, "local.key");
  const legacyKey = "a".repeat(43);
  writeFileSync(legacyKeyPath, legacyKey, "utf8");

  const result = loadOrCreateSecureStoreKey({
    safeStorage: makeSafeStorage(),
    userDataPath: root,
    legacyKeyPath
  });

  assert.equal(result.passphrase, legacyKey);
  assert.equal(existsSync(legacyKeyPath), true);
  result.finalize();
  assert.equal(existsSync(legacyKeyPath), false);
});

test("refuses unavailable and insecure Linux secure storage", () => {
  const root = makeRoot();
  assert.throws(
    () => loadOrCreateSecureStoreKey({ safeStorage: makeSafeStorage({ available: false }), userDataPath: root }),
    /unavailable/
  );
  assert.throws(
    () => loadOrCreateSecureStoreKey({
      safeStorage: makeSafeStorage({ backend: "basic_text" }),
      userDataPath: root,
      platform: "linux"
    }),
    /basic_text/
  );
});

test("refuses corrupt wrapped-key metadata without replacing it", () => {
  const root = makeRoot();
  const keyFile = path.join(root, "store-key.v1.json");
  const corrupt = "{\"version\":1,\"wrappedKey\":\"not base64!\"}";
  writeFileSync(keyFile, corrupt, "utf8");

  assert.throws(
    () => loadOrCreateSecureStoreKey({ safeStorage: makeSafeStorage(), userDataPath: root }),
    /metadata is invalid/
  );
  assert.equal(readFileSync(keyFile, "utf8"), corrupt);
});

test("waits for persisted Windows encryption state before creating a key", async () => {
  const root = makeRoot();
  let encryptionCalls = 0;
  const safeStorage = makeSafeStorage();
  safeStorage.encryptString = (value) => {
    encryptionCalls += 1;
    if (encryptionCalls === 1) {
      writeFileSync(path.join(root, "Local State"), JSON.stringify({ os_crypt: { encrypted_key: "persisted" } }));
    }
    return Buffer.from(`wrapped:${value}`, "utf8");
  };

  const preparation = await prepareSecureStoreKey({
    safeStorage,
    userDataPath: root,
    platform: "win32",
    delay: async () => {}
  });
  const result = loadOrCreateSecureStoreKey({ safeStorage, userDataPath: root });
  preparation.finalize();

  assert.equal(encryptionCalls, 3);
  assert.match(result.passphrase, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(existsSync(path.join(root, "store-key.v1.initializing")), false);
});

test("rejects a concurrent first-run key initialization without replacing its lock", async () => {
  const root = makeRoot();
  const lockPath = path.join(root, "store-key.v1.initializing");
  writeFileSync(lockPath, JSON.stringify({ processId: process.pid, createdAt: Date.now() }));

  await assert.rejects(
    prepareSecureStoreKey({ safeStorage: makeSafeStorage(), userDataPath: root, platform: "win32" }),
    /another Vitana Health process/
  );
  assert.equal(existsSync(lockPath), true);
});