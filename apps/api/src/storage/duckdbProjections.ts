import type duckdb from "duckdb";
import {
  biologicalAgeMeasurementCodes,
  classifyValue,
  computeAnalyticsFromInput,
  type AnalyticsSummary,
  type AppBootstrap,
  type BiologicalAgeSource,
  type HealthDataDetailEntry,
  type HealthDataSummaryTypeRow,
  type MeasurementType,
  type ObservationGroup,
  type Profile
} from "@local-fitness-advisor/shared";
import type { ClinicianReportSourceImport } from "../clinicianReport.js";
import {
  type MeasurementDetailPage,
  summarizeMeasurementEntries,
  summarizeSummaryRows
} from "../summary.js";
import {
  all,
  allWithParams,
  compact,
  dateOnly,
  insightFromRow,
  isoTimestamp,
  measurementTypeFromRow,
  observationFromRow,
  optionalNumber,
  optionalString,
  optionalTimestamp,
  profileFromRow
} from "./duckdbRows.js";

export async function appBootstrap(connection: duckdb.Connection): Promise<AppBootstrap> {
  const [profileRows, measurementRows, templateRows, insightRows, counts] = await Promise.all([
    all(connection, "SELECT * FROM profile;"),
    all(connection, "SELECT * FROM measurement_types ORDER BY display, code;"),
    all(connection, `
      SELECT
        g.label,
        o.measurement_code,
        COALESCE(m.display, o.measurement_code) AS marker,
        COALESCE(NULLIF(m.canonical_unit, ''), o.unit) AS unit
      FROM observation_groups g
      JOIN observations o ON o.observation_group_id = g.id
      LEFT JOIN measurement_types m ON m.code = o.measurement_code
      WHERE g.kind = 'custom'
      GROUP BY g.label, o.measurement_code, m.display, m.canonical_unit, o.unit
      ORDER BY g.label, marker, o.measurement_code;
    `),
    all(connection, "SELECT * FROM insights ORDER BY created_at DESC, ordinal ASC LIMIT 1;"),
    storageCounts(connection)
  ]);
  if (profileRows.length !== 1) {
    throw new Error("DuckDB expected exactly one profile row.");
  }

  const templatesByLabel = new Map<string, AppBootstrap["manualObservationGroupTemplates"][number]>();
  for (const row of templateRows) {
    const normalizedLabel = normalizeGroupLabel(String(row.label));
    const existing = templatesByLabel.get(normalizedLabel) ?? {
      label: String(row.label).trim(),
      normalizedLabel,
      measurements: []
    };
    existing.measurements.push({
      measurementCode: String(row.measurement_code),
      marker: String(row.marker),
      unit: String(row.unit)
    });
    templatesByLabel.set(normalizedLabel, existing);
  }
  return {
    profile: profileFromRow(profileRows[0]),
    measurementTypes: measurementRows.map(measurementTypeFromRow),
    manualObservationGroupTemplates: [...templatesByLabel.values()],
    latestInsight: insightRows[0] ? insightFromRow(insightRows[0]) : undefined,
    counts
  };
}

