const { randomBytes } = require("node:crypto");
const {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} = require("node:fs");
const path = require("node:path");

const keyFileName = "store-key.v1.json";

function loadOrCreateSecureStoreKey(options) {
  const { safeStorage, userDataPath, legacyKeyPath, platform = process.platform } = options;
  assertSecureStorageAvailable(safeStorage, platform);

  const keyPath = path.join(userDataPath, keyFileName);
  if (existsSync(keyPath)) {
    return {
      passphrase: decryptPersistedKey(safeStorage, keyPath),
      finalize() {}
    };
  }

  mkdirSync(userDataPath, { recursive: true });
  const migratedLegacyKey = legacyKeyPath && existsSync(legacyKeyPath);
  const passphrase = migratedLegacyKey
    ? readLegacyKey(legacyKeyPath)
    : randomBytes(32).toString("base64url");
  const wrappedKey = safeStorage.encryptString(passphrase).toString("base64");
  const serialized = `${JSON.stringify({ version: 1, wrappedKey }, null, 2)}\n`;
  const temporaryPath = `${keyPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporaryPath, keyPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return {
    passphrase,
    finalize() {
      if (migratedLegacyKey) {
        rmSync(legacyKeyPath, { force: true });
      }
    }
  };
}

function assertSecureStorageAvailable(safeStorage, platform) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS secure storage is unavailable; health storage will not be opened.");
  }
  if (
    platform === "linux" &&
    typeof safeStorage.getSelectedStorageBackend === "function" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  ) {
    throw new Error("Electron safeStorage selected the insecure Linux basic_text backend; health storage will not be opened.");
  }
}

function decryptPersistedKey(safeStorage, keyPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(keyPath, "utf8"));
  } catch (error) {
    throw new Error(`Secure health-store key metadata is unreadable at ${keyPath}.`, { cause: error });
  }
  if (
    parsed?.version !== 1 ||
    typeof parsed.wrappedKey !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.wrappedKey)
  ) {
    throw new Error(`Secure health-store key metadata is invalid at ${keyPath}.`);
  }
  let passphrase;
  try {
    passphrase = safeStorage.decryptString(Buffer.from(parsed.wrappedKey, "base64"));
  } catch (error) {
    throw new Error("The OS secure store could not unwrap the health-store key.", { cause: error });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(passphrase)) {
    throw new Error("The unwrapped health-store key has an invalid format.");
  }
  return passphrase;
}

function readLegacyKey(legacyKeyPath) {
  const passphrase = readFileSync(legacyKeyPath, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(passphrase)) {
    throw new Error(`Legacy health-store key has an invalid format at ${legacyKeyPath}.`);
  }
  return passphrase;
}

module.exports = { loadOrCreateSecureStoreKey };