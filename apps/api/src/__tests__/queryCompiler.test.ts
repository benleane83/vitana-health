import { describe, it, expect } from "vitest";
import { compileQueryDSL, validateCompiledSql } from "../queryCompiler.js";
import type { QueryDSL } from "../aiQueryPlanner.js";

const baseDsl: QueryDSL = {
  intent: "timeseries",
  metric: "heart_rate",
  aggregation: "avg",
  groupBy: "day",
  timeRange: { start: "2026-01-01", end: "2026-01-31" },
  sort: "desc",
  limit: 30,
  chartType: "line"
};

// ─── compileQueryDSL ───────────────────────────────────────────────────────────

describe("compileQueryDSL — timeseries", () => {
  it("compiles a daily timeseries query successfully", () => {
    const result = compileQueryDSL(baseDsl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/SELECT day/i);
    expect(result.sql).toMatch(/FROM v_daily_metrics/i);
    expect(result.sql).toMatch(/measurement_code = \?/);
    expect(result.parameters).toEqual(["heart_rate", "2026-01-01", "2026-01-31"]);
    expect(result.sql).toMatch(/LIMIT 30/);
  });

  it("compiles a weekly timeseries query", () => {
    const result = compileQueryDSL({ ...baseDsl, groupBy: "week" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/DATE_TRUNC\('week'/i);
    expect(result.sql).toMatch(/week_start/i);
  });

  it("compiles a monthly timeseries query", () => {
    const result = compileQueryDSL({ ...baseDsl, groupBy: "month" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/DATE_TRUNC\('month'/i);
    expect(result.sql).toMatch(/month_start/i);
  });
});

describe("compileQueryDSL — aggregation", () => {
  it("compiles an aggregation query", () => {
    const result = compileQueryDSL({ ...baseDsl, intent: "aggregation", groupBy: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/AVG\(avg_value\)/i);
    expect(result.sql).toMatch(/LIMIT 1/i);
  });
});

describe("compileQueryDSL — top_n", () => {
  it("compiles a top_n query", () => {
    const result = compileQueryDSL({ ...baseDsl, intent: "top_n", aggregation: "max", limit: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/ORDER BY value/i);
    expect(result.sql).toMatch(/LIMIT 10/);
  });
});

describe("compileQueryDSL — latest", () => {
  it("compiles a latest query with LIMIT 1", () => {
    const result = compileQueryDSL({ ...baseDsl, intent: "latest", aggregation: "latest", limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/LIMIT 1/);
    expect(result.sql).toMatch(/ORDER BY day DESC/i);
  });
});

describe("compileQueryDSL — list_activities", () => {
  it("compiles a list_activities count query", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      intent: "list_activities",
      metric: null,
      aggregation: "count"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/FROM activities/i);
    expect(result.sql).toMatch(/COUNT\(\*\)/i);
  });

  it("compiles a list_activities listing query (non-count aggregation)", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      intent: "list_activities",
      metric: null,
      aggregation: "avg"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/FROM activities/i);
    expect(result.sql).toMatch(/SELECT activity_type/i);
  });
});

describe("compileQueryDSL — health_events", () => {
  it("compiles filtered event listings through the AI projection", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      source: "health_events",
      intent: "list",
      metric: null,
      aggregation: "count",
      groupBy: null,
      filters: { kind: "immunization", status: "completed", provider: "Local Clinic" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/FROM v_ai_health_events/i);
    expect(result.sql).toContain("kind = ?");
    expect(result.sql).toMatch(/provider.*LIKE.*\?/i);
    expect(result.parameters).toEqual([
      "2026-01-01 00:00:00",
      "2026-01-31 23:59:59",
      "immunization",
      "completed",
      "%Local Clinic%"
    ]);
    expect(validateCompiledSql(result.sql).valid).toBe(true);
  });

  it("treats provider LIKE wildcards as literal text", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      source: "health_events",
      intent: "list",
      metric: null,
      aggregation: "count",
      groupBy: null,
      filters: { provider: "North_Clinic%\\" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain("ESCAPE '\\'");
    expect(result.parameters).toContain("%North\\_Clinic\\%\\\\%");
  });

  it("compiles weekly event count timeseries", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      source: "health_events",
      intent: "timeseries",
      metric: null,
      aggregation: "count",
      groupBy: "week"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/DATE_TRUNC\('week', occurred_at\)/i);
    expect(result.sql).toMatch(/COUNT\(\*\) AS count/i);
    expect(validateCompiledSql(result.sql).valid).toBe(true);
  });

  it("rejects unsupported health event filters", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      source: "health_events",
      intent: "count",
      metric: null,
      aggregation: "count",
      groupBy: null,
      filters: { priority: "high" }
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/do not support priority/i) });
  });
});