export async function analyticsSummary(connection: duckdb.Connection): Promise<AnalyticsSummary> {
  const [profileRows, measurementRows, observationRows, countRows] = await Promise.all([
    all(connection, "SELECT units, subject_kind FROM profile;"),
    all(connection, "SELECT * EXCLUDE (ordinal) FROM measurement_types ORDER BY ordinal;"),
    all(connection, `
      SELECT * EXCLUDE (measurement_rank, category) FROM (
        SELECT
          o.* EXCLUDE (ordinal),
          o.ordinal,
          m.category,
          ROW_NUMBER() OVER (
            PARTITION BY o.measurement_code
            ORDER BY o.observed_at DESC, o.id DESC
          ) AS measurement_rank
        FROM observations o
        LEFT JOIN measurement_types m ON m.code = o.measurement_code
      )
      WHERE measurement_rank <= 12 OR category = 'lab'
      ORDER BY ordinal;
    `),
    all(connection, `
      SELECT
        (SELECT COUNT(*) FROM imports) AS imports,
        (SELECT COUNT(*) FROM observations) AS observations,
        (SELECT COUNT(*) FROM time_series_samples) AS samples,
        (SELECT COUNT(*) FROM activities) AS activities,
        (SELECT COUNT(*) FROM insights) AS insights,
        (SELECT COUNT(*) FROM health_events) AS health_events,
        (SELECT COUNT(*) FROM care_items) AS care_items;
    `)
  ]);
  if (profileRows.length !== 1) {
    throw new Error("DuckDB expected exactly one profile row.");
  }
  const counts = countRows[0] ?? {};
  return computeAnalyticsFromInput({
    counts: {
      imports: Number(counts.imports ?? 0),
      observations: Number(counts.observations ?? 0),
      samples: Number(counts.samples ?? 0),
      activities: Number(counts.activities ?? 0),
      insights: Number(counts.insights ?? 0),
      healthEvents: Number(counts.health_events ?? 0),
      careItems: Number(counts.care_items ?? 0)
    },
    measurementTypes: measurementRows.map(measurementTypeFromRow),
    observations: observationRows.map(observationFromRow),
    units: String(profileRows[0].units) as Profile["units"],
    subjectKind: String(profileRows[0].subject_kind ?? "adult") as Profile["subjectKind"]
  });
}

export async function biologicalAgeSource(connection: duckdb.Connection): Promise<BiologicalAgeSource> {
  const [profileRows, observationRows] = await Promise.all([
    all(connection, "SELECT * FROM profile;"),
    allWithParams(connection, `
      SELECT * EXCLUDE (measurement_rank) FROM (
        SELECT
          o.* EXCLUDE (ordinal),
          ROW_NUMBER() OVER (
            PARTITION BY o.measurement_code
            ORDER BY o.observed_at DESC, o.id DESC
          ) AS measurement_rank
        FROM observations o
        WHERE o.measurement_code IN (${biologicalAgeMeasurementCodes.map(() => "?").join(", ")})
      )
      WHERE measurement_rank = 1
      ORDER BY measurement_code;
    `, ...biologicalAgeMeasurementCodes)
  ]);
  if (profileRows.length !== 1) {
    throw new Error("DuckDB expected exactly one profile row.");
  }
  return {
    profile: profileFromRow(profileRows[0]),
    observations: observationRows.map(observationFromRow)
  };
}

export async function clinicianReportSourceImports(connection: duckdb.Connection): Promise<ClinicianReportSourceImport[]> {
  const rows = await all(connection, `
    SELECT file_name, source_kind, imported_at, status, row_count
    FROM imports
    ORDER BY imported_at DESC, file_name, ordinal;
  `);
  return rows.map((row) => ({
    fileName: String(row.file_name),
    sourceKind: String(row.source_kind) as ClinicianReportSourceImport["sourceKind"],
    importedAt: isoTimestamp(row.imported_at),
    status: String(row.status) as ClinicianReportSourceImport["status"],
    rowCount: Number(row.row_count)
  }));
}

