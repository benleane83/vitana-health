import type {
  AppBootstrap,
  DeleteObservationResponse,
  DeleteObservationsByTypeResponse,
  UpdateObservationResponse
} from "@vitana/shared";
import type { ProfileStoreManager } from "./profileStoreManager.js";
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
  counts: AppBootstrap["counts"] | UpdateObservationResponse["counts"] | DeleteObservationResponse["counts"] | DeleteObservationsByTypeResponse["counts"],
  profileId = storeManager.getActiveProfileId()
): AnalyticsStorageDescription {
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