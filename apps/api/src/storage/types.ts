/**
 * Engine-neutral storage DTOs.
 *
 * These types are part of the storage *contract*, not of any one engine's implementation, but they
 * had come to live inside the DuckDB modules that happened to introduce them. That left the
 * abstract `ProfileRepository` interface importing from `duckdbReplicaSync.js` and
 * `duckdbHealthConnectSync.js` - the abstraction depending on the implementation, and a genuine
 * import cycle. Anything a second engine would also have to produce belongs here instead.
 */
import type {
  HealthConnectSyncSessionRequest,
  ReplicaChange,
  ReplicaHighWaterMark
} from "@vitana/shared";

/** The storage engines this build can run a profile on. */
export type StorageBackend = "duckdb";

/** Where the profile passphrase came from. Surfaced to the UI, so it is protocol, not plumbing. */
export type StoreSecurityMode = "env-secret" | "generated-local-key" | "os-secure-storage";

export interface StoreSecurityConfig {
  passphrase: string;
  securityMode: StoreSecurityMode;
}

/** One page of replica changes served to a paired phone. */
export interface StoredReplicaPage {
  changes: ReplicaChange[];
  highWaterMark: ReplicaHighWaterMark;
  nextOffset?: number;
}

/**
 * Idempotent: a phone that lost its session id (app killed mid-sync) sends the same session key and
 * gets the original session back, together with the batches already applied.
 */
export type HealthConnectSyncSessionStart = Pick<
  HealthConnectSyncSessionRequest,
  "sessionKey" | "deviceLabel" | "rangeStart" | "rangeEnd"
>;
