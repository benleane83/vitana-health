import type duckdb from "duckdb";
import {
  resolveReferenceRange,
  type HealthDataChartSeries,
  type HealthDataChartSeriesOptions,
  type HealthDataChartSeriesPoint,
  type MeasurementType,
  type PersonalReferenceRange,
  type Profile
} from "@vitana/shared";
import { selectColumns } from "./duckdbColumns.js";
import {
  all,
  allWithParams,
  isoTimestamp,
  measurementTypeFromRow,
  optionalNumber,
  personalReferenceRangeFromRow
} from "./duckdbRows.js";

const measurementTypeColumns = selectColumns("measurement_types", { excludeOrdinal: true });
const maxRawChartPoints = 500;
const maxDailyChartBuckets = 366;
const maxAggregatedChartBuckets = 1000;

export async function measurementChartSeries(
  connection: duckdb.Connection,
  measurementCode: string,
  options: HealthDataChartSeriesOptions
): Promise<HealthDataChartSeries> {
  const [typeRows, profileRows, personalRows] = await Promise.all([
    allWithParams(connection, `SELECT ${measurementTypeColumns} FROM measurement_types WHERE code = ?;`, measurementCode),
    all(connection, "SELECT subject_kind FROM profile;"),
    allWithParams(connection, "SELECT * FROM personal_reference_ranges WHERE measurement_code = ?;", measurementCode)
  ]);
  const type = typeRows[0] ? measurementTypeFromRow(typeRows[0]) : undefined;
  const personalRange = personalRows[0] ? personalReferenceRangeFromRow(personalRows[0]) : undefined;
  const subjectKind = String(profileRows[0]?.subject_kind ?? "adult") as NonNullable<Profile["subjectKind"]>;
  const aggregation = type?.aggregation ?? "none";
  const cutoff = chartRangeCutoff(options.range);

  if (options.mode === "raw" || (aggregation !== "sum" && aggregation !== "average")) {
    const [totalRows, rows] = await Promise.all([
      chartEntryCount(connection, measurementCode, cutoff),
      rawChartPoints(connection, measurementCode, cutoff)
    ]);
    const totalPoints = Number(totalRows[0]?.total ?? 0);
    const truncated = rows.length > maxRawChartPoints;
    const points = (truncated ? rows.slice(0, maxRawChartPoints) : rows)
      .reverse()
      .map((row) => chartPointFromRow(row, type, personalRange, subjectKind));
    return {
      generatedAt: new Date().toISOString(),
      measurementCode,
      range: options.range,
      requestedMode: options.mode,
      granularity: "raw",
      aggregation,
      points,
      totalPoints,
      truncated
    };
  }

  const dailyRows = await aggregateChartPoints(connection, measurementCode, cutoff, "day", aggregation);
  const useWeeklyBuckets = options.range === "all" && dailyRows.length > maxDailyChartBuckets;
  const rows = useWeeklyBuckets
    ? await aggregateChartPoints(connection, measurementCode, cutoff, "week", aggregation)
    : dailyRows;
  const truncatedBuckets = rows.length > maxAggregatedChartBuckets;
  const visibleRows = truncatedBuckets ? rows.slice(rows.length - maxAggregatedChartBuckets) : rows;
  return {
    generatedAt: new Date().toISOString(),
    measurementCode,
    range: options.range,
    requestedMode: options.mode,
    granularity: useWeeklyBuckets ? "weekly" : "daily",
    aggregation,
    points: visibleRows.map((row) => chartPointFromRow(row, type, personalRange, subjectKind)),
    totalPoints: rows.length,
    truncated: truncatedBuckets
  };
}

async function chartEntryCount(connection: duckdb.Connection, measurementCode: string, cutoff?: string) {
  const range = chartRangeSql(cutoff);
  return allWithParams(connection, `WITH chart_entries AS (${chartEntriesSql()})
      SELECT COUNT(*) AS total FROM chart_entries ${range.clause};`,
    measurementCode, measurementCode, measurementCode, measurementCode, ...range.params);
}

async function rawChartPoints(connection: duckdb.Connection, measurementCode: string, cutoff?: string) {
  const range = chartRangeSql(cutoff);
  return allWithParams(connection, `WITH chart_entries AS (${chartEntriesSql()})
      SELECT measured_at AS bucket, value, unit, weight AS count, min_value, max_value
      FROM chart_entries ${range.clause}
      ORDER BY measured_at DESC, id DESC
      LIMIT ?;`,
    measurementCode, measurementCode, measurementCode, measurementCode, ...range.params, maxRawChartPoints + 1);
}

