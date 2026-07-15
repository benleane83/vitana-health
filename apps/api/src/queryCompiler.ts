import type { QueryDSL } from "./aiQueryPlanner.js";
import { resolveTimeRange } from "./aiQueryPlanner.js";

// ─── Whitelist ─────────────────────────────────────────────────────────────────

const ALLOWED_TABLES = new Set(["v_daily_metrics", "v_weekly_metrics", "activities"]);

const ALLOWED_COLUMNS = new Set([
  // v_daily_metrics
  "day",
  "measurement_code",
  "avg_value",
  "min_value",
  "max_value",
  "n",
  "unit",
  // v_weekly_metrics
  "week_start",
  // activities
  "id",
  "activity_type",
  "start_at",
  "end_at",
  "duration_minutes",
  "energy_kcal",
  "distance_meters",
  "source_id"
]);

const ALLOWED_OUTPUT_ALIASES = new Set(["value", "count", "month_start"]);

// DuckDB SQL keywords and functions that we allow to appear in compiler output.
// This set is used only by the validator to avoid blocking our own generated SQL.
const ALLOWED_SQL_TOKENS = new Set([
  "select",
  "from",
  "where",
  "and",
  "or",
  "not",
  "in",
  "order",
  "by",
  "group",
  "having",
  "limit",
  "offset",
  "distinct",
  "as",
  "union",
  "all",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "date_trunc",
  "date",
  "timestamp",
  "interval",
  "current_date",
  "cast",
  "coalesce",
  "null",
  "is",
  "between",
  "like",
  "trim",
  "lower",
  "upper",
  "case",
  "when",
  "then",
  "else",
  "end",
  "asc",
  "desc",
  "left",
  "right",
  "inner",
  "outer",
  "join",
  "on",
  "true",
  "false",
  "integer",
  "varchar",
  "double"
]);

// Tokens that must never appear (indicates SQL injection or dangerous operations).
const DISALLOWED_TOKENS = [
  /\bdrop\b/i,
  /\bdelete\b/i,
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bcreate\b/i,
  /\balter\b/i,
  /\bpragma\b/i,
  /\bexec\b/i,
  /\bexecute\b/i,
  /\battach\b/i,
  /\bdetach\b/i,
  /\bcopy\b/i,
  /\bexport\b/i,
  /\bimport\b/i,
  /\bload\b/i,
  /\binstall\b/i,
  /\bset\b/i,
  /\bcall\b/i,
  /\bxp_/i,
  /;/
];

// ─── Mandatory caps ────────────────────────────────────────────────────────────

/** Maximum row limit enforced regardless of DSL request. */
const MAX_ROW_LIMIT = 200;

/** Maximum allowed time window in days for analytics queries. */
const MAX_TIME_WINDOW_DAYS = 366;

// ─── Compile result ────────────────────────────────────────────────────────────

export interface CompileResult {
  sql: string;
  resolvedTimeRange: { start: string; end: string; label: string };
  appliedLimit: number;
}

export interface CompileError {
  error: string;
}

export type CompileOutcome = { ok: true } & CompileResult | { ok: false } & CompileError;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function capLimit(requested: number): number {
  return Math.min(requested, MAX_ROW_LIMIT);
}

function sanitizeIdentifier(value: string): string {
  // Strip all characters that are not alphanumeric, underscores, hyphens, or dots.
  // Metric codes in the registry only use these characters (e.g. "heart_rate", "hrv_rmssd").
  // Any other character would indicate an unexpected/injected value and is dropped defensively.
  return value.replace(/[^a-zA-Z0-9_\-.]/g, "");
}

function aggregationSql(agg: QueryDSL["aggregation"], column: string): string {
  switch (agg) {
    case "avg": return `AVG(${column})`;
    case "max": return `MAX(${column})`;
    case "min": return `MIN(${column})`;
    case "sum": return `SUM(${column})`;
    case "count": return `COUNT(*)`;
    case "latest": return `MAX(${column})`;
    default: return `AVG(${column})`;
  }
}