export async function summary(connection: duckdb.Connection) {
  const rows = await all(connection, `
    WITH measurement_entries AS (
      SELECT measurement_code, 'observation' AS entry_kind, observed_at AS measured_at FROM observations
      UNION ALL
      SELECT measurement_code, 'sample' AS entry_kind, end_at AS measured_at FROM time_series_samples
      UNION ALL
      SELECT 'activity_sessions' AS measurement_code, 'activity' AS entry_kind, COALESCE(end_at, start_at) AS measured_at FROM activities
    )
    SELECT
      measurement_code,
      MIN(display) AS display_name,
      MIN(category) AS category,
      SUM(CASE WHEN entry_kind = 'observation' THEN 1 ELSE 0 END) AS observations,
      SUM(CASE WHEN entry_kind = 'sample' THEN 1 ELSE 0 END) AS samples,
      SUM(CASE WHEN entry_kind = 'activity' THEN 1 ELSE 0 END) AS activities,
      MAX(measured_at) AS last_measured_at
    FROM measurement_entries
    LEFT JOIN measurement_types ON measurement_types.code = measurement_entries.measurement_code
    GROUP BY measurement_code
    ORDER BY measurement_code;
  `);
  const summaryRows = rows.map((row) => {
    const observations = Number(row.observations);
    const samples = Number(row.samples);
    const activities = Number(row.activities);
    return {
      code: String(row.measurement_code),
      displayName: typeof row.display_name === "string" ? row.display_name : humanizeCode(String(row.measurement_code)),
      category: isSummaryCategory(row.category) ? row.category : "uncategorized",
      counts: {
        observations,
        samples,
        activities,
        total: observations + samples + activities
      },
      lastMeasuredAt: optionalTimestamp(row.last_measured_at)
    } satisfies HealthDataSummaryTypeRow;
  });
  return summarizeSummaryRows(summaryRows);
}

export async function measurementDetail(
  connection: duckdb.Connection,
  measurementCode: string,
  page: MeasurementDetailPage = { offset: 0, limit: 100 }
) {
  const [typeRows, rows, countRows] = await Promise.all([
    allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM measurement_types WHERE code = ?;", measurementCode),
    allWithParams(connection, `
      SELECT * FROM (
        SELECT
          'observation' AS kind, o.id, o.measurement_code, o.observed_at AS measured_at, o.value, o.unit,
          s.label AS source_label, s.source_kind, i.file_name AS import_file_name, i.imported_at,
          o.note, g.id AS group_id, g.kind AS group_kind, g.label AS group_label, g.collected_at AS group_collected_at,
          NULL AS sample_start, NULL AS sample_end, NULL AS activity_type, NULL AS activity_start,
          NULL AS duration_minutes, NULL AS energy_kcal, NULL AS distance_meters
        FROM observations o
        LEFT JOIN sources s ON s.id = o.source_id
        LEFT JOIN imports i ON i.id = s.import_id
        LEFT JOIN observation_groups g ON g.id = o.observation_group_id
        WHERE o.measurement_code = ?
        UNION ALL
        SELECT
          'sample' AS kind, t.id, t.measurement_code, t.end_at AS measured_at, t.value, t.unit,
          s.label AS source_label, s.source_kind, i.file_name AS import_file_name, i.imported_at,
          NULL AS note, NULL AS group_id, NULL AS group_kind, NULL AS group_label, NULL AS group_collected_at,
          t.start_at AS sample_start, t.end_at AS sample_end, NULL AS activity_type, NULL AS activity_start,
          NULL AS duration_minutes, NULL AS energy_kcal, NULL AS distance_meters
        FROM time_series_samples t
        LEFT JOIN sources s ON s.id = t.source_id
        LEFT JOIN imports i ON i.id = s.import_id
        WHERE t.measurement_code = ?
        UNION ALL
        SELECT
          'activity' AS kind, a.id, 'activity_sessions' AS measurement_code, COALESCE(a.end_at, a.start_at) AS measured_at,
          COALESCE(a.duration_minutes, DATE_DIFF('minute', a.start_at, COALESCE(a.end_at, a.start_at))) AS value, 'min' AS unit,
          s.label AS source_label, s.source_kind, i.file_name AS import_file_name, i.imported_at,
          NULL AS note, NULL AS group_id, NULL AS group_kind, NULL AS group_label, NULL AS group_collected_at,
          NULL AS sample_start, NULL AS sample_end, a.activity_type, a.start_at AS activity_start,
          a.duration_minutes, a.energy_kcal, a.distance_meters
        FROM activities a
        LEFT JOIN sources s ON s.id = a.source_id
        LEFT JOIN imports i ON i.id = s.import_id
        WHERE ? = 'activity_sessions'
      )
      ORDER BY measured_at DESC, id
      LIMIT ? OFFSET ?;
    `, measurementCode, measurementCode, measurementCode, page.limit, page.offset),
    allWithParams(connection, `
      SELECT
        (SELECT COUNT(*) FROM observations WHERE measurement_code = ?) AS observations,
        (SELECT COUNT(*) FROM time_series_samples WHERE measurement_code = ?) AS samples,
        (SELECT COUNT(*) FROM activities WHERE ? = 'activity_sessions') AS activities,
        (SELECT MAX(observed_at) FROM observations WHERE measurement_code = ?) AS observation_latest,
        (SELECT MAX(end_at) FROM time_series_samples WHERE measurement_code = ?) AS sample_latest,
        (SELECT MAX(COALESCE(end_at, start_at)) FROM activities WHERE ? = 'activity_sessions') AS activity_latest;
    `, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode)
  ]);
  const type = typeRows[0] ? measurementTypeFromRow(typeRows[0]) : undefined;
  const displayName = type?.display ?? humanizeCode(measurementCode);
  const entries = rows.map((row) => measurementDetailEntryFromRow(row, type, displayName));
  const countRow = countRows[0] ?? {};
  const counts = {
    observations: Number(countRow.observations ?? 0),
    samples: Number(countRow.samples ?? 0),
    activities: Number(countRow.activities ?? 0)
  };
  const total = counts.observations + counts.samples + counts.activities;
  const latestTimestamp = [
    optionalTimestamp(countRow.observation_latest),
    optionalTimestamp(countRow.sample_latest),
    optionalTimestamp(countRow.activity_latest)
  ].reduce<string | undefined>((latest, candidate) => !latest || (candidate && candidate > latest) ? candidate : latest, undefined);
  return summarizeMeasurementEntries(measurementCode, type, entries, {
    counts: { ...counts, total },
    latestTimestamp,
    pagination: {
      limit: page.limit,
      loaded: page.offset + entries.length,
      total,
      hasMore: page.offset + entries.length < total
    }
  });
}