async function aggregateChartPoints(
  connection: duckdb.Connection,
  measurementCode: string,
  cutoff: string | undefined,
  bucket: "day" | "week",
  aggregation: "sum" | "average"
) {
  const range = chartRangeSql(cutoff);
  const aggregate = aggregation === "sum" ? "SUM(value)" : "SUM(value * weight) / SUM(weight)";
  return allWithParams(connection, `WITH chart_entries AS (${chartEntriesSql()})
      SELECT DATE_TRUNC('${bucket}', measured_at) AS bucket, ${aggregate} AS value,
        MIN(unit) AS unit, SUM(weight) AS count, MIN(min_value) AS min_value, MAX(max_value) AS max_value
      FROM chart_entries ${range.clause}
      GROUP BY DATE_TRUNC('${bucket}', measured_at)
      ORDER BY bucket;`,
    measurementCode, measurementCode, measurementCode, measurementCode, ...range.params);
}

export function chartEntriesSql(codePredicate = "= ?"): string {
  return `
    SELECT o.id, o.measurement_code, o.observed_at AS measured_at, o.value, o.unit, 1 AS weight,
      o.value AS min_value, o.value AS max_value,
      TRY_CAST(json_extract_string(o.source_json, '$.calendarDate') AS DATE) AS calendar_date,
      COALESCE(s.label, s.source_kind, o.source_id) AS source_label
    FROM observations o LEFT JOIN sources s ON s.id = o.source_id
    WHERE o.measurement_code ${codePredicate}
    UNION ALL
    SELECT t.id, t.measurement_code,
      CASE WHEN json_extract_string(t.source_json, '$.aggregation') = 'health-connect-daily'
        THEN COALESCE(TRY_CAST(json_extract_string(t.source_json, '$.calendarDate') AS TIMESTAMP), t.end_at)
        ELSE t.end_at END AS measured_at,
      t.value, t.unit, 1 AS weight, t.value AS min_value, t.value AS max_value,
      TRY_CAST(json_extract_string(t.source_json, '$.calendarDate') AS DATE) AS calendar_date,
      COALESCE(s.label, s.source_kind, t.source_id) AS source_label
    FROM time_series_samples t LEFT JOIN sources s ON s.id = t.source_id
    WHERE t.measurement_code ${codePredicate}
    UNION ALL
    SELECT a.id, a.measurement_code, a.end_at AS measured_at, a.average AS value, a.unit,
      a.measurement_count AS weight, a.minimum AS min_value, a.maximum AS max_value,
      a.calendar_date, COALESCE(s.label, s.source_kind, a.source_id) AS source_label
    FROM measurement_aggregates a LEFT JOIN sources s ON s.id = a.source_id
    WHERE a.measurement_code ${codePredicate} AND (
      a.granularity = '15m' OR (
        a.granularity = 'day' AND a.end_at <= COALESCE((
          SELECT MIN(recent.start_at) FROM measurement_aggregates recent
          WHERE recent.measurement_code = a.measurement_code AND recent.granularity = '15m'
        ), TIMESTAMPTZ 'infinity')
      )
    )
    UNION ALL
    SELECT a.id, 'activity_sessions' AS measurement_code, COALESCE(a.end_at, a.start_at) AS measured_at,
      COALESCE(a.duration_minutes, DATE_DIFF('minute', a.start_at, COALESCE(a.end_at, a.start_at))) AS value,
      'min' AS unit, 1 AS weight,
      COALESCE(a.duration_minutes, DATE_DIFF('minute', a.start_at, COALESCE(a.end_at, a.start_at))) AS min_value,
      COALESCE(a.duration_minutes, DATE_DIFF('minute', a.start_at, COALESCE(a.end_at, a.start_at))) AS max_value,
      NULL::DATE AS calendar_date, COALESCE(s.label, s.source_kind, a.source_id) AS source_label
    FROM activities a LEFT JOIN sources s ON s.id = a.source_id
    WHERE 'activity_sessions' ${codePredicate}`;
}

function chartRangeSql(cutoff?: string): { clause: string; params: string[] } {
  return cutoff ? { clause: "WHERE measured_at >= ?", params: [cutoff] } : { clause: "", params: [] };
}

export function chartRangeCutoff(range: HealthDataChartSeriesOptions["range"]): string | undefined {
  if (range === "all") return undefined;
  const cutoff = new Date();
  if (range === "1y") cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  else if (range === "3m") cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
  else cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  return cutoff.toISOString();
}

function chartPointFromRow(
  row: Record<string, unknown>,
  type: MeasurementType | undefined,
  personalRange: PersonalReferenceRange | undefined,
  subjectKind: NonNullable<Profile["subjectKind"]>
): HealthDataChartSeriesPoint {
  const unit = String(row.unit);
  return {
    timestamp: isoTimestamp(row.bucket),
    value: Number(row.value),
    unit,
    count: Number(row.count),
    minValue: optionalNumber(row.min_value),
    maxValue: optionalNumber(row.max_value),
    referenceRange: type ? resolveReferenceRange(type, unit, personalRange, subjectKind).effective : undefined
  };
}