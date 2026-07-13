import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initializePocRoot, proveNativeEncryption } from "./duckdbPoc.js";

const root = initializePocRoot(mkdtempSync(join(tmpdir(), "lfa-encrypted-duckdb-poc-")));
const httpfsExtensionPath = resolveHttpfsExtensionPath();
const result = await proveNativeEncryption(root, { httpfsExtensionPath });

if (Object.entries(result).some(([name, value]) => name !== "databasePath" && value !== true)) {
  throw new Error("Native DuckDB encryption PoC did not satisfy all encryption gates.");
}

console.log(JSON.stringify({
  httpfsExtensionPath,
  encrypted: result.encrypted,
  correctKeyRead: result.correctKeyRead,
  missingKeyRejected: result.missingKeyRejected,
  wrongKeyRejected: result.wrongKeyRejected,
  walCreated: result.walCreated,
  tempSpillCreated: result.tempSpillCreated,
  sensitiveValuesAbsent: result.sensitiveValuesAbsent,
  rejectedKeysPreservedDatabase: result.rejectedKeysPreservedDatabase
}));

function resolveHttpfsExtensionPath(): string {
  const candidates = [
    process.env.LFA_DUCKDB_HTTPFS_EXTENSION,
    resolve(process.cwd(), "apps", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension"),
    resolve(process.cwd(), "..", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension")
  ].filter((value): value is string => Boolean(value));
  const extensionPath = candidates.find((candidate) => existsSync(candidate));
  if (!extensionPath) {
    throw new Error("Prepared DuckDB httpfs extension was not found. Run the prepare:poc:duckdb script first.");
  }
  return extensionPath;
}
