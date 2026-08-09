import { createHash } from "node:crypto";
import type duckdb from "duckdb";
import { defaultMeasurementTypes } from "@vitana/shared";
import { mergeDefaultMeasurementType } from "../measurementRegistry.js";
import { replicaUpsert, type ReplicaChangeInput } from "./duckdbReplicaChanges.js";
import {
  all,
  json,
  measurementTypeFromRow,
  measurementTypeProperties,
  run
} from "./duckdbRows.js";
import { selectColumns } from "./duckdbColumns.js";

// Named column lists, not `SELECT * EXCLUDE (...)`: that syntax is DuckDB-only, and `*` silently
// widens every DTO the moment the schema gains a column.
const measurementTypeColumns = selectColumns("measurement_types", { excludeOrdinal: true });
const measurementRegistryFingerprint = createHash("sha256")
  .update(JSON.stringify(defaultMeasurementTypes))
  .digest("hex");

export function recordCurrentMeasurementRegistry(connection: duckdb.Connection): Promise<void> {
  return run(
    connection,
    `INSERT INTO schema_objects (name, fingerprint) VALUES ('measurement_registry', ?)
     ON CONFLICT (name) DO UPDATE SET fingerprint = EXCLUDED.fingerprint;`,
    measurementRegistryFingerprint
  );
}

export async function schemaVersions(connection: duckdb.Connection): Promise<number[]> {
  const rows = await all(connection, "SELECT schema_version FROM poc_metadata ORDER BY schema_version;");
  return rows.map((row) => Number(row.schema_version));
}

export async function reconcileDefaultMeasurementTypes(
  connection: duckdb.Connection,
  runInTransaction: <T>(
    operation: () => Promise<T>,
    replicaChanges: (result: T) => ReplicaChangeInput[]
  ) => Promise<T>
): Promise<void> {
  const profileRows = await all(connection, "SELECT COUNT(*) AS count FROM profile;");
  if (Number(profileRows[0]?.count ?? 0) === 0) {
    return;
  }
  const fingerprintRows = await all(
    connection,
    "SELECT fingerprint FROM schema_objects WHERE name = 'measurement_registry';"
  );
  if (String(fingerprintRows[0]?.fingerprint ?? "") !== measurementRegistryFingerprint) {
    await resetMeasurementTypeMetadataFromRegistry(connection, runInTransaction);
    return;
  }
  const [existingRows, referencedRows] = await Promise.all([
    all(connection, `SELECT ${measurementTypeColumns} FROM measurement_types;`),
    all(connection, `
      SELECT measurement_code FROM observations
      UNION
      SELECT measurement_code FROM time_series_samples
      UNION
      SELECT 'activity_sessions' AS measurement_code FROM activities;
    `)
  ]);
  const existingByCode = new Map(existingRows.map((row) => [String(row.code), row]));
  const referencedCodes = new Set(referencedRows.map((row) => String(row.measurement_code)));
  const referencedDefaultTypes = defaultMeasurementTypes.filter((type) => referencedCodes.has(type.code));
  const missingTypes = referencedDefaultTypes.filter((type) => !existingByCode.has(type.code));
  const refreshedTypes = defaultMeasurementTypes.flatMap((entry) => {
    const existingRow = existingByCode.get(entry.code);
    if (!existingRow) return [];
    const existing = measurementTypeFromRow(existingRow);
    const merged = mergeDefaultMeasurementType(existing, entry);
    return merged === existing ? [] : [merged];
  });
  const retiredTypes = defaultMeasurementTypes.filter((type) => {
    const existing = existingByCode.get(type.code);
    return String(existing?.category) === "metabolic";
  });
  const updatedTypes = new Map(refreshedTypes.map((type) => [type.code, type]));
  for (const type of retiredTypes) {
    updatedTypes.set(type.code, type);
  }
  if (missingTypes.length === 0 && updatedTypes.size === 0) {
    return;
  }
  // The retired "metabolic" category no longer validates, so heal it before the tracked transaction below.
  for (const type of retiredTypes) {
    await run(connection, "UPDATE measurement_types SET category = ? WHERE code = ?;", type.category, type.code);
  }
  const touchedCodes = [...missingTypes.map((type) => type.code), ...updatedTypes.keys()];
  await runInTransaction(async () => {
    const ordinalRows = await all(connection, "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM measurement_types;");
    let ordinal = Number(ordinalRows[0]?.ordinal ?? 0);
    for (const entry of missingTypes) {
      await run(
        connection,
        "INSERT INTO measurement_types VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
        ordinal,
        entry.code,
        entry.display,
        entry.category,
        entry.kind,
        entry.canonicalUnit,
        json(entry.aliases),
        entry.aggregation,
        json(measurementTypeProperties(entry))
      );
      ordinal += 1;
    }
    for (const entry of updatedTypes.values()) {
      await run(
        connection,
        `UPDATE measurement_types
         SET display = ?, category = ?, kind = ?, canonical_unit = ?, aliases = ?, aggregation = ?, custom_properties = ?
         WHERE code = ?;`,
        entry.display,
        entry.category,
        entry.kind,
        entry.canonicalUnit,
        json(entry.aliases),
        entry.aggregation,
        json(measurementTypeProperties(entry)),
        entry.code
      );
    }
    const written = await all(
      connection,
      `SELECT ${measurementTypeColumns} FROM measurement_types WHERE code IN (${
        touchedCodes.map((code) => `'${code.replace(/'/g, "''")}'`).join(", ")});`
    );
    return written.map((row) => measurementTypeFromRow(row));
  }, (types) => types.map((type) => replicaUpsert("measurement-type", type.code, type)));
}

