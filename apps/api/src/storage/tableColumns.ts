/**
 * Explicit column lists for the tables whose rows are mapped straight onto DTOs.
 *
 * These exist for two reasons. First, `SELECT * EXCLUDE (...)` is DuckDB-specific syntax with no
 * SQLite equivalent, so every use of it is a step away from the storage swap the project wants to
 * keep open. Second, `*` silently widens: adding a column to the schema changes what every read
 * returns, which is how a multi-megabyte `imports.raw_content` ends up inside an API response.
 *
 * `ordinal` is deliberately absent from every list - it is an internal insertion counter used for
 * stable ordering, never part of a DTO. Keep these in step with the DDL in `duckdbRuntime.ts`.
 */

const columns = (...names: string[]): string => names.join(", ");

/** Qualifies a column list with a table alias, for example `o.id, o.measurement_code, ...`. */
export function qualify(alias: string, columnList: string): string {
  return columnList.split(", ").map((column) => `${alias}.${column}`).join(", ");
}

export const measurementTypeColumns = columns(
  "code", "display", "category", "kind", "canonical_unit", "aliases", "aggregation", "custom_properties"
);

export const observationColumns = columns(
  "id", "measurement_code", "observed_at", "effective_start", "effective_end", "value", "unit",
  "source_id", "observation_group_id", "device_id", "note", "source_json_present", "source_json",
  "source_unit"
);

export const healthEventColumns = columns(
  "id", "kind", "status", "occurred_at", "source", "provider", "notes", "metadata"
);

export const careItemColumns = columns(
  "id", "kind", "code", "title", "due_start", "reminder_at", "priority", "status",
  "schedule_provenance", "schedule_version", "notes", "completed_health_event_id", "completed_at"
);
