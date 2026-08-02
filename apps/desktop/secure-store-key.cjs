const { randomBytes } = require("node:crypto");
const {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync
} = require("node:fs");
const path = require("node:path");

const keyFileName = "store-key.v1.json";
const initializationLockFileName = "store-key.v1.initializing";

async function prepareSecureStoreKey(options) {
  const {
    safeStorage,
    userDataPath,
    platform = process.platform,
    processId = process.pid,
    now = () => Date.now(),
    delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
  } = options;
  assertSecureStorageAvailable(safeStorage, platform);
  if (platform !== "win32" || existsSync(path.join(userDataPath, keyFileName))) {
    return { finalize() {} };
  }

  mkdirSync(userDataPath, { recursive: true });
  const lockPath = path.join(userDataPath, initializationLockFileName);
  acquireInitializationLock(lockPath, processId, now());
  try {
    if (existsSync(path.join(userDataPath, keyFileName))) {
      return initializationHandle(lockPath);
    }
    safeStorage.encryptString("vitana-secure-store-readiness");
    await waitForPersistedWindowsEncryptionState(userDataPath, delay);
    const probe = safeStorage.encryptString("vitana-secure-store-verification");
    if (safeStorage.decryptString(probe) !== "vitana-secure-store-verification") {
      throw new Error("The OS secure store failed its startup verification.");
    }
    return initializationHandle(lockPath);
  } catch (error) {
    rmSync(lockPath, { force: true });
    throw error;
  }
}

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
    if (platform === "linux") {
      throw new Error(
        "GNOME Secret Service is unavailable. Unlock or configure GNOME Keyring, then relaunch Vitana Health; health storage was not opened."
      );
    }
    throw new Error("OS secure storage is unavailable; health storage will not be opened.");
  }
  if (
    platform === "linux" &&
    typeof safeStorage.getSelectedStorageBackend === "function" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  ) {
    throw new Error(
      "Electron safeStorage selected the insecure Linux basic_text backend. Unlock or configure GNOME Keyring, then relaunch Vitana Health; health storage was not opened."
    );
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

function acquireInitializationLock(lockPath, processId, createdAt) {
  try {
    const descriptor = openSync(lockPath, "wx", 0o600);
    try {
      writeSync(descriptor, JSON.stringify({ processId, createdAt }));
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (isStaleInitializationLock(lockPath, createdAt)) {
      rmSync(lockPath, { force: true });
      return acquireInitializationLock(lockPath, processId, createdAt);
    }
    throw new Error("Health storage is being initialized by another Vitana Health process. Close this window and try again.");
  }
}

function isStaleInitializationLock(lockPath, now) {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8"));
    if (!Number.isSafeInteger(parsed.processId) || !Number.isFinite(parsed.createdAt)) return true;
    if (now - parsed.createdAt > 5 * 60_000) return true;
    try {
      process.kill(parsed.processId, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  } catch {
    return true;
  }
}

async function waitForPersistedWindowsEncryptionState(userDataPath, delay) {
  const localStatePath = path.join(userDataPath, "Local State");
  // 15 seconds. Chromium can take well over five on a cold or contended disk, and giving up
  // early surfaces as a hard startup failure rather than a slow one.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const localState = JSON.parse(readFileSync(localStatePath, "utf8"));
      if (typeof localState?.os_crypt?.encrypted_key === "string" && localState.os_crypt.encrypted_key.length > 0) {
        return;
      }
    } catch {
      // Chromium may still be creating or atomically replacing Local State.
    }
    await delay(50);
  }
  throw new Error("The OS secure store did not finish starting up. Please relaunch Vitana Health.");
}

function initializationHandle(lockPath) {
  return {
    finalize() {
      rmSync(lockPath, { force: true });
    }
  };
}

module.exports = { loadOrCreateSecureStoreKey, prepareSecureStoreKey };