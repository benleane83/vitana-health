import type {
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  HealthStoreData,
  UpdateObservationResponse
} from "@local-fitness-advisor/shared";
import type { ProfileStoreManager } from "./profileStoreManager.js";
import type { ImportMutationResult } from "./profileRepository.js";
import type { QueryDSL } from "../aiQueryPlanner.js";
import {
  duckDbAnalyticsQueryCompiler,
  type CompileOutcome,
  type SqlValidationResult
} from "../queryCompiler.js";

export interface AnalyticsStorageDescription {
  databasePath: string;
  engine: "duckdb";
  counts: {
    imports: number;
    observations: number;
    samples: number;
    activities: number;
  };
}

export function describeAnalyticsStorage(
  storeManager: ProfileStoreManager,
  source: HealthStoreData | ImportMutationResult | UpdateObservationResponse | DeleteObservationResponse | DeleteObservationsByTypeResponse,
  profileId = storeManager.getActiveProfileId()
): AnalyticsStorageDescription {
  const counts = "sourceImports" in source
    ? {
        imports: source.sourceImports.length,
        observations: source.observations.length,
        samples: source.timeSeriesSamples.length,
        activities: source.activitySessions.length
      }
    : source.counts;
  return {
    databasePath: `encrypted-profile:${profileId}`,
    engine: "duckdb",
    counts
  };
}

export function runAnalyticsQuery(
  storeManager: ProfileStoreManager,
  sql: string
): Promise<Array<Record<string, unknown>>> {
  return storeManager.runActiveCompiledQuery(sql);
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
  return duckDbAnalyticsQueryCompiler;
}