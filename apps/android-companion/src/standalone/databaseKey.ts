export interface SecureKeyStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

export interface DatabaseKey {
  hex: string;
  created: boolean;
}

export async function getOrCreateDatabaseKey(
  store: SecureKeyStore,
  randomBytes: (length: number) => Promise<Uint8Array>
): Promise<DatabaseKey> {
  const existing = await store.get();
  if (existing !== null) {
    if (!/^[a-f0-9]{64}$/i.test(existing)) {
      throw new Error("The standalone database key is invalid. Local data cannot be opened safely.");
    }
    return { hex: existing.toLowerCase(), created: false };
  }

  const bytes = await randomBytes(32);
  if (bytes.length !== 32) throw new Error("Unable to generate a 256-bit database key.");
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  await store.set(hex);
  return { hex, created: true };
}

export async function openWithDatabaseKey<T>(
  store: SecureKeyStore,
  randomBytes: (length: number) => Promise<Uint8Array>,
  open: (hexKey: string) => Promise<T>,
  shouldRemoveGeneratedKey: (error: unknown) => boolean = () => true
): Promise<T> {
  const key = await getOrCreateDatabaseKey(store, randomBytes);
  try {
    return await open(key.hex);
  } catch (error) {
    if (key.created && shouldRemoveGeneratedKey(error)) await store.remove();
    throw error;
  }
}
