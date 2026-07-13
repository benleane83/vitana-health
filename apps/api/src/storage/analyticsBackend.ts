import type { HealthStoreData } from "@local-fitness-advisor/shared";
import type { ProfileStoreManager } from "../store.js";
import type { QueryDSL } from "../aiQueryPlanner.js";
import {
  duckDbAnalyticsQueryCompiler,
  type CompileOutcome,
  type SqlValidationResult
} from "../queryCompiler.js";
import {
  rebuildWarehouseFromStore,
  runWarehouseQuery,
  type WarehouseBuildResult
} from "../warehouse.js";

export async function refreshAnalyticsStorage(
  storeManager: ProfileStoreManager,
  snapshot: HealthStoreData,
  profileId = storeManager.getActiveProfileId()
): Promise<WarehouseBuildResult> {
  if (storeManager.getStorageBackend() === "duckdb") {
    return {
      databasePath: `encrypted-profile:${profileId}`,
      engine: "duckdb",
      counts: {
        imports: snapshot.sourceImports.length,
        observations: snapshot.observations.length,
        samples: snapshot.timeSeriesSamples.length,
        activities: snapshot.activitySessions.length
      }
    };
  }
  return rebuildWarehouseFromStore(snapshot);
}

export function runAnalyticsQuery(
  storeManager: ProfileStoreManager,
  sql: string
): Promise<Array<Record<string, unknown>>> {
  return storeManager.getStorageBackend() === "duckdb"
    ? storeManager.runActiveDuckDbQuery(sql)
    : runWarehouseQuery(sql);
}

export function compileAnalyticsQuery(
  storeManager: ProfileStoreManager,
  dsl: QueryDSL
): CompileOutcome {
  return analyticsQueryCompilerFor(storeManager).compile(dsl);
}

export function validateAnalyticsQuery(
  storeManager: ProfileStoreManager,
  sql: string
): SqlValidationResult {
  return analyticsQueryCompilerFor(storeManager).validate(sql);
}

function analyticsQueryCompilerFor(_storeManager: ProfileStoreManager) {
  // JSON mode still uses the DuckDB warehouse, while active encrypted profiles
  // use DuckDB directly. A SQLCipher implementation belongs here, not in routes.
  return duckDbAnalyticsQueryCompiler;
}