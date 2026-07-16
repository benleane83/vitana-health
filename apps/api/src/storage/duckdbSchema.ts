import type duckdb from "duckdb";
import { defaultMeasurementTypes } from "@local-fitness-advisor/shared";
import { mergeDefaultMeasurementType } from "../measurementRegistry.js";
import {
  all,
  json,
  measurementTypeFromRow,
  measurementTypeProperties,
  run
} from "./duckdbRows.js";

export async function schemaVersions(connection: duckdb.Connection): Promise<number[]> {
  const rows = await all(connection, "SELECT schema_version FROM poc_metadata ORDER BY schema_version;");
  return rows.map((row) => Number(row.schema_version));
}

export async function reconcileDefaultMeasurementTypes(
  connection: duckdb.Connection,
  runInTransaction: (operation: () => Promise<void>) => Promise<void>
): Promise<void> {
  const profileRows = await all(connection, "SELECT COUNT(*) AS count FROM profile;");
  if (Number(profileRows[0]?.count ?? 0) === 0) {
    return;
  }
  const [existingRows, referencedRows] = await Promise.all([
    all(connection, "SELECT * EXCLUDE (ordinal) FROM measurement_types;"),
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
  });
}