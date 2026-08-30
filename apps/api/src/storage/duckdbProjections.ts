import type duckdb from "duckdb";
import {
  type CareItem,
  type CareItemListQuery,
  type CalendarMeasurementPoint,
  type CalendarMonthData,
  type CalendarMonthQuery,
  biologicalAgeMeasurementCodes,
  classifyValueWithRange,
  type ClinicianReportLatestMeasurement,
  computeAnalyticsFromInput,
  isHealthEventKind,
  normalizedCareItemKind,
  type HealthEvent,
  type HealthEventReference,
  type HealthEventListQuery,
  healthEventKindLabels,
  type AnalyticsSummary,
  type AppBootstrap,
  type BiologicalAgeSource,
  type BodyTrendDateDetail,
  type BodyTrendDateQuery,
  type BodyTrendReadingGroup,
  type BodyTrendTimeline,
  type BodyTrendQuery,
  type HealthDataDetailEntry,
  type HealthDataSummaryTypeRow,
  journalItemsPerDayLimit,
  type JournalDay,
  type JournalPage,
  type JournalQuery,
  type JournalTimelineItem,
  type MeasurementType,
  type Medication,
  type MedicationListQuery,
  medicationSchema,
  type ObservationGroup,
  type ObservationGroupDetail,
  type ObservationGroupListItem,
  type ObservationGroupListQuery,
  type PaginatedResult,
  type PersonalReferenceRange,
  type Profile,
  type ReferenceRangeState,
  healthConnectSleepStageSchema,
  type SleepSession,
  type SleepSessionListQueryContract,
  type SleepSessionPage,
  type SleepSessionStage,
  getPreferredUnit,
  resolveReferenceRange,
  toPreferredMeasurementValue
} from "@vitana/shared";
import type { ClinicianReportSourceImport } from "../clinicianReport.js";
import type { InsightReviewContext } from "./profileRepository.js";
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
  personalReferenceRangeFromRow,
  optionalString,
  optionalTimestamp,
  profileFromRow
} from "./duckdbRows.js";
import { qualifiedColumns, selectColumns } from "./duckdbColumns.js";
import { chartEntriesSql, chartRangeCutoff } from "./duckdbChartProjections.js";
export { measurementChartSeries } from "./duckdbChartProjections.js";

// Named column lists, not `SELECT * EXCLUDE (...)`: that syntax is DuckDB-only, and `*` silently
// widens every DTO the moment the schema gains a column.
const measurementTypeColumns = selectColumns("measurement_types", { excludeOrdinal: true });
const healthEventColumns = selectColumns("health_events", { excludeOrdinal: true });
const careItemColumns = qualifiedColumns("care_items", "care_items", { excludeOrdinal: true });
const observationColumns = selectColumns("observations", { excludeOrdinal: true });
const qualifiedObservationColumns = qualifiedColumns("o", "observations", { excludeOrdinal: true });
// Shape of the `measurement_entries` CTE that unions observations, samples and activities.
const latestMeasurementColumns =
  "measurement_code, measured_at, value, unit, id, activity_type, duration_minutes";

