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
  parameters: readonly QueryParameter[];
  resolvedTimeRange: { start: string; end: string; label: string };
  appliedLimit: number;
}

export type QueryParameter = string | number | boolean | null;

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

function sqlIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }
  return value;
}

function aggregationSql(agg: QueryDSL["aggregation"], column: string): string {
  const identifier = sqlIdentifier(column);
  switch (agg) {
    case "avg": return `AVG(${identifier})`;
    case "max": return `MAX(${identifier})`;
    case "min": return `MIN(${identifier})`;
    case "sum": return `SUM(${identifier})`;
    case "count": return `COUNT(*)`;
    case "latest": return `MAX(${identifier})`;
    default: return `AVG(${identifier})`;
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

  let statement: SqlStatement;
  const source = dsl.source ?? (dsl.intent === "list_activities" ? "activities" : "metrics");

  if (source === "health_events") {
    const outcome = buildHealthEventsSql(dsl, resolvedTime, limit, sortDir);
    if ("error" in outcome) return { ok: false, error: outcome.error };
    statement = outcome;
  } else if (source === "care_items") {
    const outcome = buildCareItemsSql(dsl, resolvedTime, limit, sortDir);
    if ("error" in outcome) return { ok: false, error: outcome.error };
    statement = outcome;
  } else if (source === "activities" && dsl.intent === "list_activities") {
    if (dsl.filters) return { ok: false, error: "Activity queries do not support domain filters." };
    statement = buildActivitiesSql(dsl, resolvedTime, limit, sortDir);
  } else if (source === "activities") {
    return { ok: false, error: `Source "activities" supports only the list_activities intent.` };
  } else if (dsl.intent === "list_activities") {
    return { ok: false, error: `Intent "list_activities" requires the activities source.` };
  } else if (dsl.filters) {
    return { ok: false, error: "Metric queries do not support health event or care item filters." };
  } else if (dsl.metric === null) {
    return { ok: false, error: "A metric is required for metric intents." };
  } else if (dsl.intent === "timeseries") {
    statement = buildTimeseriesSql(dsl, resolvedTime, limit, sortDir);
  } else if (dsl.intent === "aggregation") {
    statement = buildAggregationSql(dsl, resolvedTime, limit);
  } else if (dsl.intent === "top_n") {
    statement = buildTopNSql(dsl, resolvedTime, limit, sortDir);
  } else if (dsl.intent === "latest") {
    statement = buildLatestSql(dsl, resolvedTime);
  } else {
    return { ok: false, error: `Unsupported intent: ${String(dsl.intent)}` };
  }

  return { ok: true, ...statement, resolvedTimeRange: resolvedTime, appliedLimit: limit };
}

interface SqlStatement {
  sql: string;
  parameters: QueryParameter[];
}

function buildTimeseriesSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): SqlStatement {
  const parameters = [dsl.metric ?? "", time.start, time.end];
  const groupBy = dsl.groupBy ?? "day";
  const agg = dailyMetricAggregationSql(dsl.aggregation);

  if (groupBy === "week") {
    return { sql: [
      `SELECT DATE_TRUNC('week', day) AS week_start, ${agg} AS value, MIN(unit) AS unit`,
      `FROM v_daily_metrics`,
      `WHERE measurement_code = ?`,
      `  AND day >= CAST(? AS DATE)`,
      `  AND day <= CAST(? AS DATE)`,
      `GROUP BY DATE_TRUNC('week', day)`,
      `ORDER BY week_start ${sortDir}`,
      `LIMIT ${limit}`
    ].join("\n"), parameters };
  }

  if (groupBy === "month") {
    return { sql: [
      `SELECT DATE_TRUNC('month', day) AS month_start, ${agg} AS value, MIN(unit) AS unit`,
      `FROM v_daily_metrics`,
      `WHERE measurement_code = ?`,
      `  AND day >= CAST(? AS DATE)`,
      `  AND day <= CAST(? AS DATE)`,
      `GROUP BY DATE_TRUNC('month', day)`,
      `ORDER BY month_start ${sortDir}`,
      `LIMIT ${limit}`
    ].join("\n"), parameters };
  }

  // day (default)
  return { sql: [
    `SELECT day, ${agg} AS value, MIN(unit) AS unit`,
    `FROM v_daily_metrics`,
    `WHERE measurement_code = ?`,
    `  AND day >= CAST(? AS DATE)`,
    `  AND day <= CAST(? AS DATE)`,
    `GROUP BY day`,
    `ORDER BY day ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n"), parameters };
}

function buildAggregationSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  _limit: number
): SqlStatement {
  const agg = dailyMetricAggregationSql(dsl.aggregation);
  return { sql: [
    `SELECT ${agg} AS value, MIN(unit) AS unit`,
    `FROM v_daily_metrics`,
    `WHERE measurement_code = ?`,
    `  AND day >= CAST(? AS DATE)`,
    `  AND day <= CAST(? AS DATE)`,
    `LIMIT 1`
  ].join("\n"), parameters: [dsl.metric ?? "", time.start, time.end] };
}

function buildTopNSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): SqlStatement {
  const agg = dailyMetricAggregationSql(dsl.aggregation);
  return { sql: [
    `SELECT day, ${agg} AS value, MIN(unit) AS unit`,
    `FROM v_daily_metrics`,
    `WHERE measurement_code = ?`,
    `  AND day >= CAST(? AS DATE)`,
    `  AND day <= CAST(? AS DATE)`,
    `GROUP BY day`,
    `ORDER BY value ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n"), parameters: [dsl.metric ?? "", time.start, time.end] };
}

function buildLatestSql(
  dsl: QueryDSL,
  time: { start: string; end: string }
): SqlStatement {
  return { sql: [
    `SELECT day, avg_value AS value, unit`,
    `FROM v_daily_metrics`,
    `WHERE measurement_code = ?`,
    `  AND day >= CAST(? AS DATE)`,
    `  AND day <= CAST(? AS DATE)`,
    `ORDER BY day DESC`,
    `LIMIT 1`
  ].join("\n"), parameters: [dsl.metric ?? "", time.start, time.end] };
}

function buildActivitiesSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): SqlStatement {
  const parameters = [`${time.start} 00:00:00`, `${time.end} 23:59:59`];
  if (dsl.aggregation === "count") {
    return { sql: [
      `SELECT activity_type, COUNT(*) AS count`,
      `FROM activities`,
      `WHERE start_at >= CAST(? AS TIMESTAMP)`,
      `  AND start_at <= CAST(? AS TIMESTAMP)`,
      `GROUP BY activity_type`,
      `ORDER BY count ${sortDir}`,
      `LIMIT ${limit}`
    ].join("\n"), parameters };
  }
  return { sql: [
    `SELECT activity_type, start_at, end_at, duration_minutes, energy_kcal, distance_meters`,
    `FROM activities`,
    `WHERE start_at >= CAST(? AS TIMESTAMP)`,
    `  AND start_at <= CAST(? AS TIMESTAMP)`,
    `ORDER BY start_at ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n"), parameters };
}

function buildHealthEventsSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): SqlStatement | CompileError {
  const allowedIntents: Array<QueryDSL["intent"]> = ["list", "count", "latest", "timeseries"];
  if (!allowedIntents.includes(dsl.intent)) {
    return { error: `Source "health_events" supports list, count, latest, and timeseries intents.` };
  }
  if (dsl.filters?.status && !["completed", "entered-in-error"].includes(dsl.filters.status)) {
    return { error: `Health event status "${dsl.filters.status}" is unsupported.` };
  }
  if (dsl.filters?.kind && !["immunization", "medication", "other"].includes(dsl.filters.kind)) {
    return { error: `Health event kind "${dsl.filters.kind}" is unsupported.` };
  }
  if (dsl.filters?.priority || dsl.filters?.code || dsl.filters?.completion || dsl.filters?.dueWithinRange) {
    return { error: "Health event queries do not support priority, code, completion, or due-range filters." };
  }

  const where = healthEventWhere(dsl, time);
  if (dsl.intent === "list" || dsl.intent === "latest") {
    const appliedLimit = dsl.intent === "latest" ? 1 : limit;
    const appliedSort = dsl.intent === "latest" ? "DESC" : sortDir;
    return { sql: [
      "SELECT id, kind, status, occurred_at, source, provider, notes",
      "FROM v_ai_health_events",
      `WHERE ${where.clauses.join("\n  AND ")}`,
      `ORDER BY occurred_at ${appliedSort}`,
      `LIMIT ${appliedLimit}`
    ].join("\n"), parameters: where.parameters };
  }

  const groupBy = dsl.intent === "timeseries" ? (dsl.groupBy ?? "day") : dsl.groupBy;
  if (groupBy === null) {
    return { sql: [
      "SELECT COUNT(*) AS count",
      "FROM v_ai_health_events",
      `WHERE ${where.clauses.join("\n  AND ")}`,
      "LIMIT 1"
    ].join("\n"), parameters: where.parameters };
  }

  const group = healthEventGroup(groupBy);
  if (!group) {
    return { error: `Health event counts support grouping by day, week, kind, status, or source.` };
  }
  return { sql: [
    `SELECT ${group.expression} AS ${group.alias}, COUNT(*) AS count`,
    "FROM v_ai_health_events",
    `WHERE ${where.clauses.join("\n  AND ")}`,
    `GROUP BY ${group.expression}`,
    `ORDER BY ${group.alias} ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n"), parameters: where.parameters };
}

function healthEventWhere(dsl: QueryDSL, time: { start: string; end: string }): SqlWhere {
  const clauses = [
    `occurred_at >= CAST(? AS TIMESTAMP)`,
    `occurred_at <= CAST(? AS TIMESTAMP)`
  ];
  const parameters: QueryParameter[] = [`${time.start} 00:00:00`, `${time.end} 23:59:59`];
  const filters = dsl.filters;
  if (filters?.kind) { clauses.push("kind = ?"); parameters.push(filters.kind); }
  if (filters?.status) { clauses.push("status = ?"); parameters.push(filters.status); }
  if (filters?.source) { clauses.push("source = ?"); parameters.push(filters.source); }
  if (filters?.provider) {
    clauses.push("LOWER(COALESCE(provider, '')) LIKE LOWER(?)");
    parameters.push(`%${filters.provider}%`);
  }
  return { clauses, parameters };
}

interface SqlWhere {
  clauses: string[];
  parameters: QueryParameter[];
}

function healthEventGroup(groupBy: QueryDSL["groupBy"]): { expression: string; alias: string } | null {
  switch (groupBy) {
    case "day": return { expression: "DATE(occurred_at)", alias: "day" };
    case "week": return { expression: "DATE_TRUNC('week', occurred_at)", alias: "week_start" };
    case "kind":
    case "status":
    case "source":
      return { expression: sqlIdentifier(groupBy), alias: sqlIdentifier(groupBy) };
    default:
      return null;
  }
}

function buildCareItemsSql(
  dsl: QueryDSL,
  time: { start: string; end: string },
  limit: number,
  sortDir: string
): SqlStatement | CompileError {
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
    where.clauses.push("status = 'open'", "due_start < CURRENT_DATE");
  }
  if (dsl.intent === "list") {
    return { sql: [
      "SELECT id, kind, code, title, due_start, priority, status, completed_at, notes",
      "FROM v_ai_care_items",
      careItemWhereSql(where.clauses),
      `ORDER BY due_start ${sortDir}`,
      `LIMIT ${limit}`
    ].join("\n"), parameters: where.parameters };
  }

  if (dsl.intent === "overdue" || dsl.groupBy === null) {
    return { sql: [
      "SELECT COUNT(*) AS count",
      "FROM v_ai_care_items",
      careItemWhereSql(where.clauses),
      "LIMIT 1"
    ].join("\n"), parameters: where.parameters };
  }

  const group = careItemGroup(dsl.groupBy);
  if (!group) {
    return { error: "Care item counts support grouping by status, priority, kind, or due_bucket." };
  }
  return { sql: [
    `SELECT ${group.expression} AS ${group.alias}, COUNT(*) AS count`,
    "FROM v_ai_care_items",
    careItemWhereSql(where.clauses),
    `GROUP BY ${group.expression}`,
    `ORDER BY ${group.alias} ${sortDir}`,
    `LIMIT ${limit}`
  ].join("\n"), parameters: where.parameters };
}

function careItemWhere(
  dsl: QueryDSL,
  time: { start: string; end: string },
  includeDueRange: boolean
): SqlWhere {
  const due = "due_start";
  const clauses = includeDueRange
    ? [
        `${due} >= CAST(? AS TIMESTAMP)`,
        `${due} <= CAST(? AS TIMESTAMP)`
      ]
    : [];
  const parameters: QueryParameter[] = includeDueRange
    ? [`${time.start} 00:00:00`, `${time.end} 23:59:59`]
    : [];
  const filters = dsl.filters;
  if (filters?.kind) { clauses.push("kind = ?"); parameters.push(filters.kind); }
  if (filters?.code) { clauses.push("code = ?"); parameters.push(filters.code); }
  if (filters?.status) { clauses.push("status = ?"); parameters.push(filters.status); }
  if (filters?.priority) { clauses.push("priority = ?"); parameters.push(filters.priority); }
  if (filters?.completion === "completed") clauses.push("completed_at IS NOT NULL");
  if (filters?.completion === "incomplete") clauses.push("completed_at IS NULL");
  return { clauses, parameters };
}

function careItemWhereSql(clauses: string[]): string {
  return clauses.length > 0 ? `WHERE ${clauses.join("\n  AND ")}` : "";
}

function careItemGroup(groupBy: QueryDSL["groupBy"]): { expression: string; alias: string } | null {
  if (groupBy === "status" || groupBy === "priority" || groupBy === "kind") {
    return { expression: sqlIdentifier(groupBy), alias: sqlIdentifier(groupBy) };
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
