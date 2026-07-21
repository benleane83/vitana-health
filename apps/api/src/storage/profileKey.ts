import { createHash } from "node:crypto";

export type ProfileStorageKeyPurpose = "duckdb-v1" | "sqlcipher-v1";

const keyNamespaces: Record<ProfileStorageKeyPurpose, string> = {
  // Preserve this namespace exactly: existing encrypted DuckDB profiles depend on it.
  "duckdb-v1": "local-fitness-advisor:duckdb-profile-key:v1\0",
  "sqlcipher-v1": "vitana:sqlcipher-profile-key:v1\0"
};

export function deriveProfileStorageKey(
  passphrase: string,
  profileId: string,
  purpose: ProfileStorageKeyPurpose
): string {
  return createHash("sha256")
    .update(keyNamespaces[purpose], "utf8")
    .update(profileId, "utf8")
    .update("\0", "utf8")
    .update(passphrase, "utf8")
    .digest("base64");
}