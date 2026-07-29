import type duckdb from "duckdb";
import {
  type CareItem,
  type CareItemListQuery,
  biologicalAgeMeasurementCodes,
  classifyValueWithRange,
  type ClinicianReportLatestMeasurement,
  computeAnalyticsFromInput,
  isHealthEventKind,
  type HealthEvent,
  type HealthEventReference,
  type HealthEventListQuery,
  type AnalyticsSummary,
  type AppBootstrap,
  type BiologicalAgeSource,
  type HealthDataChartSeries,
  type HealthDataChartSeriesOptions,
  type HealthDataChartSeriesPoint,
  type HealthDataDetailEntry,
  type HealthDataSummaryTypeRow,
  type MeasurementType,
  type ObservationGroup,
  type PaginatedResult,
  type PersonalReferenceRange,
  type Profile,
  type ReferenceRangeState,
  getPreferredUnit,
  resolveReferenceRange
  ,toPreferredMeasurementValue
} from "@vitana/shared";
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
  optionalJson,
  optionalNumber,
  optionalString,
  optionalTimestamp,
  profileFromRow
} from "./duckdbRows.js";

export async function appBootstrap(connection: duckdb.Connection): Promise<AppBootstrap> {
  const [profileRows, measurementRows, templateRows, insightRows, photoRows, counts] = await Promise.all([
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
    all(connection, "SELECT revision, updated_at FROM profile_media WHERE media_kind = 'profile-photo';"),
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
    profilePhoto: photoRows[0] ? {
      revision: String(photoRows[0].revision),
      updatedAt: isoTimestamp(photoRows[0].updated_at)
    } : undefined,
    measurementTypes: measurementRows.map(measurementTypeFromRow),
    manualObservationGroupTemplates: [...templatesByLabel.values()],
    latestInsight: insightRows[0] ? insightFromRow(insightRows[0]) : undefined,
    counts
  };
}

export async function analyticsSummary(connection: duckdb.Connection): Promise<AnalyticsSummary> {
  const [profileRows, measurementRows, observationRows, personalRangeRows, pinnedRows, countRows] = await Promise.all([
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
    all(connection, "SELECT * FROM personal_reference_ranges ORDER BY measurement_code;"),
    all(connection, "SELECT measurement_code, pinned_at FROM pinned_measurements ORDER BY pinned_at, measurement_code;"),
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
    subjectKind: String(profileRows[0].subject_kind ?? "adult") as Profile["subjectKind"],
    personalReferenceRanges: personalRangeRows.map(personalReferenceRangeFromRow),
    pinnedMeasurements: pinnedRows.map((row) => ({
      measurementCode: String(row.measurement_code),
      pinnedAt: isoTimestamp(row.pinned_at)
    }))
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

export async function clinicianReportLatestMeasurements(
  connection: duckdb.Connection
): Promise<ClinicianReportLatestMeasurement[]> {
  const [profileRows, measurementRows, rows] = await Promise.all([
    all(connection, "SELECT units FROM profile;"),
    all(connection, "SELECT * FROM measurement_types ORDER BY ordinal;"),
    all(connection, `
      WITH measurement_entries AS (
        SELECT measurement_code, observed_at AS measured_at, value, unit, id,
          NULL::VARCHAR AS activity_type, NULL::DOUBLE AS duration_minutes
        FROM observations
        UNION ALL
        SELECT measurement_code, end_at AS measured_at, value, unit, id,
          NULL::VARCHAR AS activity_type, NULL::DOUBLE AS duration_minutes
        FROM time_series_samples
        UNION ALL
        SELECT 'activity_sessions' AS measurement_code, COALESCE(end_at, start_at) AS measured_at,
          NULL::DOUBLE AS value, NULL::VARCHAR AS unit, id, activity_type, duration_minutes
        FROM activities
      )
      SELECT * EXCLUDE (measurement_rank) FROM (
        SELECT
          entries.*,
          ROW_NUMBER() OVER (
            PARTITION BY measurement_code
            ORDER BY measured_at DESC, id DESC
          ) AS measurement_rank
        FROM measurement_entries entries
      )
      WHERE measurement_rank = 1
      ORDER BY measurement_code;
    `)
  ]);
  if (profileRows.length !== 1) {
    throw new Error("DuckDB expected exactly one profile row.");
  }

  const measurementTypes = new Map(measurementRows.map(measurementTypeFromRow).map((type) => [type.code, type]));
  const units = String(profileRows[0].units) as Profile["units"];
  const categoryLabels: Record<ClinicianReportLatestMeasurement["category"], string> = {
    activity: "Activity",
    body: "Body",
    cardio: "Cardio",
    derived: "Derived",
    lab: "Lab",
    sleep: "Sleep",
    uncategorized: "Uncategorized"
  };
  return rows.map((row) => {
    const measurementCode = String(row.measurement_code);
    const type = measurementTypes.get(measurementCode);
    const value = optionalNumber(row.value);
    const activityType = optionalString(row.activity_type);
    const measurement: ClinicianReportLatestMeasurement = {
      category: type?.category ?? (measurementCode === "activity_sessions" ? "activity" : "uncategorized"),
      displayName: type?.display ?? humanizeCode(measurementCode),
      measuredAt: isoTimestamp(row.measured_at)
    };
    if (type && value !== undefined) {
      Object.assign(measurement, toPreferredMeasurementValue(value, String(row.unit), type, units));
    }
    if (activityType) {
      measurement.activity = {
        activityType,
        durationMinutes: optionalNumber(row.duration_minutes)
      };
    }
    return measurement;
  }).sort((left, right) =>
    categoryLabels[left.category].localeCompare(categoryLabels[right.category]) ||
    left.displayName.localeCompare(right.displayName)
  );
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
      MIN(json_extract_string(custom_properties, '$.description')) AS description,
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
      description: typeof row.description === "string" ? row.description : undefined,
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
  const [typeRows, rows, countRows, profileRows, personalRows, pinnedRows] = await Promise.all([
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
    `, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode),
    all(connection, "SELECT units, subject_kind FROM profile;"),
    allWithParams(connection, "SELECT * FROM personal_reference_ranges WHERE measurement_code = ?;", measurementCode),
    allWithParams(connection, "SELECT 1 AS found FROM pinned_measurements WHERE measurement_code = ?;", measurementCode)
  ]);
  const type = typeRows[0] ? measurementTypeFromRow(typeRows[0]) : undefined;
  const personalRange = personalRows[0] ? personalReferenceRangeFromRow(personalRows[0]) : undefined;
  const subjectKind = String(profileRows[0]?.subject_kind ?? "adult") as NonNullable<Profile["subjectKind"]>;
  const displayName = type?.display ?? humanizeCode(measurementCode);
  const entries = rows.map((row) => measurementDetailEntryFromRow(row, type, displayName, personalRange, subjectKind));
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
    isPinned: pinnedRows.length > 0,
    counts: { ...counts, total },
    latestTimestamp,
    pagination: {
      limit: page.limit,
      loaded: page.offset + entries.length,
      total,
      hasMore: page.offset + entries.length < total
    },
    referenceRange: type
      ? resolveReferenceRange(
          type,
          getPreferredUnit(type, String(profileRows[0]?.units ?? "metric") as Profile["units"]),
          personalRange,
          subjectKind
        )
      : { source: "none" }
  });
}

export async function measurementChartSeries(
  connection: duckdb.Connection,
  measurementCode: string,
  options: HealthDataChartSeriesOptions
): Promise<HealthDataChartSeries> {
  const [typeRows, profileRows, personalRows] = await Promise.all([
    allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM measurement_types WHERE code = ?;", measurementCode),
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
  return {
    generatedAt: new Date().toISOString(),
    measurementCode,
    range: options.range,
    requestedMode: options.mode,
    granularity: useWeeklyBuckets ? "weekly" : "daily",
    aggregation,
    points: rows.map((row) => chartPointFromRow(row, type, personalRange, subjectKind)),
    totalPoints: rows.length,
    truncated: false
  };
}

async function chartEntryCount(connection: duckdb.Connection, measurementCode: string, cutoff?: string) {
  const range = chartRangeSql(cutoff);
  return allWithParams(
    connection,
    `WITH chart_entries AS (${chartEntriesSql()})
      SELECT COUNT(*) AS total FROM chart_entries ${range.clause};`,
    measurementCode,
    measurementCode,
    measurementCode,
    ...range.params
  );
}

async function rawChartPoints(connection: duckdb.Connection, measurementCode: string, cutoff?: string) {
  const range = chartRangeSql(cutoff);
  return allWithParams(
    connection,
    `WITH chart_entries AS (${chartEntriesSql()})
      SELECT measured_at AS bucket, value, unit, 1 AS count, value AS min_value, value AS max_value
      FROM chart_entries ${range.clause}
      ORDER BY measured_at DESC, id DESC
      LIMIT ?;`,
    measurementCode,
    measurementCode,
    measurementCode,
    ...range.params,
    maxRawChartPoints + 1
  );
}

async function aggregateChartPoints(
  connection: duckdb.Connection,
  measurementCode: string,
  cutoff: string | undefined,
  bucket: "day" | "week",
  aggregation: "sum" | "average"
) {
  const range = chartRangeSql(cutoff);
  const aggregate = aggregation === "sum" ? "SUM(value)" : "AVG(value)";
  return allWithParams(
    connection,
    `WITH chart_entries AS (${chartEntriesSql()})
      SELECT
        DATE_TRUNC('${bucket}', measured_at) AS bucket,
        ${aggregate} AS value,
        MIN(unit) AS unit,
        COUNT(*) AS count,
        MIN(value) AS min_value,
        MAX(value) AS max_value
      FROM chart_entries ${range.clause}
      GROUP BY DATE_TRUNC('${bucket}', measured_at)
      ORDER BY bucket;`,
    measurementCode,
    measurementCode,
    measurementCode,
    ...range.params
  );
}

function chartEntriesSql(): string {
  return `
    SELECT id, observed_at AS measured_at, value, unit
    FROM observations WHERE measurement_code = ?
    UNION ALL
    SELECT id, end_at AS measured_at, value, unit
    FROM time_series_samples WHERE measurement_code = ?
    UNION ALL
    SELECT id, COALESCE(end_at, start_at) AS measured_at,
      COALESCE(duration_minutes, DATE_DIFF('minute', start_at, COALESCE(end_at, start_at))) AS value,
      'min' AS unit
    FROM activities WHERE ? = 'activity_sessions'`;
}

function chartRangeSql(cutoff?: string): { clause: string; params: string[] } {
  return cutoff ? { clause: "WHERE measured_at >= ?", params: [cutoff] } : { clause: "", params: [] };
}

function chartRangeCutoff(range: HealthDataChartSeriesOptions["range"]): string | undefined {
  if (range === "all") {
    return undefined;
  }
  const cutoff = new Date();
  if (range === "1y") {
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  } else if (range === "3m") {
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
  } else {
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  }
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

export async function listHealthEvents(
  connection: duckdb.Connection,
  query: HealthEventListQuery
): Promise<PaginatedResult<HealthEvent>> {
  const normalized = normalizeHealthEventListQuery(query);
  const { whereSql, params } = buildHealthEventWhere(normalized);
  const rows = await allWithParams(
    connection,
    `SELECT * EXCLUDE (ordinal)
      FROM health_events
      ${whereSql}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ? OFFSET ?;`,
    ...params,
    normalized.limit,
    normalized.offset
  );
  const totalRows = await allWithParams(
    connection,
    `SELECT COUNT(*) AS count FROM health_events ${whereSql};`,
    ...params
  );
  const items = await hydrateHealthEventRows(connection, rows);
  if (normalized.includeId && !items.some((event) => event.id === normalized.includeId)) {
    const includedRows = await allWithParams(
      connection,
      "SELECT * EXCLUDE (ordinal) FROM health_events WHERE id = ?;",
      normalized.includeId
    );
    if (includedRows[0]) {
      items.push(...await hydrateHealthEventRows(connection, includedRows));
    }
  }
  const total = Number(totalRows[0]?.count ?? 0);
  return {
    items,
    total,
    offset: normalized.offset,
    limit: normalized.limit,
    hasMore: normalized.offset + rows.length < total
  };
}

export async function listCareItems(
  connection: duckdb.Connection,
  query: CareItemListQuery
): Promise<PaginatedResult<CareItem>> {
  const normalized = normalizeCareItemListQuery(query);
  const { whereSql, params } = buildCareItemWhere(normalized);
  const rows = await allWithParams(
    connection,
    `SELECT * EXCLUDE (ordinal),
        (SELECT kind FROM health_events WHERE id = care_items.completed_health_event_id) AS completed_event_kind,
        (SELECT occurred_at FROM health_events WHERE id = care_items.completed_health_event_id) AS completed_event_occurred_at,
        (SELECT provider FROM health_events WHERE id = care_items.completed_health_event_id) AS completed_event_provider
      FROM care_items
      ${whereSql}
      ORDER BY
        CASE WHEN due_start IS NULL THEN 1 ELSE 0 END,
        due_start ASC,
        id ASC
      LIMIT ? OFFSET ?;`,
    ...params,
    normalized.limit,
    normalized.offset
  );
  const totalRows = await allWithParams(
    connection,
    `SELECT COUNT(*) AS count FROM care_items ${whereSql};`,
    ...params
  );
  const items = rows.map(careItemFromRow);
  if (normalized.includeId && !items.some((item) => item.id === normalized.includeId)) {
    const includedRows = await allWithParams(
      connection,
      `SELECT * EXCLUDE (ordinal),
        (SELECT kind FROM health_events WHERE id = care_items.completed_health_event_id) AS completed_event_kind,
        (SELECT occurred_at FROM health_events WHERE id = care_items.completed_health_event_id) AS completed_event_occurred_at,
        (SELECT provider FROM health_events WHERE id = care_items.completed_health_event_id) AS completed_event_provider
      FROM care_items WHERE id = ?;`,
      normalized.includeId
    );
    if (includedRows[0]) {
      items.push(careItemFromRow(includedRows[0]));
    }
  }
  const total = Number(totalRows[0]?.count ?? 0);
  return {
    items,
    total,
    offset: normalized.offset,
    limit: normalized.limit,
    hasMore: normalized.offset + rows.length < total
  };
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
  displayName: string,
  personalRange: PersonalReferenceRange | undefined,
  subjectKind: NonNullable<Profile["subjectKind"]>
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
    const referenceRange = type ? resolveReferenceRange(type, base.unit, personalRange, subjectKind).effective : undefined;
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
      status: classifyValueWithRange(base.value, referenceRange),
      canDelete: true,
      deleteLabel: "Delete"
    };
  }
  if (kind === "sample") {
    const startAt = isoTimestamp(row.sample_start);
    const endAt = isoTimestamp(row.sample_end);
    return {
      ...base,
      note: startAt !== endAt ? `${startAt} → ${endAt}` : undefined,
      referenceRange: type ? resolveReferenceRange(type, base.unit, personalRange, subjectKind).effective : undefined,
      status: classifyValueWithRange(
        base.value,
        type ? resolveReferenceRange(type, base.unit, personalRange, subjectKind).effective : undefined
      )
    };
  }

  const detailNotes = [
    `Type: ${String(row.activity_type)}`,
    row.energy_kcal === null || row.energy_kcal === undefined ? undefined : `Energy: ${Number(row.energy_kcal).toFixed(1)} kcal`,
    row.distance_meters === null || row.distance_meters === undefined ? undefined : `Distance: ${Number(row.distance_meters).toFixed(1)} m`
  ].filter((note): note is string => Boolean(note));
  return { ...base, note: detailNotes.join(" • ") };
}

export async function referenceRangeState(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<ReferenceRangeState> {
  const [typeRows, profileRows, personalRows] = await Promise.all([
    allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM measurement_types WHERE code = ?;", measurementCode),
    all(connection, "SELECT units, subject_kind FROM profile;"),
    allWithParams(connection, "SELECT * FROM personal_reference_ranges WHERE measurement_code = ?;", measurementCode)
  ]);
  const type = typeRows[0] ? measurementTypeFromRow(typeRows[0]) : undefined;
  if (!type) return { source: "none" };
  return resolveReferenceRange(
    type,
    getPreferredUnit(type, String(profileRows[0]?.units ?? "metric") as Profile["units"]),
    personalRows[0] ? personalReferenceRangeFromRow(personalRows[0]) : undefined,
    String(profileRows[0]?.subject_kind ?? "adult") as NonNullable<Profile["subjectKind"]>
  );
}

function personalReferenceRangeFromRow(row: Record<string, unknown>): PersonalReferenceRange {
  return compact({
    measurementCode: String(row.measurement_code),
    normalLow: optionalNumber(row.normal_low),
    normalHigh: optionalNumber(row.normal_high),
    optimalLow: optionalNumber(row.optimal_low),
    optimalHigh: optionalNumber(row.optimal_high),
    unit: String(row.unit),
    updatedAt: isoTimestamp(row.updated_at)
  }) as unknown as PersonalReferenceRange;
}

async function hydrateHealthEventRows(
  connection: duckdb.Connection,
  rows: Array<Record<string, unknown>>
): Promise<HealthEvent[]> {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => String(row.id));
  const placeholders = ids.map(() => "?").join(", ");
  const [immunizationRows, medicationRows] = await Promise.all([
    allWithParams(connection, `SELECT * FROM immunizations WHERE health_event_id IN (${placeholders});`, ...ids),
    allWithParams(connection, `SELECT * FROM medication_administrations WHERE health_event_id IN (${placeholders});`, ...ids)
  ]);
  const immunizations = new Map(immunizationRows.map((row) => [String(row.health_event_id), row]));
  const medications = new Map(medicationRows.map((row) => [String(row.health_event_id), row]));
  return rows.map((row) => {
    const kind = String(row.kind);
    if (!isHealthEventKind(kind)) {
      throw new Error(`Unsupported health event kind "${kind}".`);
    }
    const base = {
      id: String(row.id),
      status: String(row.status) as HealthEvent["status"],
      occurredAt: isoTimestamp(row.occurred_at),
      source: String(row.source) as HealthEvent["source"],
      provider: optionalString(row.provider),
      notes: optionalString(row.notes),
      metadata: optionalJson<Record<string, unknown>>(row.metadata)
    };
    const immunization = immunizations.get(String(row.id));
    const medication = medications.get(String(row.id));
    if (immunization) {
      return {
        ...base,
        kind: "immunization",
        immunization: {
          vaccine: String(immunization.vaccine),
          targetDisease: optionalString(immunization.target_disease),
          doseNumber: optionalNumber(immunization.dose_number),
          series: optionalString(immunization.series),
          manufacturer: optionalString(immunization.manufacturer),
          lotNumber: optionalString(immunization.lot_number),
          expiresAt: immunization.expires_at ? dateOnly(immunization.expires_at) : undefined,
          route: optionalString(immunization.route),
          site: optionalString(immunization.site),
          reaction: optionalString(immunization.reaction)
        }
      } satisfies HealthEvent;
    }
    if (medication) {
      return {
        ...base,
        kind: "medication-administration",
        medicationAdministration: {
          medication: String(medication.medication),
          activeIngredient: optionalString(medication.active_ingredient),
          dose: Number(medication.dose),
          unit: String(medication.unit),
          route: optionalString(medication.route)
        }
      } satisfies HealthEvent;
    }
    // Base-only health event records are valid even when no subtype table row exists.
    if (kind === "immunization") {
      return { ...base, kind: "immunization" } satisfies HealthEvent;
    }
    if (kind === "medication-administration") {
      return { ...base, kind: "medication-administration" } satisfies HealthEvent;
    }
    return { ...base, kind } satisfies HealthEvent;
  });
}

function careItemFromRow(row: Record<string, unknown>): CareItem {
  const completedHealthEventId = optionalString(row.completed_health_event_id);
  return {
    id: String(row.id),
    kind: String(row.kind),
    code: optionalString(row.code),
    title: String(row.title),
    dueStart: optionalTimestamp(row.due_start),
    reminderAt: optionalTimestamp(row.reminder_at),
    priority: String(row.priority) as CareItem["priority"],
    status: String(row.status) as CareItem["status"],
    scheduleProvenance: optionalString(row.schedule_provenance),
    scheduleVersion: optionalString(row.schedule_version),
    notes: optionalString(row.notes),
    completedHealthEventId,
    completedAt: optionalTimestamp(row.completed_at),
    completedHealthEvent: healthEventReferenceFromCareItemRow(row, "completed_event", completedHealthEventId)
  };
}

function healthEventReferenceFromCareItemRow(
  row: Record<string, unknown>,
  prefix: "completed_event",
  id: string | undefined
): HealthEventReference | undefined {
  const kind = optionalString(row[`${prefix}_kind`]);
  const occurredAt = optionalTimestamp(row[`${prefix}_occurred_at`]);
  if (!id || !kind || !occurredAt) return undefined;
  return {
    id,
    kind: kind as HealthEventReference["kind"],
    occurredAt,
    provider: optionalString(row[`${prefix}_provider`])
  };
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

interface NormalizedHealthEventListQuery {
  limit: number;
  offset: number;
  search?: string;
  kind?: HealthEventListQuery["kind"];
  status?: HealthEventListQuery["status"];
  occurredFrom?: string;
  occurredTo?: string;
  includeId?: string;
}

function normalizeHealthEventListQuery(query: HealthEventListQuery): NormalizedHealthEventListQuery {
  return {
    limit: Math.min(Math.max(Number(query.limit ?? 20), 1), 100),
    offset: Math.max(Number(query.offset ?? 0), 0),
    search: query.search?.trim() || undefined,
    kind: query.kind,
    status: query.status,
    occurredFrom: query.occurredFrom,
    occurredTo: query.occurredTo,
    includeId: query.includeId?.trim() || undefined
  };
}

function buildHealthEventWhere(query: NormalizedHealthEventListQuery): { whereSql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.kind) {
    clauses.push("kind = ?");
    params.push(query.kind);
  }
  if (query.status) {
    clauses.push("status = ?");
    params.push(query.status);
  }
  if (query.occurredFrom) {
    clauses.push("occurred_at >= ?");
    params.push(query.occurredFrom);
  }
  if (query.occurredTo) {
    clauses.push("occurred_at <= ?");
    params.push(query.occurredTo);
  }
  if (query.search) {
    clauses.push("(LOWER(kind) LIKE ? OR LOWER(COALESCE(provider, '')) LIKE ? OR LOWER(COALESCE(notes, '')) LIKE ?)");
    const token = `%${query.search.toLowerCase()}%`;
    params.push(token, token, token);
  }
  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

interface NormalizedCareItemListQuery {
  limit: number;
  offset: number;
  search?: string;
  kind?: CareItemListQuery["kind"];
  status?: CareItemListQuery["status"];
  priority?: CareItemListQuery["priority"];
  dueFrom?: string;
  dueTo?: string;
  includeId?: string;
}

function normalizeCareItemListQuery(query: CareItemListQuery): NormalizedCareItemListQuery {
  return {
    limit: Math.min(Math.max(Number(query.limit ?? 20), 1), 100),
    offset: Math.max(Number(query.offset ?? 0), 0),
    search: query.search?.trim() || undefined,
    kind: query.kind,
    status: query.status,
    priority: query.priority,
    dueFrom: query.dueFrom,
    dueTo: query.dueTo,
    includeId: query.includeId?.trim() || undefined
  };
}

function buildCareItemWhere(query: NormalizedCareItemListQuery): { whereSql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.kind) {
    clauses.push("kind = ?");
    params.push(query.kind);
  }
  if (query.status) {
    clauses.push("status = ?");
    params.push(query.status);
  }
  if (query.priority) {
    clauses.push("priority = ?");
    params.push(query.priority);
  }
  if (query.dueFrom) {
    clauses.push("due_start >= ?");
    params.push(query.dueFrom);
  }
  if (query.dueTo) {
    clauses.push("due_start <= ?");
    params.push(query.dueTo);
  }
  if (query.search) {
    clauses.push("(LOWER(title) LIKE ? OR LOWER(kind) LIKE ? OR LOWER(COALESCE(notes, '')) LIKE ?)");
    const token = `%${query.search.toLowerCase()}%`;
    params.push(token, token, token);
  }
  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
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
const maxRawChartPoints = 500;
const maxDailyChartBuckets = 366;