export async function appBootstrap(
  connection: duckdb.Connection,
  /** Already-known row counts, so bootstrap does not repeat six `COUNT(*)` scans the caller has. */
  knownCounts?: AppBootstrap["counts"]
): Promise<AppBootstrap> {
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
    knownCounts ? Promise.resolve(knownCounts) : storageCounts(connection)
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

export async function observationGroupDetail(
  connection: duckdb.Connection,
  id: string
): Promise<ObservationGroupDetail | undefined> {
  const groupRows = await allWithParams(connection, `
    SELECT
      g.id, g.kind, g.label, g.collected_at,
      s.source_kind, COALESCE(s.label, g.source_id) AS source_label,
      i.file_name, i.imported_at
    FROM observation_groups g
    LEFT JOIN sources s ON s.id = g.source_id
    LEFT JOIN imports i ON i.id = COALESCE(g.import_id, s.import_id)
    WHERE g.id = ?
    LIMIT 1;
  `, id);
  const group = groupRows[0];
  if (!group) return undefined;

  const [profileRows, typeRows, rangeRows, observationRows] = await Promise.all([
    all(connection, "SELECT units, subject_kind FROM profile LIMIT 1;"),
    all(connection, `SELECT ${measurementTypeColumns} FROM measurement_types;`),
    all(connection, "SELECT measurement_code, normal_low, normal_high, optimal_low, optimal_high, unit, updated_at FROM personal_reference_ranges;"),
    allWithParams(connection, `
      SELECT ${qualifiedObservationColumns}, COALESCE(m.display, o.measurement_code) AS display_name
      FROM observations o
      LEFT JOIN measurement_types m ON m.code = o.measurement_code
      WHERE o.observation_group_id = ?
      ORDER BY o.observed_at, o.ordinal;
    `, id)
  ]);
  const types = new Map(typeRows.map((row) => {
    const type = measurementTypeFromRow(row);
    return [type.code, type];
  }));
  const ranges = new Map(rangeRows.map((row) => {
    const range = personalReferenceRangeFromRow(row);
    return [range.measurementCode, range];
  }));
  const units = String(profileRows[0]?.units ?? "metric") as Profile["units"];
  const subjectKind = String(profileRows[0]?.subject_kind ?? "adult") as NonNullable<Profile["subjectKind"]>;
  const sourceKind = String(group.source_kind ?? "derived") as ObservationGroupDetail["source"]["kind"];
  const editable = sourceKind === "manual-entry" || sourceKind === "blood-test-report" || sourceKind === "body-composition-report";

  return {
    id: String(group.id),
    kind: String(group.kind) as ObservationGroup["kind"],
    label: String(group.label),
    collectedAt: optionalTimestamp(group.collected_at),
    source: {
      kind: sourceKind,
      label: String(group.source_label ?? "Unknown source"),
      importFileName: optionalString(group.file_name),
      importedAt: optionalTimestamp(group.imported_at)
    },
    editable,
    readOnlyReason: editable ? undefined : "This group is synchronized from another source and cannot be edited here.",
    observations: observationRows.map((row) => {
      const observation = observationFromRow(row);
      const type = types.get(observation.measurementCode);
      const display = type
        ? toPreferredMeasurementValue(observation.value, observation.unit, type, units)
        : observation;
      const referenceRange = type
        ? resolveReferenceRange(type, display.unit, ranges.get(observation.measurementCode), subjectKind).effective
        : undefined;
      return {
        id: observation.id,
        measurementCode: observation.measurementCode,
        displayName: String(row.display_name),
        observedAt: observation.observedAt,
        value: display.value,
        unit: display.unit,
        note: observation.note,
        referenceRange,
        status: classifyValueWithRange(display.value, referenceRange)
      };
    })
  };
}

export async function analyticsSummary(connection: duckdb.Connection): Promise<AnalyticsSummary> {
  const [profileRows, measurementRows, observationRows, personalRangeRows, pinnedRows, countRows] = await Promise.all([
    all(connection, "SELECT units, subject_kind FROM profile;"),
    all(connection, `SELECT ${measurementTypeColumns} FROM measurement_types ORDER BY ordinal;`),
    all(connection, `
      SELECT ${observationColumns} FROM (
        SELECT
          ${qualifiedObservationColumns},
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

const insightReviewMetricCodes = [
  "steps",
  "sleep_duration",
  "resting_heart_rate",
  "heart_rate",
  "heart_rate_variability_rmssd",
  "heart_rate_variability_sdnn",
  "oxygen_saturation",
  "active_energy_burned",
  "exercise_duration"
] as const;

export async function insightReviewContext(connection: duckdb.Connection): Promise<InsightReviewContext> {
  const windowDays = 30;
  const metricPlaceholders = insightReviewMetricCodes.map(() => "?").join(", ");
  const [coverageRows, metricRows, activityRows, eventRows, careRows, medicationRows] = await Promise.all([
    allWithParams(connection, `
      SELECT MIN(day) AS earliest_date, MAX(day) AS latest_date, COUNT(DISTINCT day) AS active_days
      FROM v_daily_metrics
      WHERE day >= CURRENT_DATE - INTERVAL '${windowDays - 1} days';
    `),
    allWithParams(connection, `
      SELECT d.measurement_code, COALESCE(m.display, d.measurement_code) AS label,
        MIN(d.unit) AS unit, AVG(d.avg_value) AS average_value,
        MIN(d.min_value) AS minimum_value, MAX(d.max_value) AS maximum_value,
        COUNT(DISTINCT d.day) AS days
      FROM v_daily_metrics d
      LEFT JOIN measurement_types m ON m.code = d.measurement_code
      WHERE d.day >= CURRENT_DATE - INTERVAL '${windowDays - 1} days'
        AND d.measurement_code IN (${metricPlaceholders})
      GROUP BY d.measurement_code, m.display
      HAVING COUNT(DISTINCT d.unit) = 1
      ORDER BY days DESC, d.measurement_code;
    `, ...insightReviewMetricCodes),
    allWithParams(connection, `
      SELECT activity_type, COUNT(*) AS sessions, SUM(duration_minutes) AS duration_minutes
      FROM activities
      WHERE start_at >= CURRENT_TIMESTAMP - INTERVAL '${windowDays} days'
      GROUP BY activity_type
      ORDER BY sessions DESC, activity_type
      LIMIT 12;
    `),
    allWithParams(connection, `
      SELECT kind, COUNT(*) AS count, MAX(CAST(occurred_at AS DATE)) AS latest_date
      FROM health_events
      WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '90 days'
        AND status = 'completed'
      GROUP BY kind
      ORDER BY count DESC, kind
      LIMIT 12;
    `),
    allWithParams(connection, `
      SELECT COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'open' AND due_start < CURRENT_TIMESTAMP) AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'open' AND priority = 'high') AS high_priority_count
      FROM care_items;
    `),
    allWithParams(connection, `
      SELECT name, active_ingredient, dose, unit, start_date, end_date
      FROM medications
      ORDER BY start_date IS NULL, start_date DESC, name ASC
      LIMIT 20;
    `)
  ]);
  const coverage = coverageRows[0] ?? {};
  const care = careRows[0] ?? {};
  return {
    windowDays,
    coverage: {
      ...(coverage.earliest_date ? { earliestDate: dateOnly(coverage.earliest_date) } : {}),
      ...(coverage.latest_date ? { latestDate: dateOnly(coverage.latest_date) } : {}),
      activeDays: Number(coverage.active_days ?? 0)
    },
    trackedMetrics: metricRows.map((row) => ({
      code: String(row.measurement_code),
      label: String(row.label),
      unit: String(row.unit),
      average: Number(row.average_value),
      minimum: Number(row.minimum_value),
      maximum: Number(row.maximum_value),
      days: Number(row.days)
    })),
    activities: activityRows.map((row) => ({
      type: String(row.activity_type),
      sessions: Number(row.sessions),
      ...(row.duration_minutes === null || row.duration_minutes === undefined
        ? {}
        : { durationMinutes: Number(row.duration_minutes) })
    })),
    healthEvents: eventRows.map((row) => ({
      kind: String(row.kind),
      count: Number(row.count),
      latestDate: dateOnly(row.latest_date)
    })),
    care: {
      open: Number(care.open_count ?? 0),
      overdue: Number(care.overdue_count ?? 0),
      highPriority: Number(care.high_priority_count ?? 0)
    },
    medications: medicationRows.map((row) => ({
      name: String(row.name),
      ...(row.active_ingredient ? { activeIngredient: String(row.active_ingredient) } : {}),
      ...(row.dose === null || row.dose === undefined ? {} : { dose: Number(row.dose) }),
      ...(row.unit ? { unit: String(row.unit) } : {}),
      ...(row.start_date ? { startDate: dateOnly(row.start_date) } : {}),
      ...(row.end_date ? { endDate: dateOnly(row.end_date) } : {})
    }))
  };
}

export async function biologicalAgeSource(connection: duckdb.Connection): Promise<BiologicalAgeSource> {
  const [profileRows, observationRows] = await Promise.all([
    all(connection, "SELECT * FROM profile;"),
    allWithParams(connection, `
      SELECT ${observationColumns} FROM (
        SELECT
          ${qualifiedObservationColumns},
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
      SELECT ${latestMeasurementColumns} FROM (
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
      SELECT measurement_code, 'observation' AS entry_kind, observed_at AS measured_at,
        CASE
          WHEN observation_groups.kind = 'body_composition_report' THEN 'body'
          WHEN observation_groups.kind = 'lab_panel' THEN 'lab'
        END AS category_hint
      FROM observations
      LEFT JOIN observation_groups ON observation_groups.id = observations.observation_group_id
      UNION ALL
      SELECT measurement_code, 'sample' AS entry_kind, end_at AS measured_at, NULL AS category_hint FROM time_series_samples
      UNION ALL
      SELECT measurement_code, 'sample' AS entry_kind, end_at AS measured_at, NULL AS category_hint FROM measurement_aggregates
      UNION ALL
      SELECT 'activity_sessions' AS measurement_code, 'activity' AS entry_kind,
        COALESCE(end_at, start_at) AS measured_at, 'activity' AS category_hint
      FROM activities
    )
    SELECT
      measurement_code,
      MIN(display) AS display_name,
      MIN(json_extract_string(custom_properties, '$.description')) AS description,
      COALESCE(MIN(category), MIN(category_hint)) AS category,
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
    allWithParams(connection, `SELECT ${measurementTypeColumns} FROM measurement_types WHERE code = ?;`, measurementCode),
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
          'sample' AS kind, a.id, a.measurement_code, a.end_at AS measured_at, a.average AS value, a.unit,
          s.label AS source_label, s.source_kind, i.file_name AS import_file_name, i.imported_at,
          CONCAT(a.granularity, ' aggregate; min ', a.minimum, ', max ', a.maximum, ', ', a.measurement_count, ' readings') AS note,
          NULL AS group_id, NULL AS group_kind, NULL AS group_label, NULL AS group_collected_at,
          a.start_at AS sample_start, a.end_at AS sample_end, NULL AS activity_type, NULL AS activity_start,
          NULL AS duration_minutes, NULL AS energy_kcal, NULL AS distance_meters
        FROM measurement_aggregates a
        LEFT JOIN sources s ON s.id = a.source_id
        LEFT JOIN imports i ON i.id = s.import_id
        WHERE a.measurement_code = ? AND (
          a.granularity = '15m' OR (
            a.granularity = 'day' AND a.end_at <= COALESCE((
              SELECT MIN(recent.start_at) FROM measurement_aggregates recent
              WHERE recent.measurement_code = a.measurement_code AND recent.granularity = '15m'
            ), TIMESTAMPTZ 'infinity')
          )
        )
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
    `, measurementCode, measurementCode, measurementCode, measurementCode, page.limit, page.offset),
    allWithParams(connection, `
      SELECT
        (SELECT COUNT(*) FROM observations WHERE measurement_code = ?) AS observations,
        (SELECT COUNT(*) FROM time_series_samples WHERE measurement_code = ?) AS samples,
        (SELECT COUNT(*) FROM measurement_aggregates WHERE measurement_code = ?) AS aggregates,
        (SELECT COUNT(*) FROM activities WHERE ? = 'activity_sessions') AS activities,
        (SELECT MAX(observed_at) FROM observations WHERE measurement_code = ?) AS observation_latest,
        (SELECT MAX(end_at) FROM time_series_samples WHERE measurement_code = ?) AS sample_latest,
        (SELECT MAX(end_at) FROM measurement_aggregates WHERE measurement_code = ?) AS aggregate_latest,
        (SELECT MAX(COALESCE(end_at, start_at)) FROM activities WHERE ? = 'activity_sessions') AS activity_latest;
    `, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode, measurementCode),
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
    samples: Number(countRow.samples ?? 0) + Number(countRow.aggregates ?? 0),
    activities: Number(countRow.activities ?? 0)
  };
  const total = counts.observations + counts.samples + counts.activities;
  const latestTimestamp = [
    optionalTimestamp(countRow.observation_latest),
    optionalTimestamp(countRow.sample_latest),
    optionalTimestamp(countRow.aggregate_latest),
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
      : { source: "none" },
    optimalRangeForUnit: type
      ? (unit) => resolveReferenceRange(type, unit, personalRange, subjectKind).optimal
      : undefined
  });
}

export async function sleepSessions(
  connection: duckdb.Connection,
  page: SleepSessionListQueryContract
): Promise<SleepSessionPage> {
  const [rows, countRows] = await Promise.all([
    allWithParams(connection, `
      SELECT
        t.id, t.start_at, t.end_at, t.value, t.source_json,
        s.label AS source_label, i.imported_at
      FROM time_series_samples t
      LEFT JOIN sources s ON s.id = t.source_id
      LEFT JOIN imports i ON i.id = s.import_id
      WHERE t.measurement_code = 'sleep_duration'
      ORDER BY t.end_at DESC, t.id DESC
      LIMIT ? OFFSET ?;
    `, page.limit, page.offset),
    all(connection, "SELECT COUNT(*) AS total FROM time_series_samples WHERE measurement_code = 'sleep_duration';")
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  return {
    generatedAt: new Date().toISOString(),
    sessions: rows.map(sleepSessionFromRow),
    total,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.offset + rows.length < total
  };
}

function sleepSessionFromRow(row: Record<string, unknown>): SleepSession {
  const startAt = isoTimestamp(row.start_at);
  const endAt = isoTimestamp(row.end_at);
  const sourceJson = optionalJson<Record<string, unknown>>(row.source_json);
  const sourceStages = Array.isArray(sourceJson?.stages) ? sourceJson.stages : undefined;
  const stageData = sourceStages === undefined
    ? { stageDataStatus: "unavailable" as const, stages: [] }
    : normalizeSleepStages(sourceStages, startAt, endAt);
  return {
    id: String(row.id),
    startAt,
    endAt,
    durationMinutes: Number(row.value),
    ...stageData,
    ...(optionalString(row.source_label) ? { sourceLabel: optionalString(row.source_label) } : {}),
    ...(optionalTimestamp(row.imported_at) ? { importedAt: optionalTimestamp(row.imported_at) } : {}),
    ...(optionalString(sourceJson?.title) ? { title: optionalString(sourceJson?.title) } : {}),
    ...(optionalString(sourceJson?.notes) ? { notes: optionalString(sourceJson?.notes) } : {})
  };
}

function normalizeSleepStages(sourceStages: unknown[], sessionStartAt: string, sessionEndAt: string): {
  stageDataStatus: SleepSession["stageDataStatus"];
  stages: SleepSessionStage[];
} {
  const sessionStart = Date.parse(sessionStartAt);
  const sessionEnd = Date.parse(sessionEndAt);
  let partial = false;
  const candidates: Array<{ start: number; end: number; stage: SleepSessionStage["stage"] }> = [];

  for (const value of sourceStages) {
    const parsed = healthConnectSleepStageSchema.safeParse(value);
    if (!parsed.success) {
      partial = true;
      continue;
    }
    const rawStart = Date.parse(parsed.data.startTime);
    const rawEnd = Date.parse(parsed.data.endTime);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      partial = true;
      continue;
    }
    const start = Math.max(sessionStart, rawStart);
    const end = Math.min(sessionEnd, rawEnd);
    if (start !== rawStart || end !== rawEnd || end <= start) {
      partial = true;
    }
    if (end <= start) continue;
    const stage = canonicalSleepStage(parsed.data.stage);
    if (stage === "gap") partial = true;
    candidates.push({ start, end, stage });
  }

  if (candidates.length === 0) {
    return sourceStages.length === 0
      ? { stageDataStatus: "unavailable", stages: [] }
      : { stageDataStatus: "partial", stages: [sleepStage("gap", sessionStart, sessionEnd)] };
  }

  candidates.sort((left, right) => left.start - right.start || left.end - right.end);
  const stages: SleepSessionStage[] = [];
  let cursor = sessionStart;
  for (const candidate of candidates) {
    if (candidate.start > cursor) {
      stages.push(sleepStage("gap", cursor, candidate.start));
      partial = true;
    }
    const start = Math.max(candidate.start, cursor);
    if (start !== candidate.start) partial = true;
    if (candidate.end <= start) {
      partial = true;
      continue;
    }
    stages.push(sleepStage(candidate.stage, start, candidate.end));
    cursor = candidate.end;
  }
  if (cursor < sessionEnd) {
    stages.push(sleepStage("gap", cursor, sessionEnd));
    partial = true;
  }
  return { stageDataStatus: partial ? "partial" : "available", stages };
}

function canonicalSleepStage(stage: number): SleepSessionStage["stage"] {
  switch (stage) {
    case 1:
    case 3:
      return "awake";
    case 2:
    case 4:
      return "light";
    case 5:
      return "deep";
    case 6:
      return "rem";
    default:
      return "gap";
  }
}

function sleepStage(stage: SleepSessionStage["stage"], start: number, end: number): SleepSessionStage {
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), stage };
}
export async function calendarMonth(
  connection: duckdb.Connection,
  query: CalendarMonthQuery
): Promise<CalendarMonthData> {
  const placeholders = query.measurementCodes.map(() => "?").join(", ");
  const entriesSql = chartEntriesSql(`IN (${placeholders})`);
  const repeatedCodes = Array.from({ length: 4 }, () => query.measurementCodes).flat();
  const [typeRows, entryRows, eventRows] = await Promise.all([
    allWithParams(
      connection,
      `SELECT code, aggregation FROM measurement_types WHERE code IN (${placeholders});`,
      ...query.measurementCodes
    ),
    allWithParams(connection, `
      WITH chart_entries AS (${entriesSql}),
      dated_entries AS (
        SELECT *,
          COALESCE(calendar_date, CAST(timezone(?, measured_at) AS DATE)) AS local_date
        FROM chart_entries
      )
      SELECT local_date, measurement_code, measured_at, value, unit, weight, min_value, max_value, source_label
      FROM dated_entries
      WHERE local_date >= CAST(? || '-01' AS DATE)
        AND local_date < CAST(CAST(? || '-01' AS DATE) + INTERVAL '1 month' AS DATE)
      ORDER BY local_date, measurement_code, measured_at, id;
    `, ...repeatedCodes, query.timezone, query.month, query.month),
    allWithParams(connection, `
      WITH dated_events AS (
        SELECT kind, CAST(timezone(?, occurred_at) AS DATE) AS local_date
        FROM health_events
        WHERE status = 'completed'
      )
      SELECT local_date, kind
      FROM dated_events
      WHERE local_date >= CAST(? || '-01' AS DATE)
        AND local_date < CAST(CAST(? || '-01' AS DATE) + INTERVAL '1 month' AS DATE)
      ORDER BY local_date, kind;
    `, query.timezone, query.month, query.month)
  ]);

  const aggregationByCode = new Map(typeRows.map((row) => [
    String(row.code),
    String(row.aggregation) as CalendarMeasurementPoint["aggregation"]
  ]));
  const groups = new Map<string, { rows: Record<string, unknown>[]; sources: Set<string> }>();
  for (const row of entryRows) {
    const date = dateOnly(row.local_date);
    const measurementCode = String(row.measurement_code);
    const key = `${date}\u0000${measurementCode}`;
    const group = groups.get(key) ?? { rows: [], sources: new Set<string>() };
    group.rows.push(row);
    if (row.source_label) group.sources.add(String(row.source_label));
    groups.set(key, group);
  }

  const measurements = [...groups.entries()].map(([key, group]) => {
    const [date, measurementCode] = key.split("\u0000");
    const aggregation = aggregationByCode.get(measurementCode) ?? "none";
    const count = group.rows.reduce((sum, row) => sum + Number(row.weight), 0);
    const values = group.rows.map((row) => Number(row.value));
    const value = aggregation === "sum"
      ? values.reduce((sum, current) => sum + current, 0)
      : aggregation === "average"
        ? group.rows.reduce((sum, row) => sum + Number(row.value) * Number(row.weight), 0) / count
        : aggregation === "min"
          ? Math.min(...values)
          : aggregation === "max"
            ? Math.max(...values)
            : values[values.length - 1];
    return {
      date,
      measurementCode,
      value,
      unit: String(group.rows[group.rows.length - 1].unit),
      count,
      min: Math.min(...group.rows.map((row) => Number(row.min_value))),
      max: Math.max(...group.rows.map((row) => Number(row.max_value))),
      aggregation,
      sources: [...group.sources].sort()
    } satisfies CalendarMeasurementPoint;
  });

  const eventsByDate = new Map<string, { count: number; kinds: Set<CalendarMonthData["events"][number]["kinds"][number]> }>();
  for (const row of eventRows) {
    const date = dateOnly(row.local_date);
    const summary = eventsByDate.get(date) ?? { count: 0, kinds: new Set() };
    const kind = String(row.kind);
    summary.count += 1;
    if (isHealthEventKind(kind)) summary.kinds.add(kind);
    eventsByDate.set(date, summary);
  }

  return {
    month: query.month,
    timezone: query.timezone,
    measurements,
    events: [...eventsByDate.entries()].map(([date, summary]) => ({
      date,
      count: summary.count,
      kinds: [...summary.kinds].sort()
    }))
  };
}

/** Returns complete local calendar days, with a fixed timeline ceiling per day. */
export async function journal(connection: duckdb.Connection, query: JournalQuery): Promise<JournalPage> {
  const dateRows = await allWithParams(connection, `
    WITH chart_entries AS (${chartEntriesSql("= ?")}),
    dated_steps AS (
      SELECT COALESCE(calendar_date, CAST(timezone(?, measured_at) AS DATE)) AS local_date
      FROM chart_entries
      WHERE measurement_code = 'steps'
    ),
    journal_dates AS (
      SELECT local_date FROM dated_steps
      UNION
      SELECT CAST(timezone(?, COALESCE(end_at, start_at)) AS DATE) FROM activities
      UNION
      SELECT CAST(timezone(?, end_at) AS DATE) FROM time_series_samples WHERE measurement_code = 'sleep_duration'
      UNION
      SELECT CAST(timezone(?, occurred_at) AS DATE) FROM health_events WHERE status = 'completed'
    )
    SELECT local_date
    FROM journal_dates
    WHERE local_date < CAST(? AS DATE)
    GROUP BY local_date
    ORDER BY local_date DESC
    LIMIT ?;
  `, "steps", "steps", "steps", "steps", query.timezone, query.timezone, query.timezone, query.timezone,
  query.beforeDate ?? "9999-12-31", query.dayLimit + 1);

  const candidateDates = dateRows.map((row) => dateOnly(row.local_date));
  const dates = candidateDates.slice(0, query.dayLimit);
  if (dates.length === 0) return { timezone: query.timezone, days: [] };

  const datePlaceholders = dates.map(() => "?").join(", ");
  const [stepRows, sleepSummaryRows, itemRows, typeRows] = await Promise.all([
    allWithParams(connection, `
      WITH chart_entries AS (${chartEntriesSql("= ?")}),
      dated_steps AS (
        SELECT COALESCE(calendar_date, CAST(timezone(?, measured_at) AS DATE)) AS local_date,
          measured_at, id, value, unit, weight, source_label
        FROM chart_entries
        WHERE measurement_code = 'steps'
      )
      SELECT * FROM dated_steps WHERE local_date IN (${datePlaceholders})
      ORDER BY local_date, measured_at, id;
    `, "steps", "steps", "steps", "steps", query.timezone, ...dates),
    allWithParams(connection, `
      SELECT CAST(timezone(?, end_at) AS DATE) AS local_date, SUM(value) AS duration_minutes
      FROM time_series_samples
      WHERE measurement_code = 'sleep_duration'
        AND CAST(timezone(?, end_at) AS DATE) IN (${datePlaceholders})
      GROUP BY local_date;
    `, query.timezone, query.timezone, ...dates),
    allWithParams(connection, `
      WITH journal_items AS (
        SELECT CAST(timezone(?, COALESCE(a.end_at, a.start_at)) AS DATE) AS local_date,
          'activity' AS item_kind, a.id, COALESCE(a.end_at, a.start_at) AS occurred_at,
          a.activity_type, a.start_at, a.end_at, a.duration_minutes, a.energy_kcal, a.distance_meters,
          NULL::DOUBLE AS value, a.source_json,
          COALESCE(s.label, s.source_kind, a.source_id) AS source_label,
          NULL::VARCHAR AS event_kind, NULL::VARCHAR AS detail
        FROM activities a
        LEFT JOIN sources s ON s.id = a.source_id
        UNION ALL
        SELECT CAST(timezone(?, t.end_at) AS DATE) AS local_date,
          'sleep' AS item_kind, t.id, t.end_at AS occurred_at,
          NULL::VARCHAR AS activity_type, t.start_at, t.end_at, NULL::DOUBLE AS duration_minutes,
          NULL::DOUBLE AS energy_kcal, NULL::DOUBLE AS distance_meters, t.value, t.source_json,
          COALESCE(s.label, s.source_kind, t.source_id) AS source_label,
          NULL::VARCHAR AS event_kind, NULL::VARCHAR AS detail
        FROM time_series_samples t
        LEFT JOIN sources s ON s.id = t.source_id
        WHERE t.measurement_code = 'sleep_duration'
        UNION ALL
        SELECT CAST(timezone(?, h.occurred_at) AS DATE) AS local_date,
          'health-event' AS item_kind, h.id, h.occurred_at AS occurred_at,
          NULL::VARCHAR AS activity_type, NULL::TIMESTAMPTZ AS start_at, NULL::TIMESTAMPTZ AS end_at,
          NULL::DOUBLE AS duration_minutes, NULL::DOUBLE AS energy_kcal, NULL::DOUBLE AS distance_meters,
          NULL::DOUBLE AS value, NULL::JSON AS source_json, h.source AS source_label,
          h.kind AS event_kind, COALESCE(NULLIF(h.provider, ''), NULLIF(h.notes, '')) AS detail
        FROM health_events h
        WHERE h.status = 'completed'
      ),
      ranked_items AS (
        SELECT *, COUNT(*) OVER (PARTITION BY local_date) AS total_items,
          ROW_NUMBER() OVER (PARTITION BY local_date ORDER BY occurred_at DESC, item_kind, id DESC) AS item_rank
        FROM journal_items
        WHERE local_date IN (${datePlaceholders})
      )
      SELECT * FROM ranked_items WHERE item_rank <= ?
      ORDER BY local_date DESC, occurred_at DESC, item_kind, id DESC;
    `, query.timezone, query.timezone, query.timezone, ...dates, journalItemsPerDayLimit),
    allWithParams(connection, "SELECT aggregation FROM measurement_types WHERE code = 'steps';")
  ]);

  const summaries = new Map<string, JournalDay["summary"]>(dates.map((date) => [date, {}]));
  const stepsAggregation = String(typeRows[0]?.aggregation ?? "sum") as CalendarMeasurementPoint["aggregation"];
  for (const [date, steps] of journalStepsByDate(stepRows, stepsAggregation)) {
    summaries.get(date)!.steps = steps;
  }
  for (const row of sleepSummaryRows) {
    summaries.get(dateOnly(row.local_date))!.sleepDurationMinutes = Number(row.duration_minutes);
  }

  const days = new Map<string, JournalDay>(dates.map((date) => [date, {
    date,
    summary: summaries.get(date)!,
    items: [],
    omittedItemCount: 0
  }]));
  for (const row of itemRows) {
    const day = days.get(dateOnly(row.local_date));
    if (!day) continue;
    day.items.push(journalTimelineItemFromRow(row));
    day.omittedItemCount = Math.max(day.omittedItemCount, Number(row.total_items) - journalItemsPerDayLimit);
  }

  return {
    timezone: query.timezone,
    days: dates.map((date) => days.get(date)!),
    ...(candidateDates.length > query.dayLimit ? { nextBeforeDate: dates.at(-1)! } : {})
  };
}

function journalStepsByDate(
  rows: Record<string, unknown>[],
  aggregation: CalendarMeasurementPoint["aggregation"]
): Map<string, NonNullable<JournalDay["summary"]["steps"]>> {
  const groups = new Map<string, { rows: Record<string, unknown>[]; sources: Set<string> }>();
  for (const row of rows) {
    const date = dateOnly(row.local_date);
    const group = groups.get(date) ?? { rows: [], sources: new Set<string>() };
    group.rows.push(row);
    if (row.source_label) group.sources.add(String(row.source_label));
    groups.set(date, group);
  }
  return new Map([...groups.entries()].map(([date, group]) => {
    const values = group.rows.map((row) => Number(row.value));
    const count = group.rows.reduce((sum, row) => sum + Number(row.weight), 0);
    const value = aggregation === "average"
      ? group.rows.reduce((sum, row) => sum + Number(row.value) * Number(row.weight), 0) / count
      : aggregation === "min"
        ? Math.min(...values)
        : aggregation === "max"
          ? Math.max(...values)
          : aggregation === "latest" || aggregation === "none"
            ? values.at(-1)!
            : values.reduce((sum, current) => sum + current, 0);
    return [date, {
      value,
      unit: String(group.rows.at(-1)!.unit),
      sources: [...group.sources].sort()
    }];
  }));
}

function journalTimelineItemFromRow(row: Record<string, unknown>): JournalTimelineItem {
  const kind = String(row.item_kind);
  const sourceLabel = optionalString(row.source_label);
  if (kind === "activity") {
    const sourceJson = optionalJson<Record<string, unknown>>(row.source_json);
    const activityType = String(row.activity_type);
    const durationMinutes = optionalNumber(row.duration_minutes);
    const distanceMeters = optionalNumber(row.distance_meters);
    const energyKcal = optionalNumber(row.energy_kcal);
    return {
      kind: "activity" as const,
      id: String(row.id),
      occurredAt: isoTimestamp(row.occurred_at),
      title: optionalString(sourceJson?.title) ?? humanizeCode(activityType),
      activityType,
      ...(durationMinutes === undefined ? {} : { durationMinutes }),
      ...(distanceMeters === undefined ? {} : { distanceMeters }),
      ...(energyKcal === undefined ? {} : { energyKcal }),
      ...(sourceLabel === undefined ? {} : { sourceLabel })
    };
  }
  if (kind === "sleep") {
    const session = sleepSessionFromRow(row);
    return {
      kind: "sleep" as const,
      id: session.id,
      occurredAt: session.endAt,
      startAt: session.startAt,
      endAt: session.endAt,
      durationMinutes: session.durationMinutes,
      stageDataStatus: session.stageDataStatus,
      ...(session.sourceLabel === undefined ? {} : { sourceLabel: session.sourceLabel })
    };
  }
  const eventKind = String(row.event_kind);
  if (!isHealthEventKind(eventKind)) throw new Error(`Journal encountered unsupported health event kind ${eventKind}.`);
  const detail = optionalString(row.detail);
  return {
    kind: "health-event" as const,
    id: String(row.id),
    occurredAt: isoTimestamp(row.occurred_at),
    eventKind,
    title: healthEventKindLabels[eventKind],
    ...(detail === undefined ? {} : { detail }),
    ...(sourceLabel === undefined ? {} : { sourceLabel })
  };
}

export async function bodyTrendTimeline(
  connection: duckdb.Connection,
  query: BodyTrendQuery
): Promise<BodyTrendTimeline> {
  const { rows, types, units } = await bodyTrendRows(connection, query.timezone, chartRangeCutoff(query.range));
  const groups = bodyTrendReadingGroups(rows, types, units);
  const complete = groups.filter(isCompleteBodyTrendReading);
  const latestByDate = new Map<string, BodyTrendReadingGroupInternal>();
  for (const group of complete) {
    const current = latestByDate.get(group.date);
    if (!current || group.observedAt > current.observedAt || (group.observedAt === current.observedAt && group.sessionId > current.sessionId)) {
      latestByDate.set(group.date, group);
    }
  }
  const allPoints = [...latestByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const truncated = allPoints.length > maxBodyTrendPoints;
  const visible = truncated ? allPoints.slice(-maxBodyTrendPoints) : allPoints;
  const massType = types.get("muscle_mass") ?? types.get("skeletal_muscle_mass");
  if (!massType) throw new Error("Body Trend requires a muscle mass measurement type.");

  return {
    generatedAt: new Date().toISOString(),
    range: query.range,
    timezone: query.timezone,
    unit: getPreferredUnit(massType, units),
    points: visible.map((group) => ({
      sessionId: group.sessionId,
      date: group.date,
      observedAt: group.observedAt,
      ...(group.sourceLabel ? { sourceLabel: group.sourceLabel } : {}),
      components: {
        muscleMass: requiredBodyTrendMuscleMetric(group).value,
        fatMass: requiredBodyTrendMetric(group, "fat_mass").value,
        boneMineralContent: requiredBodyTrendMetric(group, "bone_mineral_content").value,
        ...(optionalBodyTrendMetric(group, "weight") ? { weight: optionalBodyTrendMetric(group, "weight")!.value } : {})
      }
    })),
    totalPoints: allPoints.length,
    truncated
  };
}

export async function bodyTrendDateDetail(
  connection: duckdb.Connection,
  date: string,
  query: BodyTrendDateQuery
): Promise<BodyTrendDateDetail> {
  const { rows, types, units } = await bodyTrendRows(connection, query.timezone, undefined, date);
  const groups = bodyTrendReadingGroups(rows, types, units);
  const complete = groups.filter(isCompleteBodyTrendReading).sort((left, right) =>
    right.observedAt.localeCompare(left.observedAt) || right.sessionId.localeCompare(left.sessionId)
  );
  const selectedSession = complete[0];
  const otherReadings = groups
    .filter((group) => group.sessionId !== selectedSession?.sessionId)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.sessionId.localeCompare(left.sessionId));
  return {
    date,
    timezone: query.timezone,
    ...(selectedSession ? { selectedSession: publicBodyTrendReadingGroup(selectedSession) } : {}),
    otherReadings: otherReadings.map(publicBodyTrendReadingGroup)
  };
}

type BodyTrendProjectionRow = {
  id: string;
  session_id: string;
  group_label?: string;
  measurement_code: string;
  display_name?: string;
  observed_at: unknown;
  local_date: unknown;
  value: number;
  unit: string;
  source_label?: string;
};

type BodyTrendReadingGroupInternal = BodyTrendReadingGroup & { date: string };

async function bodyTrendRows(
  connection: duckdb.Connection,
  timezone: string,
  cutoff?: string,
  date?: string
): Promise<{ rows: BodyTrendProjectionRow[]; types: Map<string, MeasurementType>; units: Profile["units"] }> {
  const filters = ["m.category = 'body'"];
  const params: unknown[] = [timezone];
  if (cutoff) {
    filters.push("o.observed_at >= ?");
    params.push(cutoff);
  }
  if (date) {
    filters.push("COALESCE(TRY_CAST(json_extract_string(o.source_json, '$.calendarDate') AS DATE), CAST(timezone(?, o.observed_at) AS DATE)) = CAST(? AS DATE)");
    params.push(timezone, date);
  }
  const [profileRows, typeRows, rows] = await Promise.all([
    all(connection, "SELECT units FROM profile;"),
    all(connection, `SELECT ${measurementTypeColumns} FROM measurement_types WHERE category = 'body';`),
    allWithParams(connection, `
      SELECT
        o.id,
        COALESCE(o.observation_group_id, CONCAT('ungrouped:', COALESCE(o.source_id, ''), ':', CAST(o.observed_at AS VARCHAR))) AS session_id,
        g.label AS group_label,
        o.measurement_code,
        m.display AS display_name,
        o.observed_at,
        COALESCE(TRY_CAST(json_extract_string(o.source_json, '$.calendarDate') AS DATE), CAST(timezone(?, o.observed_at) AS DATE)) AS local_date,
        o.value,
        o.unit,
        COALESCE(s.label, s.source_kind, o.source_id) AS source_label
      FROM observations o
      JOIN measurement_types m ON m.code = o.measurement_code
      LEFT JOIN observation_groups g ON g.id = o.observation_group_id
      LEFT JOIN sources s ON s.id = o.source_id
      WHERE ${filters.join(" AND ")}
      ORDER BY local_date, o.observed_at, o.id;
    `, ...params)
  ]);
  return {
    rows: rows as unknown as BodyTrendProjectionRow[],
    types: new Map(typeRows.map((row) => {
      const type = measurementTypeFromRow(row);
      return [type.code, type];
    })),
    units: String(profileRows[0]?.units ?? "metric") as Profile["units"]
  };
}

function bodyTrendReadingGroups(
  rows: BodyTrendProjectionRow[],
  types: Map<string, MeasurementType>,
  units: Profile["units"]
): BodyTrendReadingGroupInternal[] {
  const groups = new Map<string, BodyTrendReadingGroupInternal>();
  for (const row of rows) {
    const type = types.get(row.measurement_code);
    if (!type) continue;
    const observedAt = isoTimestamp(row.observed_at);
    const date = dateOnly(row.local_date);
    const converted = toPreferredMeasurementValue(Number(row.value), row.unit, type, units);
    const existing = groups.get(row.session_id) ?? {
      sessionId: row.session_id,
      date,
      observedAt,
      ...(row.group_label ? { label: row.group_label } : {}),
      ...(row.source_label ? { sourceLabel: row.source_label } : {}),
      metrics: []
    };
    if (observedAt >= existing.observedAt) existing.observedAt = observedAt;
    existing.metrics.push({
      id: row.id,
      measurementCode: row.measurement_code,
      displayName: row.display_name ?? type.display,
      observedAt,
      value: converted.value,
      unit: converted.unit,
      ...(row.source_label ? { sourceLabel: row.source_label } : {})
    });
    groups.set(row.session_id, existing);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    metrics: group.metrics.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id))
  }));
}

function optionalBodyTrendMetric(group: BodyTrendReadingGroup, code: string) {
  return [...group.metrics].reverse().find((metric) => metric.measurementCode === code);
}

function requiredBodyTrendMetric(group: BodyTrendReadingGroup, code: string) {
  const metric = optionalBodyTrendMetric(group, code);
  if (!metric) throw new Error(`Body Trend complete session missing ${code}.`);
  return metric;
}

function requiredBodyTrendMuscleMetric(group: BodyTrendReadingGroup) {
  const metric = optionalBodyTrendMetric(group, "muscle_mass") ?? optionalBodyTrendMetric(group, "skeletal_muscle_mass");
  if (!metric) throw new Error("Body Trend complete session missing muscle mass.");
  return metric;
}

function isCompleteBodyTrendReading(group: BodyTrendReadingGroup) {
  return Boolean(requiredBodyTrendMuscleMetricOrUndefined(group))
    && ["fat_mass", "bone_mineral_content"].every((code) => optionalBodyTrendMetric(group, code));
}

function requiredBodyTrendMuscleMetricOrUndefined(group: BodyTrendReadingGroup) {
  return optionalBodyTrendMetric(group, "muscle_mass") ?? optionalBodyTrendMetric(group, "skeletal_muscle_mass");
}

function publicBodyTrendReadingGroup({ date: _date, ...group }: BodyTrendReadingGroupInternal): BodyTrendReadingGroup {
  return group;
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
  // Every other read in this file clamps. Leaving this one open meant a single measurement with
  // years of samples could materialise its entire history into JS.
  const effectiveLimit = Math.min(limit ?? maxMeasurementDetailRows, maxMeasurementDetailRows);
  const rows = await allWithParams(
    connection,
    `SELECT kind, id, measured_at, value, unit FROM (
      SELECT 'observation' AS kind, id, observed_at AS measured_at, value, unit
      FROM observations WHERE measurement_code = ?
      UNION ALL
      SELECT 'sample' AS kind, id, end_at AS measured_at, value, unit
      FROM time_series_samples WHERE measurement_code = ?
      UNION ALL
      SELECT 'sample' AS kind, id, end_at AS measured_at, average AS value, unit
      FROM measurement_aggregates a WHERE measurement_code = ? AND (
        granularity = '15m' OR (
          granularity = 'day' AND end_at <= COALESCE((
            SELECT MIN(recent.start_at) FROM measurement_aggregates recent
            WHERE recent.measurement_code = a.measurement_code AND recent.granularity = '15m'
          ), TIMESTAMPTZ 'infinity')
        )
      )
    ) ORDER BY measured_at DESC, kind, id LIMIT ?;`,
    measurementCode,
    measurementCode,
    measurementCode,
    effectiveLimit
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
    `SELECT ${healthEventColumns}
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
      `SELECT ${healthEventColumns} FROM health_events WHERE id = ?;`,
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

/**
 * One join instead of three correlated subqueries per row. Written once so the paged read and the
 * `includeId` top-up cannot drift into projecting different shapes.
 */
function careItemSelectSql(whereSql: string, tailSql: string): string {
  return `SELECT ${careItemColumns},
      completed_event.kind AS completed_event_kind,
      completed_event.occurred_at AS completed_event_occurred_at,
      completed_event.provider AS completed_event_provider
    FROM care_items
    LEFT JOIN health_events AS completed_event
      ON completed_event.id = care_items.completed_health_event_id
    ${whereSql}
    ${tailSql};`;
}

export async function listCareItems(
  connection: duckdb.Connection,
  query: CareItemListQuery
): Promise<PaginatedResult<CareItem>> {
  const normalized = normalizeCareItemListQuery(query);
  const { whereSql, params } = buildCareItemWhere(normalized);
  const rows = await allWithParams(
    connection,
    careItemSelectSql(
      whereSql,
      `ORDER BY
        CASE WHEN care_items.due_start IS NULL THEN 1 ELSE 0 END,
        care_items.due_start ASC,
        care_items.id ASC
      LIMIT ? OFFSET ?`
    ),
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
      careItemSelectSql("WHERE care_items.id = ?", ""),
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

export async function listMedications(
  connection: duckdb.Connection,
  query: MedicationListQuery
): Promise<PaginatedResult<Medication>> {
  const normalized = normalizeMedicationListQuery(query);
  const { whereSql, params } = buildMedicationWhere(normalized);
  const rows = await allWithParams(
    connection,
    `SELECT * FROM medications ${whereSql}
      ORDER BY
        start_date IS NULL,
        start_date DESC,
        id ASC
      LIMIT ? OFFSET ?;`,
    ...params,
    normalized.limit,
    normalized.offset
  );
  const totalRows = await allWithParams(
    connection,
    `SELECT COUNT(*) AS count FROM medications ${whereSql};`,
    ...params
  );
  const items = rows.map(medicationFromRow);
  if (normalized.includeId && !items.some((item) => item.id === normalized.includeId)) {
    const includedRows = await allWithParams(connection, "SELECT * FROM medications WHERE id = ?;", normalized.includeId);
    if (includedRows[0]) items.push(medicationFromRow(includedRows[0]));
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

export async function listObservationGroups(
  connection: duckdb.Connection,
  query: ObservationGroupListQuery
): Promise<PaginatedResult<ObservationGroupListItem>> {
  const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);
  const offset = Math.max(Number(query.offset ?? 0), 0);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.kinds?.length) {
    clauses.push(`g.kind IN (${query.kinds.map(() => "?").join(", ")})`);
    params.push(...query.kinds);
  }
  const panelDateSql = "COALESCE(g.collected_at, g.start_at, g.end_at)";
  if (query.dateFrom) {
    clauses.push(`${panelDateSql} IS NOT NULL AND CAST(${panelDateSql} AS DATE) >= CAST(? AS DATE)`);
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    clauses.push(`${panelDateSql} IS NOT NULL AND CAST(${panelDateSql} AS DATE) <= CAST(? AS DATE)`);
    params.push(query.dateTo);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await allWithParams(connection, `
    SELECT
      g.id,
      g.kind,
      g.label,
      ${panelDateSql} AS panel_date,
      COUNT(o.id) AS measurement_count
    FROM observation_groups g
    LEFT JOIN observations o ON o.observation_group_id = g.id
    ${whereSql}
    GROUP BY g.id, g.kind, g.label, g.collected_at, g.start_at, g.end_at
    ORDER BY panel_date IS NULL, panel_date DESC, g.id ASC
    LIMIT ? OFFSET ?;
  `, ...params, limit, offset);
  const totalRows = await allWithParams(
    connection,
    `SELECT COUNT(*) AS count FROM observation_groups g ${whereSql};`,
    ...params
  );
  const items = rows.map((row): ObservationGroupListItem => ({
    id: String(row.id),
    kind: String(row.kind) as ObservationGroupListItem["kind"],
    label: String(row.label),
    date: row.panel_date == null ? undefined : isoTimestamp(row.panel_date),
    measurementCount: Number(row.measurement_count)
  }));
  const total = Number(totalRows[0]?.count ?? 0);
  return {
    items,
    total,
    offset,
    limit,
    hasMore: offset + rows.length < total
  };
}

function medicationFromRow(row: Record<string, unknown>): Medication {
  return medicationSchema.parse({
    id: String(row.id),
    name: String(row.name),
    activeIngredient: optionalString(row.active_ingredient),
    dose: optionalNumber(row.dose),
    unit: optionalString(row.unit),
    startDate: row.start_date == null ? undefined : dateOnly(row.start_date),
    endDate: row.end_date == null ? undefined : dateOnly(row.end_date),
    notes: optionalString(row.notes),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at)
  });
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
    allWithParams(connection, `SELECT ${measurementTypeColumns} FROM measurement_types WHERE code = ?;`, measurementCode),
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

async function hydrateHealthEventRows(
  connection: duckdb.Connection,
  rows: Array<Record<string, unknown>>
): Promise<HealthEvent[]> {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => String(row.id));
  const placeholders = ids.map(() => "?").join(", ");
  const immunizationRows = await allWithParams(
    connection,
    `SELECT * FROM immunizations WHERE health_event_id IN (${placeholders});`,
    ...ids
  );
  const immunizations = new Map(immunizationRows.map((row) => [String(row.health_event_id), row]));
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
    // Base-only health event records are valid even when no subtype table row exists.
    if (kind === "immunization") {
      return { ...base, kind: "immunization" } satisfies HealthEvent;
    }
    if (kind === "medication") {
      return { ...base, kind: "medication" } satisfies HealthEvent;
    }
    return { ...base, kind } satisfies HealthEvent;
  });
}

function careItemFromRow(row: Record<string, unknown>): CareItem {
  const completedHealthEventId = optionalString(row.completed_health_event_id);
  return {
    id: String(row.id),
    kind: normalizedCareItemKind(String(row.kind)),
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
    clauses.push("care_items.kind = ?");
    params.push(query.kind);
  }

  if (query.status) {
    clauses.push("care_items.status = ?");
    params.push(query.status);
  }
  if (query.priority) {
    clauses.push("care_items.priority = ?");
    params.push(query.priority);
  }
  if (query.dueFrom) {
    clauses.push("care_items.due_start >= ?");
    params.push(query.dueFrom);
  }
  if (query.dueTo) {
    clauses.push("care_items.due_start <= ?");
    params.push(query.dueTo);
  }
  if (query.search) {
    clauses.push(
      "(LOWER(care_items.title) LIKE ? OR LOWER(care_items.kind) LIKE ? OR LOWER(COALESCE(care_items.notes, '')) LIKE ?)"
    );
    const token = `%${query.search.toLowerCase()}%`;
    params.push(token, token, token);
  }
  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

interface NormalizedMedicationListQuery {
  limit: number;
  offset: number;
  search?: string;
  startedFrom?: string;
  startedTo?: string;
  includeId?: string;
}

function normalizeMedicationListQuery(query: MedicationListQuery): NormalizedMedicationListQuery {
  return {
    limit: Math.min(Math.max(Number(query.limit ?? 20), 1), 100),
    offset: Math.max(Number(query.offset ?? 0), 0),
    search: query.search?.trim() || undefined,
    startedFrom: query.startedFrom,
    startedTo: query.startedTo,
    includeId: query.includeId?.trim() || undefined
  };
}

function buildMedicationWhere(query: NormalizedMedicationListQuery): { whereSql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.startedFrom) {
    clauses.push("start_date >= ?");
    params.push(query.startedFrom);
  }
  if (query.startedTo) {
    clauses.push("start_date <= ?");
    params.push(query.startedTo);
  }
  if (query.search) {
    clauses.push(
      "(LOWER(name) LIKE ? OR LOWER(COALESCE(active_ingredient, '')) LIKE ?)"
    );
    const token = `%${query.search.toLowerCase()}%`;
    params.push(token, token);
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
const maxBodyTrendPoints = 500;
/** Ceiling for the raw per-measurement history read. Generous, but no longer unbounded. */
const maxMeasurementDetailRows = 5000;