export interface MeasurementRegistryResetResult {
  refreshed: number;
  inserted: number;
}

export async function resetMeasurementTypeMetadataFromRegistry(
  connection: duckdb.Connection,
  runInTransaction: <T>(
    operation: () => Promise<T>,
    replicaChanges: (result: T) => ReplicaChangeInput[]
  ) => Promise<T>
): Promise<MeasurementRegistryResetResult> {
  const existingRows = await all(connection, "SELECT code FROM measurement_types;");
  const existingCodes = new Set(existingRows.map((row) => String(row.code)));

  const result = await runInTransaction(async () => {
    const ordinalRows = await all(connection, "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM measurement_types;");
    let ordinal = Number(ordinalRows[0]?.ordinal ?? 0);
    let refreshed = 0;
    let inserted = 0;

    for (const entry of defaultMeasurementTypes) {
      if (existingCodes.has(entry.code)) {
        await run(
          connection,
          `UPDATE measurement_types
           SET display = ?, category = ?, kind = ?, canonical_unit = ?, aliases = ?, aggregation = ?, custom_properties = ?
           WHERE code = ?;`,
          entry.display,
          entry.category,
          entry.kind,
          entry.canonicalUnit,
          json(entry.aliases),
          entry.aggregation,
          json(measurementTypeProperties(entry)),
          entry.code
        );
        refreshed += 1;
        continue;
      }

      await run(
        connection,
        "INSERT INTO measurement_types VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
        ordinal,
        entry.code,
        entry.display,
        entry.category,
        entry.kind,
        entry.canonicalUnit,
        json(entry.aliases),
        entry.aggregation,
        json(measurementTypeProperties(entry))
      );
      ordinal += 1;
      inserted += 1;
    }

    // The registry rewrites every default type, so read the rows back once and replicate them from
    // their persisted shape rather than from the in-memory registry entries.
    const touchedCodes = new Set(defaultMeasurementTypes.map((entry) => entry.code));
    const rows = await all(connection, `SELECT ${measurementTypeColumns} FROM measurement_types;`);
    const replicated = rows
      .map((row) => measurementTypeFromRow(row))
      .filter((type) => touchedCodes.has(type.code));

    await recordCurrentMeasurementRegistry(connection);

    return { refreshed, inserted, replicated };
  }, (operationResult) => operationResult.replicated.map(
    (type) => replicaUpsert("measurement-type", type.code, type)
  ));

  return { refreshed: result.refreshed, inserted: result.inserted };
}