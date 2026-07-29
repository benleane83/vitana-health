/**
 * Single source of truth for the DuckDB runtime pin.
 *
 * The encrypted-store design depends on a *core-signed* `httpfs` extension whose bytes we verify
 * by digest before loading. That digest is only valid for one DuckDB build, so the npm dependency,
 * the extension download, and the runtime check must all agree on the same version. Keeping them
 * in three places is how they drift; keeping them here is how they cannot.
 *
 * Consumers:
 * - `apps/api/src/storage/profileStoreManager.ts` (runtime verification before load)
 * - `scripts/prepare-duckdb-httpfs.mjs` (download + packaging)
 * - `apps/desktop/package-config.test.cjs` (asserts the npm pin matches)
 *
 * When bumping DuckDB: change `PINNED_DUCKDB_VERSION`, run the prepare script, and replace the
 * digest below with the one it reports. The `apps/api` dependency must be an exact version, not a
 * range — a caret would let npm resolve a build whose extension digest no longer matches.
 */
export const PINNED_DUCKDB_VERSION = "1.4.4";

/** SHA-256 of the core-signed `httpfs.duckdb_extension` for each supported DuckDB platform. */
export const PINNED_DUCKDB_HTTPFS_SHA256: Readonly<Record<string, string>> = Object.freeze({
  windows_amd64: "21eea4547cf5aa5231f4838906e8935067c956f56a5efd09035a51189af8a77b"
});

/** Maps Node's `process.platform`/`process.arch` onto DuckDB's extension platform identifiers. */
export function duckDbPlatform(nodePlatform: string, nodeArchitecture: string): string {
  const operatingSystem = { darwin: "osx", linux: "linux", win32: "windows" }[nodePlatform];
  const architecture = { arm64: "arm64", x64: "amd64" }[nodeArchitecture];
  if (!operatingSystem || !architecture) {
    throw new Error(`DuckDB httpfs is not prepared for ${nodePlatform}/${nodeArchitecture}.`);
  }
  return `${operatingSystem}_${architecture}`;
}

/** Digest for the current host, or `undefined` when this platform has no pinned build. */
export function pinnedHttpfsSha256(nodePlatform: string, nodeArchitecture: string): string | undefined {
  return PINNED_DUCKDB_HTTPFS_SHA256[duckDbPlatform(nodePlatform, nodeArchitecture)];
}
