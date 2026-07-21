import type duckdb from "duckdb";
import type {
  HealthStoreData,
  MeasurementType,
  Observation,
  Profile
} from "@vitana/shared";

export type DuckDbRow = Record<string, unknown>;

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

export function orderedRows(connection: duckdb.Connection, table: string): Promise<DuckDbRow[]> {
  return all(connection, `SELECT * EXCLUDE (ordinal) FROM ${table} ORDER BY ordinal;`);
}

export async function insertRows(connection: duckdb.Connection, sql: string, rows: unknown[][]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const match = /^(INSERT(?: OR IGNORE)? INTO .+ VALUES )\(([^;]+)\);$/s.exec(sql);
  if (!match) {
    throw new Error("DuckDB bulk insert received an unsupported SQL shape.");
  }
  const columnCount = rows[0].length;
  if (columnCount < 1 || rows.some((row) => row.length !== columnCount)) {
    throw new Error("DuckDB bulk insert rows must have a consistent positive column count.");
  }
  const maxChunkRows = Math.max(1, Math.floor(3_000 / columnCount));
  const maxChunkStringChars = 2_000_000;
  const rowPlaceholder = `(${match[2]})`;
  for (let index = 0; index < rows.length;) {
    const chunk: unknown[][] = [];
    let chunkStringChars = 0;
    while (index < rows.length && chunk.length < maxChunkRows) {
      const row = rows[index];
      const rowStringChars = row.reduce<number>(
        (total, value) => total + (typeof value === "string" ? value.length : 0),
        0
      );
      if (chunk.length > 0 && chunkStringChars + rowStringChars > maxChunkStringChars) {
        break;
      }
      chunk.push(row);
      chunkStringChars += rowStringChars;
      index += 1;
    }
    await run(
      connection,
      `${match[1]}${Array.from({ length: chunk.length }, () => rowPlaceholder).join(", ")};`,
      ...chunk.flat()
    );
  }
}

export async function insertObservationRows(
  connection: duckdb.Connection,
  observations: Observation[],
  firstOrdinal: number
): Promise<void> {
  const chunkSize = 500;
  for (let index = 0; index < observations.length; index += chunkSize) {
    const chunk = observations.slice(index, index + chunkSize).map((entry, chunkIndex) => ({
      ordinal: firstOrdinal + index + chunkIndex,
      id: entry.id,
      measurementCode: entry.measurementCode,
      observedAt: entry.observedAt,
      effectiveStart: entry.effectiveStart ?? null,
      effectiveEnd: entry.effectiveEnd ?? null,
      value: entry.value,
      unit: entry.unit,
      sourceId: entry.sourceId,
      observationGroupId: entry.observationGroupId ?? null,
      deviceId: entry.deviceId ?? null,
      note: entry.note ?? null,
      sourceJsonPresent: entry.sourceJson !== undefined,
      sourceJson: optionalJsonValue(entry.sourceJson)
    }));
    await run(
      connection,
      `INSERT OR IGNORE INTO observations
      SELECT
        CAST(value->>'ordinal' AS BIGINT), value->>'id', value->>'measurementCode',
        CAST(value->>'observedAt' AS TIMESTAMP), CAST(value->>'effectiveStart' AS TIMESTAMP),
        CAST(value->>'effectiveEnd' AS TIMESTAMP), CAST(value->>'value' AS DOUBLE), value->>'unit',
        value->>'sourceId', value->>'observationGroupId', value->>'deviceId', value->>'note',
        CAST(value->>'sourceJsonPresent' AS BOOLEAN), CAST(value->>'sourceJson' AS JSON)
      FROM json_each(?);`,
      JSON.stringify(chunk)
    );
  }
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
    subjectKind: row.subject_kind ?? "adult",
    birthDate: optionalDate(row.birth_date),
    sex: row.sex,
    heightCm: optionalNumber(row.height_cm),
    bloodType: row.blood_type,
    goalSummary: row.goal_summary,
    pet: row.pet_species ? compact({ species: row.pet_species, breed: row.pet_breed, reproductiveStatus: row.pet_reproductive_status, microchipId: row.pet_microchip_id }) : undefined,
    ...profileProperties,
    units: row.units,
    updatedAt: isoTimestamp(row.updated_at)
  }) as unknown as Profile;
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