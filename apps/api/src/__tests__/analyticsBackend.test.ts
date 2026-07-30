import { describe, it, expect } from "vitest";
import {
  analyticsQueryCompilerFor,
  runAnalyticsQuery
} from "../storage/analyticsBackend.js";
import type { ProfileStoreManager } from "../storage/profileStoreManager.js";
import type { CompiledQuery } from "../queryCompiler.js";
import type { QueryDSL } from "../aiQueryPlanner.js";

const dsl: QueryDSL = {
  intent: "timeseries",
  metric: "heart_rate",
  aggregation: "avg",
  groupBy: "day",
  timeRange: { start: "2026-01-01", end: "2026-01-31" },
  sort: "desc",
  limit: 30,
  chartType: "line"
};

function fakeStoreManager(backend: string, onQuery?: (query: CompiledQuery) => void): ProfileStoreManager {
  return {
    getStorageBackend: () => backend,
    runActiveCompiledQuery: async (query: CompiledQuery) => {
      onQuery?.(query);
      return [];
    }
  } as unknown as ProfileStoreManager;
}

describe("analytics backend dispatch", () => {
  it("selects the compiler for the store's backend", () => {
    expect(analyticsQueryCompilerFor(fakeStoreManager("duckdb")).dialect).toBe("duckdb");
  });

  it("refuses a backend with no registered compiler", () => {
    // Previously this returned the DuckDB compiler regardless, so a SQLite store would have been
    // handed DuckDB SQL and only failed somewhere far away, at parse time.
    expect(() => analyticsQueryCompilerFor(fakeStoreManager("sqlite"))).toThrow(/sqlite/);
  });

  it("carries the dialect through to the store instead of a bare SQL string", () => {
    const compiled = analyticsQueryCompilerFor(fakeStoreManager("duckdb")).compile(dsl);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.dialect).toBe("duckdb");

    let received: CompiledQuery | undefined;
    void runAnalyticsQuery(fakeStoreManager("duckdb", (query) => { received = query; }), compiled);
    expect(received?.dialect).toBe("duckdb");
    expect(received?.sql).toBe(compiled.sql);
  });
});