export async function dailyMetrics(connection: duckdb.Connection, measurementCode?: string): Promise<DuckDbDailyMetric[]> {
  const rows = measurementCode === undefined
    ? await all(connection, `SELECT day, measurement_code, avg_value, min_value, max_value, n, unit
        FROM v_daily_metrics ORDER BY day, measurement_code;`)
    : await allWithParams(connection, `SELECT day, measurement_code, avg_value, min_value, max_value, n, unit
        FROM v_daily_metrics WHERE measurement_code = ? ORDER BY day;`, measurementCode);
  return rows.map((row) => ({
    day: dateOnly(row.day),
    measurementCode: String(row.measurement_code),
    avgValue: Number(row.avg_value),
    minValue: Number(row.min_value),
    maxValue: Number(row.max_value),
    count: Number(row.n),
    unit: String(row.unit)
  }));
}

export async function weeklyMetrics(connection: duckdb.Connection, measurementCode?: string): Promise<DuckDbWeeklyMetric[]> {
  const rows = measurementCode === undefined
    ? await all(connection, `SELECT week_start, measurement_code, avg_value, min_value, max_value, n, unit
        FROM v_weekly_metrics ORDER BY week_start, measurement_code;`)
    : await allWithParams(connection, `SELECT week_start, measurement_code, avg_value, min_value, max_value, n, unit
        FROM v_weekly_metrics WHERE measurement_code = ? ORDER BY week_start;`, measurementCode);
  return rows.map((row) => ({
    weekStart: dateOnly(row.week_start),
    measurementCode: String(row.measurement_code),
    avgValue: Number(row.avg_value),
    minValue: Number(row.min_value),
    maxValue: Number(row.max_value),
    count: Number(row.n),
    unit: String(row.unit)
  }));
}

