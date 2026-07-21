const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { loadOrCreateSecureStoreKey } = require("./secure-store-key.cjs");

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