describe("compileQueryDSL — care_items", () => {
  it("compiles status counts with typed filters", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      source: "care_items",
      intent: "count",
      metric: null,
      aggregation: "count",
      groupBy: "status",
      filters: { priority: "high", completion: "incomplete" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/FROM v_ai_care_items/i);
    expect(result.sql).toContain("priority = ?");
    expect(result.parameters).toEqual(["high"]);
    expect(result.sql).toMatch(/completed_at IS NULL/i);
    expect(result.sql).not.toMatch(/due_start.*>=/i);
    expect(validateCompiledSql(result.sql).valid).toBe(true);
  });

  it("applies a due range only when explicitly requested", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      source: "care_items",
      intent: "list",
      metric: null,
      aggregation: "count",
      groupBy: null,
      filters: { dueWithinRange: true }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/due_start >= CAST\(\? AS TIMESTAMP\)/i);
  });

  it("compiles chartable due-bucket counts", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      source: "care_items",
      intent: "count",
      metric: null,
      aggregation: "count",
      groupBy: "due_bucket"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toMatch(/CASE WHEN.*AS due_bucket/i);
    expect(result.sql).not.toMatch(/WHERE\s+GROUP BY/i);
    expect(validateCompiledSql(result.sql).valid).toBe(true);
  });

  it("compiles overdue counts and rejects metric-style intents", () => {
    const overdue = compileQueryDSL({
      ...baseDsl,
      source: "care_items",
      intent: "overdue",
      metric: null,
      aggregation: "count",
      groupBy: null
    });
    expect(overdue.ok).toBe(true);
    if (overdue.ok) {
      expect(overdue.sql).toContain("status = 'open'");
      expect(overdue.sql).toMatch(/< CURRENT_DATE/i);
      expect(validateCompiledSql(overdue.sql).valid).toBe(true);
    }

    const unsupported = compileQueryDSL({ ...baseDsl, source: "care_items", intent: "latest", metric: null });
    expect(unsupported).toMatchObject({ ok: false, error: expect.stringMatching(/supports list, count, and overdue/i) });
  });
});

describe("compileQueryDSL — limit capping", () => {
  it("caps the limit at 200", () => {
    const result = compileQueryDSL({ ...baseDsl, limit: 999 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedLimit).toBe(200);
    expect(result.sql).toMatch(/LIMIT 200/);
  });
});

describe("compileQueryDSL — time-window capping", () => {
  it("caps a time window longer than 366 days", () => {
    const result = compileQueryDSL({
      ...baseDsl,
      timeRange: { start: "2020-01-01", end: "2026-01-01" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedTimeRange.label).toMatch(/capped at 366 days/);
  });
});

describe("compileQueryDSL — error paths", () => {
  it("returns an error for non-activity intent with null metric", () => {
    const result = compileQueryDSL({ ...baseDsl, intent: "timeseries", metric: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/metric is required/i);
  });
});

// ─── validateCompiledSql ────────────────────────────────────────────────────────

describe("validateCompiledSql — compiled output is always valid", () => {
  const intents: Array<QueryDSL["intent"]> = ["timeseries", "aggregation", "top_n", "latest"];
  for (const intent of intents) {
    it(`${intent} query passes validation`, () => {
      const dsl: QueryDSL = { ...baseDsl, intent, groupBy: intent === "aggregation" ? null : "day" };
      const compiled = compileQueryDSL(dsl);
      if (!compiled.ok) return;
      const validation = validateCompiledSql(compiled.sql);
      expect(validation.valid).toBe(true);
      expect(validation.violations).toHaveLength(0);
    });
  }
});

describe("validateCompiledSql — injection payloads", () => {
  const injections: Array<[string, string]> = [
    ["DROP TABLE", "DROP TABLE observations"],
    ["DELETE", "DELETE FROM observations WHERE 1=1"],
    ["semicolon", "SELECT * FROM v_daily_metrics; DROP TABLE observations"],
    ["ATTACH", "ATTACH DATABASE '/tmp/evil.db'"],
    ["PRAGMA", "PRAGMA table_info(observations)"],
    ["UPDATE", "UPDATE observations SET value=0"]
  ];

  for (const [name, sql] of injections) {
    it(`rejects SQL with ${name}`, () => {
      const result = validateCompiledSql(sql);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  }

  it("rejects SQL that does not start with SELECT", () => {
    const result = validateCompiledSql("INSERT INTO foo VALUES (1)");
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("SELECT"))).toBe(true);
  });

  it("keeps hostile filter values out of SQL and only in parameters", () => {
    const compiled = compileQueryDSL({
      ...baseDsl,
      source: "health_events",
      intent: "list",
      metric: null,
      aggregation: "count",
      groupBy: null,
      filters: { provider: "Clinic'; DROP TABLE health_events; --" }
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.sql).not.toContain("Clinic");
    expect(compiled.sql).not.toContain("DROP TABLE");
    expect(compiled.parameters).toContain("%Clinic'; DROP TABLE health\\_events; --%");
    expect(validateCompiledSql(compiled.sql)).toEqual({ valid: true, violations: [] });
  });
});
