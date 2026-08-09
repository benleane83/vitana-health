import type duckdb from "duckdb";
import {
  canonicalizeMeasurement,
  describeMeasurementRejection,
  type ActivitySession,
  type HealthStoreData,
  type MeasurementType,
  type Observation,
  type PersonalReferenceRange,
  type Profile,
  type TimeSeriesSample
} from "@vitana/shared";
import { selectColumns, tableColumns, type PersistedTable } from "./duckdbColumns.js";

export type DuckDbRow = Record<string, unknown>;

export function personalReferenceRangeFromRow(row: DuckDbRow): PersonalReferenceRange {
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

export function exec(connection: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.exec(sql, (error) => error ? reject(error) : resolvePromise());
  });
}

export function run(connection: duckdb.Connection, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.run(sql, ...params, (error) => error ? reject(error) : resolvePromise());
  });
}

export function all(connection: duckdb.Connection, sql: string): Promise<DuckDbRow[]> {
  return new Promise((resolvePromise, reject) => {
    connection.all(sql, (error, rows) => error ? reject(error) : resolvePromise((rows ?? []) as DuckDbRow[]));
  });
}

export function allWithParams(
  connection: duckdb.Connection,
  sql: string,
  ...params: unknown[]
): Promise<DuckDbRow[]> {
  return new Promise((resolvePromise, reject) => {
    connection.all(sql, ...params, (error, rows) =>
      error ? reject(error) : resolvePromise((rows ?? []) as DuckDbRow[]));
  });
}

export function orderedRows(connection: duckdb.Connection, table: PersistedTable): Promise<DuckDbRow[]> {
  return all(connection, `SELECT ${selectColumns(table, { excludeOrdinal: true })} FROM ${table} ORDER BY ordinal;`);
}

export interface InsertOptions {
  /** Import paths tolerate re-submitted rows; export/restore paths want a hard failure instead. */
  ignoreDuplicates?: boolean;
  /** Aggregate retries replace the complete deterministic bucket rather than appending a duplicate. */
  updateDuplicatesById?: boolean;
  /**
   * Collect the `id` of every row the statement actually wrote. Duplicate rows suppressed by
   * `ignoreDuplicates` are absent, which is what import accounting and replica change tracking
   * need - and it costs one statement instead of a pair of `COUNT(*)` scans.
   */
  returningIds?: boolean;
}

/**
 * Bulk-inserts positional tuples against an explicit column list. Chunking keeps each statement
 * inside DuckDB's parameter budget, and the string-character cap stops a handful of very large
 * values (raw import payloads, source JSON) from producing an oversized statement.
 *
 * Returns the inserted ids when `returningIds` is set, otherwise an empty array.
 */
export async function insertRows(
  connection: duckdb.Connection,
  table: PersistedTable,
  rows: readonly unknown[][],
  options: InsertOptions = {}
): Promise<string[]> {
  if (rows.length === 0) {
    return [];
  }
  const columns = tableColumns[table] as readonly string[];
  if (rows.some((row) => row.length !== columns.length)) {
    throw new Error(`DuckDB bulk insert into ${table} expects ${columns.length} values per row.`);
  }
  if (options.ignoreDuplicates && options.updateDuplicatesById) {
    throw new Error("DuckDB bulk insert cannot both ignore and update duplicates.");
  }
  const prefix = `INSERT${options.ignoreDuplicates ? " OR IGNORE" : ""} INTO ${table} (${columns.join(", ")}) VALUES `;
  const updatableColumns = columns.filter((column) => column !== "id" && column !== "ordinal");
  const conflictClause = options.updateDuplicatesById
    ? ` ON CONFLICT (id) DO UPDATE SET ${updatableColumns.map((column) => `${column} = excluded.${column}`).join(", ")}`
    : "";
  const suffix = `${conflictClause}${options.returningIds ? " RETURNING id" : ""}`;
  const rowPlaceholder = `(${columns.map(() => "?").join(", ")})`;
  const maxChunkRows = Math.max(1, Math.floor(3_000 / columns.length));
  const maxChunkStringChars = 2_000_000;
  const insertedIds: string[] = [];
  for (let index = 0; index < rows.length;) {
    const chunk: unknown[][] = [];
    let chunkStringChars = 0;
    while (index < rows.length && chunk.length < maxChunkRows) {
      const row = rows[index]!;
      const rowStringChars = row.reduce<number>(
        (total, value) => total + (typeof value === "string" ? value.length : 0),
        0
      );
      if (chunk.length > 0 && chunkStringChars + rowStringChars > maxChunkStringChars) {
        break;
      }
      chunk.push(row as unknown[]);
      chunkStringChars += rowStringChars;
      index += 1;
    }
    const sql = `${prefix}${Array.from({ length: chunk.length }, () => rowPlaceholder).join(", ")}${suffix};`;
    if (options.returningIds) {
      const returned = await allWithParams(connection, sql, ...chunk.flat());
      for (const row of returned) {
        insertedIds.push(String(row.id));
      }
    } else {
      await run(connection, sql, ...chunk.flat());
    }
  }
  return insertedIds;
}

