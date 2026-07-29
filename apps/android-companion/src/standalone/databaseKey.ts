export interface SecureKeyStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

export interface DatabaseKey {
  hex: string;
  created: boolean;
}

let keyOperation = Promise.resolve();

export async function getOrCreateDatabaseKey(
  store: SecureKeyStore,
  randomBytes: (length: number) => Promise<Uint8Array>
): Promise<DatabaseKey> {
  const previousOperation = keyOperation;
  let releaseOperation: () => void;
  keyOperation = new Promise<void>((resolve) => {
    releaseOperation = resolve;
  });
  await previousOperation;

  try {
    const existing = await store.get();
    if (existing !== null) {
      if (!keyHexPattern.test(existing)) {
        throw new Error("The standalone database key is invalid. Local data cannot be opened safely.");
      }
      return { hex: existing.toLowerCase(), created: false };
    }

    const hex = await generateDatabaseKeyHex(randomBytes);
    await store.set(hex);
    return { hex, created: true };
  } finally {
    releaseOperation!();
  }
}

export async function openWithDatabaseKey<T>(
  store: SecureKeyStore,
  randomBytes: (length: number) => Promise<Uint8Array>,
  open: (hexKey: string, created: boolean) => Promise<T>,
  shouldRemoveGeneratedKey: (error: unknown) => boolean = () => true
): Promise<T> {
  const key = await getOrCreateDatabaseKey(store, randomBytes);
  try {
    return await open(key.hex, key.created);
  } catch (error) {
    if (key.created && shouldRemoveGeneratedKey(error)) await store.remove();
    throw error;
  }
}

export interface RekeyDatabase {
  execAsync(query: string): Promise<void>;
  getFirstAsync<T>(query: string): Promise<T | null>;
}

const keyHexPattern = /^[a-f0-9]{64}$/i;

export function assertDatabaseKeyHex(hex: string, label: string): void {
  if (!keyHexPattern.test(hex)) throw new Error(`The ${label} database key is not a 256-bit hex key.`);
}

export async function generateDatabaseKeyHex(
  randomBytes: (length: number) => Promise<Uint8Array>
): Promise<string> {
  const bytes = await randomBytes(32);
  if (bytes.length !== 32) throw new Error("Unable to generate a 256-bit database key.");
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Re-encrypts an existing database under a new key.
 *
 * The old key is proven correct with a read before `PRAGMA rekey` runs, so a wrong old key fails
 * before any page is rewritten. A second read afterwards proves the new key is the one in force.
 */
export async function rekeyDatabase(
  database: RekeyDatabase,
  oldKeyHex: string,
  newKeyHex: string
): Promise<void> {
  assertDatabaseKeyHex(oldKeyHex, "current");
  assertDatabaseKeyHex(newKeyHex, "replacement");
  if (oldKeyHex.toLowerCase() === newKeyHex.toLowerCase()) {
    throw new Error("The replacement database key must differ from the current key.");
  }

  await database.execAsync(`PRAGMA key = "x'${oldKeyHex}'";`);
  await database.getFirstAsync("PRAGMA user_version");
  await database.execAsync(`PRAGMA rekey = "x'${newKeyHex}'";`);
  await database.getFirstAsync("PRAGMA user_version");
}

