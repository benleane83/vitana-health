import type { QueryDSL } from "./aiQueryPlanner.js";
import { resolveTimeRange } from "./aiQueryPlanner.js";

// ─── Whitelist ─────────────────────────────────────────────────────────────────

const ALLOWED_TABLES = new Set([
  "v_daily_metrics",
  "v_weekly_metrics",
  "activities",
  "v_ai_health_events",
  "v_ai_care_items"
]);

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
  "source_id",
  // AI care/event views
  "kind",
  "status",
  "occurred_at",
  "source",
  "provider",
  "notes",
  "code",
  "title",
  "due_start",
  "priority",
  "completed_at"
]);

const ALLOWED_OUTPUT_ALIASES = new Set(["value", "count", "month_start", "due_bucket"]);

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
  /--/,
  /\/\*/,
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

export type AnalyticsSqlDialect = "duckdb" | "sqlite";

/**
 * A compiled plan, not a bare SQL string.
 *
 * The SQL is dialect-specific - `date_trunc`, `EXCLUDE`, and the interval syntax all differ - so
 * carrying the dialect with it lets the store that executes it refuse a plan compiled for a
 * different engine. Passing a string instead made that mismatch unrepresentable, which is exactly
 * the failure mode a SQLite backend would introduce.
 */
export interface CompiledQuery extends CompileResult {
  readonly dialect: AnalyticsSqlDialect;
}

export type CompiledQueryOutcome = { ok: true } & CompiledQuery | { ok: false } & CompileError;

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