export interface MeasurementInsertResult<T> {
  /** Rows that survived canonicalization, in submission order. */
  accepted: T[];
  /** Rows the database actually wrote - `accepted` minus anything suppressed as a duplicate. */
  inserted: T[];
  rejections: string[];
}

// `firstOrdinal + index` is safe only because callers reserve the range behind `enqueueMutation`.
// Repository-direct/multi-process writes are unsupported; SQLite needs an atomic allocator.

function insertedSubset<T extends { id: string }>(accepted: T[], insertedIds: string[]): T[] {
  if (insertedIds.length === accepted.length) {
    return accepted;
  }
  const ids = new Set(insertedIds);
  return accepted.filter((entry) => ids.has(entry.id));
}

export async function insertObservationRows(
  connection: duckdb.Connection,
  observations: readonly Observation[],
  firstOrdinal: number
): Promise<MeasurementInsertResult<Observation>> {
  const rejections: string[] = [];
  const accepted: Observation[] = [];
  const rows: unknown[][] = [];
  for (const entry of observations) {
    const canonical = canonicalizeMeasurement(entry.measurementCode, entry.value, entry.unit);
    if (canonical.rejected) {
      rejections.push(describeMeasurementRejection(canonical));
      continue;
    }
    accepted.push({ ...entry, value: canonical.value, unit: canonical.unit });
    rows.push([
      firstOrdinal + rows.length,
      entry.id,
      entry.measurementCode,
      entry.observedAt,
      entry.effectiveStart ?? null,
      entry.effectiveEnd ?? null,
      canonical.value,
      canonical.unit,
      entry.sourceId,
      entry.observationGroupId ?? null,
      entry.deviceId ?? null,
      entry.note ?? null,
      entry.sourceJson !== undefined,
      optionalJsonValue(entry.sourceJson),
      canonical.sourceUnit ?? null
    ]);
  }
  const insertedIds = await insertRows(
    connection, "observations", rows, { ignoreDuplicates: true, returningIds: true });
  return { accepted, inserted: insertedSubset(accepted, insertedIds), rejections };
}

export async function insertTimeSeriesSampleRows(
  connection: duckdb.Connection,
  samples: readonly TimeSeriesSample[],
  firstOrdinal: number,
  options: InsertOptions = {}
): Promise<MeasurementInsertResult<TimeSeriesSample>> {
  const rejections: string[] = [];
  const accepted: TimeSeriesSample[] = [];
  const rows: unknown[][] = [];
  for (const entry of samples) {
    const canonical = canonicalizeMeasurement(entry.measurementCode, entry.value, entry.unit);
    if (canonical.rejected) {
      rejections.push(describeMeasurementRejection(canonical));
      continue;
    }
    accepted.push({ ...entry, value: canonical.value, unit: canonical.unit });
    rows.push([
      firstOrdinal + rows.length,
      entry.id,
      entry.measurementCode,
      entry.startAt,
      entry.endAt,
      canonical.value,
      canonical.unit,
      entry.sourceId,
      entry.deviceId ?? null,
      entry.sourceJson !== undefined,
      optionalJsonValue(entry.sourceJson),
      canonical.sourceUnit ?? null
    ]);
  }
  const insertedIds = await insertRows(connection, "time_series_samples", rows, options);
  return {
    accepted,
    inserted: options.returningIds ? insertedSubset(accepted, insertedIds) : accepted,
    rejections
  };
}

/**
 * Activity metrics have no unit column - duration is always minutes, energy always kcal and
 * distance always metres - so there is nothing to canonicalize here.
 */
