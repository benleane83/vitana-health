import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializePocRoot, proveNativeEncryption } from "./duckdbPoc.js";

const root = initializePocRoot(mkdtempSync(join(tmpdir(), "lfa-encrypted-duckdb-poc-")));
const result = await proveNativeEncryption(root);

if (!result.encrypted || !result.correctKeyRead || !result.missingKeyRejected || !result.wrongKeyRejected) {
  throw new Error("Native DuckDB encryption PoC did not satisfy all encryption gates.");
}

console.log(JSON.stringify({
  encrypted: result.encrypted,
  correctKeyRead: result.correctKeyRead,
  missingKeyRejected: result.missingKeyRejected,
  wrongKeyRejected: result.wrongKeyRejected
}));
