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

/**
 * Hosts this build is approved to run encrypted DuckDB storage on, keyed by
 * `${process.platform}-${process.arch}` and valued with DuckDB's extension platform identifier.
 *
 * The approval gate reads this table rather than comparing against a hard-coded `"win32"`/`"x64"`
 * pair, so bringing up Linux or macOS is one row plus a prepared extension digest - not a hunt for
 * scattered platform checks that each have to be found and widened by hand.
 */
export const SUPPORTED_HOST_PLATFORMS: Readonly<Record<string, string>> = Object.freeze({
  "win32-x64": "windows_amd64"
});

/** DuckDB extension platform for an approved host, or `undefined` when the host is not approved. */
export function supportedHostPlatform(
  nodePlatform: string,
  nodeArchitecture: string
): string | undefined {
  return SUPPORTED_HOST_PLATFORMS[`${nodePlatform}-${nodeArchitecture}`];
}

/** Human-readable list of approved hosts, for the error a rejected host sees. */
export function supportedHostPlatformsDescription(): string {
  return Object.keys(SUPPORTED_HOST_PLATFORMS).join(", ");
}

/**
 * Maps Node's `process.platform`/`process.arch` onto DuckDB's extension platform identifiers.
 *
 * Deliberately broader than `SUPPORTED_HOST_PLATFORMS`: the packaging script needs to name a
 * download for a platform we are preparing but have not yet approved at runtime.
 */
export function duckDbPlatform(nodePlatform: string, nodeArchitecture: string): string {
  const operatingSystem = { darwin: "osx", linux: "linux", win32: "windows" }[nodePlatform];
  const architecture = { arm64: "arm64", x64: "amd64" }[nodeArchitecture];
  if (!operatingSystem || !architecture) {
    throw new Error(`DuckDB httpfs is not prepared for ${nodePlatform}/${nodeArchitecture}.`);
  }
  return `${operatingSystem}_${architecture}`;
}

/** Digest for the given host, or `undefined` when this host has no pinned build. */
export function pinnedHttpfsSha256(nodePlatform: string, nodeArchitecture: string): string | undefined {
  const platform = supportedHostPlatform(nodePlatform, nodeArchitecture);
  return platform === undefined ? undefined : PINNED_DUCKDB_HTTPFS_SHA256[platform];
}
