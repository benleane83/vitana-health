/**
 * Every persisted column, named once. Inserts and reads both build their SQL from these lists so
 * that positional `VALUES (?, ?, ...)` tuples and `SELECT *` can never silently drift when the
 * baseline schema gains a column.
 */
export const tableColumns = {
  profile: [
    "id", "display_name", "sex", "height_cm", "blood_type", "goal_summary", "units", "updated_at",
    "custom_properties", "subject_kind", "birth_date", "pet_species", "pet_breed",
    "pet_reproductive_status", "pet_microchip_id"
  ],
  imports: [
    "ordinal", "id", "source_kind", "file_name", "imported_at", "parser_version", "checksum",
    "row_count", "status", "diagnostics", "raw_content"
  ],
  sources: ["ordinal", "id", "source_kind", "label", "import_id", "created_at"],
  devices: ["ordinal", "id", "label", "manufacturer", "model", "source_id"],
  measurement_types: [
    "ordinal", "code", "display", "category", "kind", "canonical_unit", "aliases", "aggregation",
    "custom_properties"
  ],
  observation_groups: [
    "ordinal", "id", "kind", "label", "source_id", "import_id", "start_at", "end_at", "collected_at",
    "metadata"
  ],
  observations: [
    "ordinal", "id", "measurement_code", "observed_at", "effective_start", "effective_end", "value",
    "unit", "source_id", "observation_group_id", "device_id", "note", "source_json_present",
    "source_json", "source_unit"
  ],
  time_series_samples: [
    "ordinal", "id", "measurement_code", "start_at", "end_at", "value", "unit", "source_id",
    "device_id", "source_json_present", "source_json", "source_unit"
  ],
  measurement_aggregates: [
    "ordinal", "id", "measurement_code", "granularity", "start_at", "end_at", "average",
    "minimum", "maximum", "measurement_count", "unit", "source_id", "calendar_date",
    "source_json_present", "source_json"
  ],
  activities: [
    "ordinal", "id", "activity_type", "start_at", "end_at", "duration_minutes", "energy_kcal",
    "distance_meters", "source_id", "source_json_present", "source_json"
  ],
  insights: [
    "ordinal", "id", "created_at", "title", "body", "evidence", "confidence", "model", "safety_notice"
  ],
  audit_events: ["ordinal", "id", "created_at", "event_type", "detail"],
  health_events: [
    "ordinal", "id", "kind", "status", "occurred_at", "source", "provider", "notes", "metadata"
  ],
  immunizations: [
    "health_event_id", "vaccine", "target_disease", "dose_number", "series", "manufacturer",
    "lot_number", "expires_at", "route", "site", "reaction"
  ],
  care_items: [
    "ordinal", "id", "kind", "code", "title", "due_start", "reminder_at", "priority", "status",
    "schedule_provenance", "schedule_version", "notes", "completed_health_event_id", "completed_at"
  ],
  medications: [
    "ordinal", "id", "name", "active_ingredient", "dose", "unit", "start_date", "end_date",
    "notes", "created_at", "updated_at"
  ],
  personal_reference_ranges: [
    "measurement_code", "normal_low", "normal_high", "unit", "updated_at", "optimal_low", "optimal_high"
  ],
  pinned_measurements: ["measurement_code", "pinned_at"],
  profile_media: ["media_kind", "content_type", "content", "revision", "updated_at"],
  companion_sync_changes: [
    "sequence", "revision", "entity_type", "entity_id", "operation", "payload", "changed_at"
  ],
  companion_sync_snapshots: [
    "snapshot_id", "pairing_id", "revision", "high_water_sequence", "created_at"
  ],
  companion_sync_snapshot_entries: [
    "snapshot_id", "entry_index", "entity_type", "entity_id", "payload"
  ]
} as const satisfies Record<string, readonly string[]>;

export type PersistedTable = keyof typeof tableColumns;

/** Column list for reading a table back, minus the ordering column callers never surface. */
export function selectColumns(table: PersistedTable, options: { excludeOrdinal?: boolean } = {}): string {
  const columns = tableColumns[table] as readonly string[];
  return (options.excludeOrdinal ? columns.filter((column) => column !== "ordinal") : columns).join(", ");
}

/**
 * The same list qualified with a table alias, for joins where an unqualified name would be
 * ambiguous. Replaces `o.* EXCLUDE (...)`, which only DuckDB understands.
 */
export function qualifiedColumns(
  alias: string,
  table: PersistedTable,
  options: { excludeOrdinal?: boolean } = {}
): string {
  return selectColumns(table, options).split(", ").map((column) => `${alias}.${column}`).join(", ");
}