function sqlString(value: string): string {
  return value.replace(/'/g, "''");
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
  const source = dsl.source ?? (dsl.intent === "list_activities" ? "activities" : "metrics");

  if (source === "health_events") {
    const outcome = buildHealthEventsSql(dsl, resolvedTime, limit, sortDir);
    if (typeof outcome !== "string") return { ok: false, error: outcome.error };
    sql = outcome;
  } else if (source === "care_items") {
    const outcome = buildCareItemsSql(dsl, resolvedTime, limit, sortDir);
    if (typeof outcome !== "string") return { ok: false, error: outcome.error };
    sql = outcome;
  } else if (source === "activities" && dsl.intent === "list_activities") {
    if (dsl.filters) return { ok: false, error: "Activity queries do not support domain filters." };
    sql = buildActivitiesSql(dsl, resolvedTime, limit, sortDir);
  } else if (source === "activities") {
    return { ok: false, error: `Source "activities" supports only the list_activities intent.` };
  } else if (dsl.intent === "list_activities") {
    return { ok: false, error: `Intent "list_activities" requires the activities source.` };
  } else if (dsl.filters) {
    return { ok: false, error: "Metric queries do not support health event or care item filters." };
  } else if (dsl.metric === null) {
    return { ok: false, error: "A metric is required for metric intents." };
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

function buildHealthEventsSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): string | CompileError {
  const allowedIntents: Array<QueryDSL["intent"]> = ["list", "count", "latest", "timeseries"];
  if (!allowedIntents.includes(dsl.intent)) {
    return { error: `Source "health_events" supports list, count, latest, and timeseries intents.` };
  }
  if (dsl.filters?.status && !["completed", "entered-in-error"].includes(dsl.filters.status)) {
    return { error: `Health event status "${dsl.filters.status}" is unsupported.` };
  }
  if (dsl.filters?.kind && !["immunization", "medication-administration", "other"].includes(dsl.filters.kind)) {
    return { error: `Health event kind "${dsl.filters.kind}" is unsupported.` };
  }
  if (dsl.filters?.priority || dsl.filters?.code || dsl.filters?.completion || dsl.filters?.dueWithinRange) {
    return { error: "Health event queries do not support priority, code, completion, or due-range filters." };
  }

  const where = healthEventWhere(dsl, time);
  if (dsl.intent === "list" || dsl.intent === "latest") {
    const appliedLimit = dsl.intent === "latest" ? 1 : limit;
    const appliedSort = dsl.intent === "latest" ? "DESC" : sortDir;
    return [
      "SELECT id, kind, status, occurred_at, source, provider, notes",
      "FROM v_ai_health_events",
      `WHERE ${where.join("\n  AND ")}`,
      `ORDER BY occurred_at ${appliedSort}`,
      `LIMIT ${appliedLimit}`
    ].join("\n");
  }

  const groupBy = dsl.intent === "timeseries" ? (dsl.groupBy ?? "day") : dsl.groupBy;
  if (groupBy === null) {
    return [
      "SELECT COUNT(*) AS count",
      "FROM v_ai_health_events",
      `WHERE ${where.join("\n  AND ")}`,
      "LIMIT 1"
    ].join("\n");
  }

  const group = healthEventGroup(groupBy);
  if (!group) {
    return { error: `Health event counts support grouping by day, week, kind, status, or source.` };
  }
  return [
    `SELECT ${group.expression} AS ${group.alias}, COUNT(*) AS count`,
    "FROM v_ai_health_events",
    `WHERE ${where.join("\n  AND ")}`,
    `GROUP BY ${group.expression}`,
    `ORDER BY ${group.alias} ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n");
}

function healthEventWhere(dsl: QueryDSL, time: { start: string; end: string }): string[] {
  const clauses = [
    `occurred_at >= TIMESTAMP '${time.start} 00:00:00'`,
    `occurred_at <= TIMESTAMP '${time.end} 23:59:59'`
  ];
  const filters = dsl.filters;
  if (filters?.kind) clauses.push(`kind = '${sqlString(filters.kind)}'`);
  if (filters?.status) clauses.push(`status = '${filters.status}'`);
  if (filters?.source) clauses.push(`source = '${filters.source}'`);
  if (filters?.provider) {
    clauses.push(`LOWER(COALESCE(provider, '')) LIKE LOWER('%${sqlString(filters.provider)}%')`);
  }
  return clauses;
}

function healthEventGroup(groupBy: QueryDSL["groupBy"]): { expression: string; alias: string } | null {
  switch (groupBy) {
    case "day": return { expression: "DATE(occurred_at)", alias: "day" };
    case "week": return { expression: "DATE_TRUNC('week', occurred_at)", alias: "week_start" };
    case "kind":
    case "status":
    case "source":
      return { expression: groupBy, alias: groupBy };
    default:
      return null;
  }
}

function buildCareItemsSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): string | CompileError {
  const allowedIntents: Array<QueryDSL["intent"]> = ["list", "count", "overdue"];
  if (!allowedIntents.includes(dsl.intent)) {
    return { error: `Source "care_items" supports list, count, and overdue intents.` };
  }
  if (dsl.filters?.status && !["open", "completed", "cancelled", "skipped"].includes(dsl.filters.status)) {
    return { error: `Care item status "${dsl.filters.status}" is unsupported.` };
  }
  if (dsl.filters?.source || dsl.filters?.provider) {
    return { error: "Care item queries do not support source or provider filters." };
  }
  if (dsl.intent === "overdue" && dsl.filters?.status && dsl.filters.status !== "open") {
    return { error: "Overdue care item queries only support open status." };
  }

  const where = careItemWhere(dsl, time, dsl.intent !== "overdue" && dsl.filters?.dueWithinRange === true);
  if (dsl.intent === "overdue") {
    where.push("status = 'open'", "due_start < CURRENT_DATE");
  }
  if (dsl.intent === "list") {
    return [
      "SELECT id, kind, code, title, due_start, priority, status, completed_at, notes",
      "FROM v_ai_care_items",
      careItemWhereSql(where),
      `ORDER BY due_start ${sortDir}`,
      `LIMIT ${limit}`
    ].join("\n");
  }

  if (dsl.intent === "overdue" || dsl.groupBy === null) {
    return [
      "SELECT COUNT(*) AS count",
      "FROM v_ai_care_items",
      careItemWhereSql(where),
      "LIMIT 1"
    ].join("\n");
  }

  const group = careItemGroup(dsl.groupBy);
  if (!group) {
    return { error: "Care item counts support grouping by status, priority, kind, or due_bucket." };
  }
  return [
    `SELECT ${group.expression} AS ${group.alias}, COUNT(*) AS count`,
    "FROM v_ai_care_items",
    careItemWhereSql(where),
    `GROUP BY ${group.expression}`,
    `ORDER BY ${group.alias} ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n");
}

function careItemWhere(
  dsl: QueryDSL,
  time: { start: string; end: string },
  includeDueRange: boolean
): string[] {
  const due = "due_start";
  const clauses = includeDueRange
    ? [
        `${due} >= TIMESTAMP '${time.start} 00:00:00'`,
        `${due} <= TIMESTAMP '${time.end} 23:59:59'`
      ]
    : [];
  const filters = dsl.filters;
  if (filters?.kind) clauses.push(`kind = '${sqlString(filters.kind)}'`);
  if (filters?.code) clauses.push(`code = '${sqlString(filters.code)}'`);
  if (filters?.status) clauses.push(`status = '${filters.status}'`);
  if (filters?.priority) clauses.push(`priority = '${filters.priority}'`);
  if (filters?.completion === "completed") clauses.push("completed_at IS NOT NULL");
  if (filters?.completion === "incomplete") clauses.push("completed_at IS NULL");
  return clauses;
}

function careItemWhereSql(clauses: string[]): string {
  return clauses.length > 0 ? `WHERE ${clauses.join("\n  AND ")}` : "";
}

function careItemGroup(groupBy: QueryDSL["groupBy"]): { expression: string; alias: string } | null {
  if (groupBy === "status" || groupBy === "priority" || groupBy === "kind") {
    return { expression: groupBy, alias: groupBy };
  }
  if (groupBy === "due_bucket") {
    return {
      expression: "CASE WHEN due_start IS NULL THEN 'unscheduled' " +
        "WHEN due_start < CURRENT_DATE THEN 'overdue' " +
        "WHEN due_start <= CURRENT_DATE + INTERVAL '7 days' THEN 'next_7_days' ELSE 'later' END",
      alias: "due_bucket"
    };
  }
  return null;
}

// ─── SQL Validator ─────────────────────────────────────────────────────────────

export interface SqlValidationResult {
  valid: boolean;
  violations: string[];
}

export function validateCompiledSql(sql: string): SqlValidationResult {
  const violations: string[] = [];
  const withoutStrings = sql.replace(/'(?:''|[^'])*'/g, "''").replace(/"[^"]*"/g, '""');
  const lower = withoutStrings.toLowerCase();

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
  readonly dialect: AnalyticsSqlDialect;
  compile(dsl: QueryDSL): CompiledQueryOutcome;
  validate(sql: string): SqlValidationResult;
}

export const duckDbAnalyticsQueryCompiler: AnalyticsQueryCompiler = {
  dialect: "duckdb",
  compile: (dsl) => {
    const outcome = compileQueryDSL(dsl);
    return outcome.ok ? { ...outcome, dialect: "duckdb" } : outcome;
  },
  validate: validateCompiledSql
};