function dailyMetricAggregationSql(agg: QueryDSL["aggregation"]): string {
  switch (agg) {
    case "min": return "MIN(min_value)";
    case "max": return "MAX(max_value)";
    default: return aggregationSql(agg, "avg_value");
  }
}

// ─── Compiler ─────────────────────────────────────────────────────────────────

export function compileQueryDSL(dsl: QueryDSL): CompileOutcome {
  const resolvedTime = resolveTimeRange(dsl.timeRange);

  // Enforce max time window
  const startDate = new Date(resolvedTime.start);
  const endDate = new Date(resolvedTime.end);
  const windowDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  if (windowDays > MAX_TIME_WINDOW_DAYS) {
    const cappedStart = new Date(endDate);
    cappedStart.setDate(cappedStart.getDate() - MAX_TIME_WINDOW_DAYS);
    resolvedTime.start = cappedStart.toISOString().slice(0, 10);
    resolvedTime.label = `${resolvedTime.label} (capped at ${MAX_TIME_WINDOW_DAYS} days)`;
  }

  const limit = capLimit(dsl.limit);
  const sortDir = dsl.sort === "asc" ? "ASC" : "DESC";

  let sql: string;

  if (dsl.intent === "list_activities") {
    sql = buildActivitiesSql(dsl, resolvedTime, limit, sortDir);
  } else if (dsl.metric === null) {
    return { ok: false, error: "A metric is required for non-activity intents." };
  } else if (dsl.intent === "timeseries") {
    sql = buildTimeseriesSql(dsl, resolvedTime, limit, sortDir);
  } else if (dsl.intent === "aggregation") {
    sql = buildAggregationSql(dsl, resolvedTime, limit);
  } else if (dsl.intent === "top_n") {
    sql = buildTopNSql(dsl, resolvedTime, limit, sortDir);
  } else if (dsl.intent === "latest") {
    sql = buildLatestSql(dsl, resolvedTime);
  } else {
    return { ok: false, error: `Unsupported intent: ${String(dsl.intent)}` };
  }

  return { ok: true, sql, resolvedTimeRange: resolvedTime, appliedLimit: limit };
}

function buildTimeseriesSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): string {
  const metric = sanitizeIdentifier(dsl.metric ?? "");
  const groupBy = dsl.groupBy ?? "day";
  const agg = dailyMetricAggregationSql(dsl.aggregation);

  if (groupBy === "week") {
    return [
      `SELECT DATE_TRUNC('week', day) AS week_start, ${agg} AS value, MIN(unit) AS unit`,
      `FROM v_daily_metrics`,
      `WHERE measurement_code = '${metric}'`,
      `  AND day >= DATE '${time.start}'`,
      `  AND day <= DATE '${time.end}'`,
      `GROUP BY DATE_TRUNC('week', day)`,
      `ORDER BY week_start ${sortDir}`,
      `LIMIT ${limit}`
    ].join("\n");
  }

  if (groupBy === "month") {
    return [
      `SELECT DATE_TRUNC('month', day) AS month_start, ${agg} AS value, MIN(unit) AS unit`,
      `FROM v_daily_metrics`,
      `WHERE measurement_code = '${metric}'`,
      `  AND day >= DATE '${time.start}'`,
      `  AND day <= DATE '${time.end}'`,
      `GROUP BY DATE_TRUNC('month', day)`,
      `ORDER BY month_start ${sortDir}`,
      `LIMIT ${limit}`
    ].join("\n");
  }

  // day (default)
  return [
    `SELECT day, ${agg} AS value, MIN(unit) AS unit`,
    `FROM v_daily_metrics`,
    `WHERE measurement_code = '${metric}'`,
    `  AND day >= DATE '${time.start}'`,
    `  AND day <= DATE '${time.end}'`,
    `GROUP BY day`,
    `ORDER BY day ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n");
}

function buildAggregationSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  _limit: number
): string {
  const metric = sanitizeIdentifier(dsl.metric ?? "");
  const agg = dailyMetricAggregationSql(dsl.aggregation);
  return [
    `SELECT ${agg} AS value, MIN(unit) AS unit`,
    `FROM v_daily_metrics`,
    `WHERE measurement_code = '${metric}'`,
    `  AND day >= DATE '${time.start}'`,
    `  AND day <= DATE '${time.end}'`,
    `LIMIT 1`
  ].join("\n");
}

function buildTopNSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): string {
  const metric = sanitizeIdentifier(dsl.metric ?? "");
  const agg = dailyMetricAggregationSql(dsl.aggregation);
  return [
    `SELECT day, ${agg} AS value, MIN(unit) AS unit`,
    `FROM v_daily_metrics`,
    `WHERE measurement_code = '${metric}'`,
    `  AND day >= DATE '${time.start}'`,
    `  AND day <= DATE '${time.end}'`,
    `GROUP BY day`,
    `ORDER BY value ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n");
}

function buildLatestSql(
  dsl: QueryDSL,
  time: { start: string; end: string }
): string {
  const metric = sanitizeIdentifier(dsl.metric ?? "");
  return [
    `SELECT day, avg_value AS value, unit`,
    `FROM v_daily_metrics`,
    `WHERE measurement_code = '${metric}'`,
    `  AND day >= DATE '${time.start}'`,
    `  AND day <= DATE '${time.end}'`,
    `ORDER BY day DESC`,
    `LIMIT 1`
  ].join("\n");
}

function buildActivitiesSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): string {
  if (dsl.aggregation === "count") {
    return [
      `SELECT activity_type, COUNT(*) AS count`,
      `FROM activities`,
      `WHERE start_at >= TIMESTAMP '${time.start} 00:00:00'`,
      `  AND start_at <= TIMESTAMP '${time.end} 23:59:59'`,
      `GROUP BY activity_type`,
      `ORDER BY count ${sortDir}`,
      `LIMIT ${limit}`
    ].join("\n");
  }
  return [
    `SELECT activity_type, start_at, end_at, duration_minutes, energy_kcal, distance_meters`,
    `FROM activities`,
    `WHERE start_at >= TIMESTAMP '${time.start} 00:00:00'`,
    `  AND start_at <= TIMESTAMP '${time.end} 23:59:59'`,
    `ORDER BY start_at ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n");
}

// ─── SQL Validator ─────────────────────────────────────────────────────────────

export interface SqlValidationResult {
  valid: boolean;
  violations: string[];
}

export function validateCompiledSql(sql: string): SqlValidationResult {
  const violations: string[] = [];
  const lower = sql.toLowerCase();

  // Must start with SELECT
  if (!/^\s*select\b/i.test(sql)) {
    violations.push("SQL must begin with SELECT.");
  }

  // Check for disallowed tokens
  for (const pattern of DISALLOWED_TOKENS) {
    if (pattern.test(lower)) {
      violations.push(`Disallowed token matched: ${pattern.toString()}`);
    }
  }

  // Check that all identifiers (bare words) are either allowed SQL tokens,
  // whitelisted table/column names, number literals, or quoted strings.
  // Extract word tokens (skip quoted strings and date literals).
  const withoutStrings = sql.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  const wordTokens = withoutStrings.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) ?? [];
  for (const token of wordTokens) {
    const t = token.toLowerCase();
    if (!ALLOWED_SQL_TOKENS.has(t) && !ALLOWED_TABLES.has(t) && !ALLOWED_COLUMNS.has(t) && !ALLOWED_OUTPUT_ALIASES.has(t)) {
      violations.push(`Non-whitelisted identifier: ${token}`);
    }
  }

  return { valid: violations.length === 0, violations };
}

export interface AnalyticsQueryCompiler {
  readonly dialect: "duckdb" | "sqlite";
  compile(dsl: QueryDSL): CompileOutcome;
  validate(sql: string): SqlValidationResult;
}

export const duckDbAnalyticsQueryCompiler: AnalyticsQueryCompiler = {
  dialect: "duckdb",
  compile: compileQueryDSL,
  validate: validateCompiledSql
};
