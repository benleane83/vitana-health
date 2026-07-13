import type { HealthStoreData } from "@local-fitness-advisor/shared";
import type { ProfileStoreManager } from "../store.js";
import {
  rebuildWarehouseFromStore,
  runWarehouseQuery,
  type WarehouseBuildResult
} from "../warehouse.js";

export async function refreshAnalyticsStorage(
  storeManager: ProfileStoreManager,
  snapshot: HealthStoreData
): Promise<WarehouseBuildResult> {
  if (storeManager.getStorageBackend() === "duckdb") {
    return {
      databasePath: `encrypted-profile:${storeManager.getActiveProfileId()}`,
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