export async function insertActivityRows(
  connection: duckdb.Connection,
  activities: readonly ActivitySession[],
  firstOrdinal: number,
  options: InsertOptions = {}
): Promise<ActivitySession[]> {
  const insertedIds = await insertRows(
    connection,
    "activities",
    activities.map((entry, index) => [
      firstOrdinal + index,
      entry.id,
      entry.activityType,
      entry.startAt,
      entry.endAt ?? null,
      entry.durationMinutes ?? null,
      entry.energyKcal ?? null,
      entry.distanceMeters ?? null,
      entry.sourceId,
      entry.sourceJson !== undefined,
      optionalJsonValue(entry.sourceJson)
    ]),
    options
  );
  return options.returningIds
    ? insertedSubset([...activities], insertedIds)
    : [...activities];
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function optionalJsonValue(value: unknown): string | null {
  return value === undefined ? null : json(value);
}

export function requiredJson<T>(value: unknown): T {
  const parsed = optionalJson<T>(value);
  if (parsed === undefined) {
    throw new Error("DuckDB expected a required JSON value.");
  }
  return parsed;
}

export function optionalJson<T = unknown>(value: unknown): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

export function optionalDate(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function optionalTimestamp(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : isoTimestamp(value);
}

export function isoTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== "string") {
    throw new Error("DuckDB returned an invalid timestamp.");
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(normalized) ? normalized : `${normalized}Z`).toISOString();
}

export function dateOnly(value: unknown): string {
  return isoTimestamp(value).slice(0, 10);
}

export function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

export function withStoredJson(
  value: Record<string, unknown>,
  present: unknown,
  storedJson: unknown
): Record<string, unknown> {
  if (!Boolean(present)) {
    return value;
  }
  return {
    ...value,
    sourceJson: storedJson === null || storedJson === undefined ? null : optionalJson(storedJson)
  };
}

export function measurementTypeFromRow(row: DuckDbRow): MeasurementType {
  const properties = optionalJson<Record<string, unknown>>(row.custom_properties) ?? {};
  return {
    code: String(row.code),
    display: String(row.display),
    category: String(row.category) as MeasurementType["category"],
    kind: String(row.kind) as MeasurementType["kind"],
    canonicalUnit: String(row.canonical_unit),
    aliases: requiredJson<string[]>(row.aliases),
    ...properties,
    description: String(properties.description ?? ""),
    aggregation: String(row.aggregation) as MeasurementType["aggregation"]
  };
}

export function measurementTypeProperties(entry: MeasurementType): Record<string, unknown> {
  return compact({
    description: entry.description,
    preferredUnits: entry.preferredUnits,
    unitAliases: entry.unitAliases,
    fhirCode: entry.fhirCode,
    loincCode: entry.loincCode,
    openMHealthSchema: entry.openMHealthSchema,
    normalLow: entry.normalLow,
    normalHigh: entry.normalHigh,
    referenceRanges: entry.referenceRanges
  });
}

export function profileFromRow(row: DuckDbRow): Profile {
  const profileProperties = optionalJson<Record<string, unknown>>(row.custom_properties) ?? {};
  return compact({
    id: row.id,
    displayName: row.display_name,
    setupStatus: profileProperties.setupStatus ?? "complete",
    subjectKind: row.subject_kind ?? "adult",
    birthDate: optionalDate(row.birth_date),
    sex: row.sex,
    heightCm: optionalNumber(row.height_cm),
    bloodType: row.blood_type,
    goalSummary: row.goal_summary,
    pet: row.pet_species ? compact({ species: row.pet_species, breed: row.pet_breed, reproductiveStatus: row.pet_reproductive_status, microchipId: row.pet_microchip_id }) : undefined,
    cloudAiConsent: profileProperties.cloudAiConsent,
    units: row.units,
    updatedAt: isoTimestamp(row.updated_at)
  }) as unknown as Profile;
}
export function profileProperties(profile: Profile): Record<string, unknown> {
  return compact({
    cloudAiConsent: profile.cloudAiConsent,
    setupStatus: profile.setupStatus
  });
}

export function observationFromRow(row: DuckDbRow): Observation {
  return withStoredJson(compact({
    id: row.id,
    measurementCode: row.measurement_code,
    observedAt: isoTimestamp(row.observed_at),
    effectiveStart: optionalTimestamp(row.effective_start),
    effectiveEnd: optionalTimestamp(row.effective_end),
    value: Number(row.value),
    unit: row.unit,
    sourceId: row.source_id,
    observationGroupId: row.observation_group_id,
    deviceId: row.device_id,
    note: row.note
  }), row.source_json_present, row.source_json) as unknown as Observation;
}

export function insightFromRow(row: DuckDbRow): HealthStoreData["insights"][number] {
  return {
    id: String(row.id),
    createdAt: isoTimestamp(row.created_at),
    title: String(row.title),
    body: String(row.body),
    evidence: requiredJson(row.evidence),
    confidence: row.confidence,
    model: row.model,
    safetyNotice: String(row.safety_notice)
  } as HealthStoreData["insights"][number];
}