export async function latestMeasurement(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<DuckDbMeasurementValue | undefined> {
  return (await measurementDetails(connection, measurementCode, 1))[0];
}

export async function measurementDetails(
  connection: duckdb.Connection,
  measurementCode: string,
  limit?: number
): Promise<DuckDbMeasurementValue[]> {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("DuckDB measurement detail limit must be a positive integer.");
  }
  const rows = await allWithParams(
    connection,
    `SELECT kind, id, measured_at, value, unit FROM (
      SELECT 'observation' AS kind, id, observed_at AS measured_at, value, unit
      FROM observations WHERE measurement_code = ?
      UNION ALL
      SELECT 'sample' AS kind, id, end_at AS measured_at, value, unit
      FROM time_series_samples WHERE measurement_code = ?
    ) ORDER BY measured_at DESC, kind, id${limit === undefined ? "" : " LIMIT ?"};`,
    ...(limit === undefined ? [measurementCode, measurementCode] : [measurementCode, measurementCode, limit])
  );
  return rows.map((row) => ({
    kind: String(row.kind) as "observation" | "sample",
    id: String(row.id),
    timestamp: isoTimestamp(row.measured_at),
    value: Number(row.value),
    unit: String(row.unit)
  }));
}

export async function listActivities(connection: duckdb.Connection, options: DuckDbActivityQuery): Promise<DuckDbActivity[]> {
  const query = normalizeActivityQuery(options);
  const rows = await allWithParams(
    connection,
    `SELECT activity_type, start_at, end_at, duration_minutes, energy_kcal, distance_meters
      FROM activities
      WHERE start_at >= ? AND start_at <= ?
      ORDER BY start_at ${query.sort}
      LIMIT ?;`,
    `${query.startDate} 00:00:00`,
    `${query.endDate} 23:59:59`,
    query.limit
  );
  return rows.map((row) => compact({
    activityType: String(row.activity_type),
    startAt: isoTimestamp(row.start_at),
    endAt: optionalTimestamp(row.end_at),
    durationMinutes: optionalNumber(row.duration_minutes),
    energyKcal: optionalNumber(row.energy_kcal),
    distanceMeters: optionalNumber(row.distance_meters)
  }) as unknown as DuckDbActivity);
}

export async function countActivities(connection: duckdb.Connection, options: DuckDbActivityQuery): Promise<DuckDbActivityCount[]> {
  const query = normalizeActivityQuery(options);
  const rows = await allWithParams(
    connection,
    `SELECT activity_type, COUNT(*) AS count
      FROM activities
      WHERE start_at >= ? AND start_at <= ?
      GROUP BY activity_type
      ORDER BY count ${query.sort}
      LIMIT ?;`,
    `${query.startDate} 00:00:00`,
    `${query.endDate} 23:59:59`,
    query.limit
  );
  return rows.map((row) => ({
    activityType: String(row.activity_type),
    count: Number(row.count)
  }));
}

export async function storageCounts(connection: duckdb.Connection): Promise<AppBootstrap["counts"]> {
  const rows = await all(connection, `
    SELECT
      (SELECT COUNT(*) FROM imports) AS imports,
      (SELECT COUNT(*) FROM observations) AS observations,
      (SELECT COUNT(*) FROM time_series_samples) AS samples,
      (SELECT COUNT(*) FROM activities) AS activities,
      (SELECT COUNT(*) FROM health_events) AS health_events,
      (SELECT COUNT(*) FROM care_items) AS care_items;
  `);
  const counts = rows[0] ?? {};
  return {
    imports: Number(counts.imports ?? 0),
    observations: Number(counts.observations ?? 0),
    samples: Number(counts.samples ?? 0),
    activities: Number(counts.activities ?? 0),
    healthEvents: Number(counts.health_events ?? 0),
    careItems: Number(counts.care_items ?? 0)
  };
}

