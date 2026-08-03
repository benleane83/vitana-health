import type {
  AppBootstrap,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  UpdateObservationResponse
} from "@vitana/shared";
import type { ProfileStoreManager, StorageBackend } from "./profileStoreManager.js";
import type { QueryDSL } from "../aiQueryPlanner.js";
import {
  duckDbAnalyticsQueryCompiler,
  type AnalyticsQueryCompiler,
  type CompiledQuery,
  type CompiledQueryOutcome,
  type SqlValidationResult
} from "../queryCompiler.js";

/**
 * The storage-facing part of a mutation response. It carries counts only: the engine name and a
 * synthetic `encrypted-profile:<id>` path used to be included, but neither is a real path nor
 * something a client should branch on, and the storage engine is deliberately swappable.
 */
export type AnalyticsStorageCounts =
  | AppBootstrap["counts"]
  | UpdateObservationResponse["counts"]
  | DeleteObservationResponse["counts"]
  | DeleteObservationsByTypeResponse["counts"];

export interface AnalyticsStorageDescription {
  counts: AnalyticsStorageCounts;
}

export function describeAnalyticsStorage(counts: AnalyticsStorageCounts): AnalyticsStorageDescription {
  return { counts };
}

export async function runAnalyticsQuery(
  storeManager: ProfileStoreManager,
  query: CompiledQuery
): Promise<Array<Record<string, unknown>>> {
  const rows = await storeManager.runActiveCompiledQuery(query);
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, jsonSafeAnalyticsValue(value)])
  ));
}

function jsonSafeAnalyticsValue(value: unknown): unknown {
  if (typeof value !== "bigint") return value;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : value.toString();
}

export function compileAnalyticsQuery(
  storeManager: ProfileStoreManager,
  dsl: QueryDSL
): CompiledQueryOutcome {
  return analyticsQueryCompilerFor(storeManager).compile(dsl);
}

export function validateAnalyticsQuery(
  storeManager: ProfileStoreManager,
  sql: string
): SqlValidationResult {
  return analyticsQueryCompilerFor(storeManager).validate(sql);
}

/**
 * One compiler per storage backend.
 *
 * Typed exhaustively on purpose: adding `"sqlite"` to the backend union will fail to compile here
 * until a SQLite compiler exists, rather than quietly handing DuckDB SQL to a SQLite connection.
 */
const analyticsQueryCompilers: Record<StorageBackend, AnalyticsQueryCompiler> = {
  duckdb: duckDbAnalyticsQueryCompiler
};

export function analyticsQueryCompilerFor(storeManager: ProfileStoreManager): AnalyticsQueryCompiler {
  const backend = storeManager.getStorageBackend();
  const compiler = analyticsQueryCompilers[backend] as AnalyticsQueryCompiler | undefined;
  if (!compiler) {
    throw new Error(`No analytics query compiler is registered for the ${backend} storage backend.`);
  }
  return compiler;
}