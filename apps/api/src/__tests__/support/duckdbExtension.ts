import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Locates the prepared DuckDB `httpfs` extension used to open encrypted databases.
 *
 * Returns `undefined` when the extension has not been prepared, which lets local
 * developers run the suite without it. Set `VITANA_REQUIRE_DUCKDB=1` in CI so a
 * missing extension fails loudly instead of silently skipping every storage test.
 */
export function findPreparedExtension(): string | undefined {
  const found = [
    process.env.VITANA_DUCKDB_HTTPFS_EXTENSION,
    // Legacy variable retained so older local checkouts keep working.
    process.env.DUCKDB_EXTENSION_PATH,
    resolve(process.cwd(), "apps", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension"),
    resolve(process.cwd(), "..", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension"),
    resolve(process.cwd(), "data", "duckdb-poc", "extensions", "httpfs.duckdb_extension")
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

  if (!found && process.env.VITANA_REQUIRE_DUCKDB === "1") {
    throw new Error(
      "VITANA_REQUIRE_DUCKDB=1 but no prepared DuckDB httpfs extension was found. " +
        "Run `npm run prepare:duckdb -w @vitana/api` before the storage suites."
    );
  }

  return found;
}

/** Same lookup, but always throws when the extension is missing. */
export function requirePreparedExtension(): string {
  const found = findPreparedExtension();
  if (!found) {
    throw new Error(
      "Prepared DuckDB httpfs extension is required for this test. " +
        "Run `npm run prepare:duckdb -w @vitana/api` first."
    );
  }
  return found;
}