function measurementDetailEntryFromRow(
  row: Record<string, unknown>,
  type: MeasurementType | undefined,
  displayName: string
): HealthDataDetailEntry {
  const kind = String(row.kind) as HealthDataDetailEntry["kind"];
  const base = {
    kind,
    id: String(row.id),
    measurementCode: String(row.measurement_code),
    displayName,
    timestamp: isoTimestamp(row.measured_at),
    value: Number(row.value),
    unit: String(row.unit),
    sourceLabel: optionalString(row.source_label),
    sourceKind: optionalString(row.source_kind) as HealthDataDetailEntry["sourceKind"],
    importFileName: optionalString(row.import_file_name),
    importedAt: optionalTimestamp(row.imported_at)
  };
  if (kind === "observation") {
    const referenceRange = type?.referenceRanges?.find((range) => range.unit === base.unit);
    const groupId = optionalString(row.group_id);
    return {
      ...base,
      note: optionalString(row.note),
      observationGroup: groupId
        ? {
            id: groupId,
            kind: String(row.group_kind) as ObservationGroup["kind"],
            label: String(row.group_label),
            collectedAt: optionalTimestamp(row.group_collected_at)
          }
        : undefined,
      referenceRange,
      status: type ? classifyValue(base.value, type, base.unit) : "unknown",
      canDelete: true,
      deleteLabel: "Delete"
    };
  }
  if (kind === "sample") {
    const startAt = isoTimestamp(row.sample_start);
    const endAt = isoTimestamp(row.sample_end);
    return {
      ...base,
      note: startAt !== endAt ? `${startAt} → ${endAt}` : undefined
    };
  }
  const detailNotes = [
    `Type: ${String(row.activity_type)}`,
    row.energy_kcal === null || row.energy_kcal === undefined ? undefined : `Energy: ${Number(row.energy_kcal).toFixed(1)} kcal`,
    row.distance_meters === null || row.distance_meters === undefined ? undefined : `Distance: ${Number(row.distance_meters).toFixed(1)} m`
  ].filter((note): note is string => Boolean(note));
  return { ...base, note: detailNotes.join(" • ") };
}

function isSummaryCategory(value: unknown): value is HealthDataSummaryTypeRow["category"] {
  return value === "activity" || value === "cardio" || value === "sleep" || value === "body" ||
    value === "lab" || value === "derived" || value === "uncategorized";
}

function humanizeCode(code: string): string {
  return code.replaceAll("_", " ").replace(/\b\w/g, (segment) => segment.toUpperCase());
}

function normalizeGroupLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

interface NormalizedActivityQuery {
  startDate: string;
  endDate: string;
  sort: "ASC" | "DESC";
  limit: number;
}

function normalizeActivityQuery(options: DuckDbActivityQuery): NormalizedActivityQuery {
  const startDate = validDateOnly(options.startDate, "startDate");
  const endDate = validDateOnly(options.endDate, "endDate");
  if (startDate > endDate) {
    throw new Error("DuckDB activity query startDate must not be after endDate.");
  }
  const requestedLimit = options.limit ?? maxAnalyticalRows;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("DuckDB activity query limit must be a positive integer.");
  }
  return {
    startDate,
    endDate,
    sort: options.sort === "asc" ? "ASC" : "DESC",
    limit: Math.min(requestedLimit, maxAnalyticalRows)
  };
}

function validDateOnly(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`DuckDB activity query ${name} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

export interface DuckDbDailyMetric {
  day: string;
  measurementCode: string;
  avgValue: number;
  minValue: number;
  maxValue: number;
  count: number;
  unit: string;
}

export interface DuckDbWeeklyMetric extends Omit<DuckDbDailyMetric, "day"> {
  weekStart: string;
}

export interface DuckDbMeasurementValue {
  kind: "observation" | "sample";
  id: string;
  timestamp: string;
  value: number;
  unit: string;
}

export interface DuckDbActivityQuery {
  startDate: string;
  endDate: string;
  sort?: "asc" | "desc";
  limit?: number;
}

export interface DuckDbActivity {
  activityType: string;
  startAt: string;
  endAt?: string;
  durationMinutes?: number;
  energyKcal?: number;
  distanceMeters?: number;
}

export interface DuckDbActivityCount {
  activityType: string;
  count: number;
}

const maxAnalyticalRows = 200;