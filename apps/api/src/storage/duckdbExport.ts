import { createHash } from "node:crypto";
import type duckdb from "duckdb";
import {
  EXPORT_FORMAT_VERSION,
  healthStoreDataSchema,
  isHealthEventKind,
  type HealthEvent,
  type HealthStoreData
} from "@vitana/shared";
import {
  all,
  allWithParams,
  compact,
  dateOnly,
  isoTimestamp,
  insertActivityRows,
  insertObservationRows,
  insertRows,
  insertTimeSeriesSampleRows,
  json,
  measurementTypeProperties,
  optionalJson,
  optionalJsonValue,
  optionalNumber,
  optionalTimestamp,
  orderedRows,
  profileFromRow,
    profileProperties,
  requiredJson,
  run,
  withStoredJson
} from "./duckdbRows.js";
import { selectColumns, tableColumns } from "./duckdbColumns.js";
import { insertAudit } from "./duckdbCommands.js";
import type {
  ProfileExportCollection,
  ProfileExportMetadata,
  ProfileExportPage
} from "./profileRepository.js";
import { profileExportCollections } from "./profileRepository.js";

/**
 * Recording the export is the only write an export performs. It is kept separate from the snapshot
 * so that reading a full store - which can take a while - does not occupy the mutation queue.
 */
export async function recordExportAudit(connection: duckdb.Connection): Promise<void> {
  await insertAudit(connection, "export-created", "Full local data export created.");
}

export async function snapshot(
  connection: duckdb.Connection,
  options: { includeRaw?: boolean } = { includeRaw: true }
): Promise<HealthStoreData> {
  const profileRows = await all(connection, `SELECT ${selectColumns("profile")} FROM profile;`);
  if (profileRows.length !== 1) {
    throw new Error(`DuckDB expected exactly one profile row, found ${profileRows.length}.`);
  }
  const profile = profileFromRow(profileRows[0]);

  // Raw import payloads are large and only needed by the export path, so they are named
  // explicitly rather than swept up by a wildcard select.
  const importColumns = tableColumns.imports
    .filter((column) => column !== "ordinal" && (options.includeRaw === true || column !== "raw_content"))
    .join(", ");
  const importRows = await all(connection, `SELECT ${importColumns} FROM imports ORDER BY ordinal;`);
  const sourceImports = importRows.map((row) => compact({
    id: row.id,
    sourceKind: row.source_kind,
    fileName: row.file_name,
    importedAt: isoTimestamp(row.imported_at),
    parserVersion: row.parser_version,
    checksum: row.checksum,
    rowCount: Number(row.row_count),
    status: row.status,
    diagnostics: requiredJson(row.diagnostics),
    rawContent: row.raw_content
  }));
  const dataSources = (await orderedRows(connection, "sources")).map((row) => compact({
    id: row.id,
    sourceKind: row.source_kind,
    label: row.label,
    importId: row.import_id,
    createdAt: isoTimestamp(row.created_at)
  }));
  const devices = (await orderedRows(connection, "devices")).map((row) => compact({
    id: row.id,
    label: row.label,
    manufacturer: row.manufacturer,
    model: row.model,
    sourceId: row.source_id
  }));
  const measurementTypes = (await orderedRows(connection, "measurement_types")).map((row) => compact({
    code: row.code,
    display: row.display,
    category: row.category,
    kind: row.kind,
    canonicalUnit: row.canonical_unit,
    aliases: requiredJson(row.aliases),
    ...(optionalJson<Record<string, unknown>>(row.custom_properties) ?? {}),
    aggregation: row.aggregation
  }));
  const personalReferenceRanges = (await all(
    connection,
    "SELECT * FROM personal_reference_ranges ORDER BY measurement_code;"
  )).map((row) => compact({
    measurementCode: row.measurement_code,
    normalLow: optionalNumber(row.normal_low),
    normalHigh: optionalNumber(row.normal_high),
    optimalLow: optionalNumber(row.optimal_low),
    optimalHigh: optionalNumber(row.optimal_high),
    unit: row.unit,
    updatedAt: isoTimestamp(row.updated_at)
  }));
  const pinnedMeasurements = (await all(
    connection,
    "SELECT measurement_code, pinned_at FROM pinned_measurements ORDER BY pinned_at, measurement_code;"
  )).map((row) => ({
    measurementCode: String(row.measurement_code),
    pinnedAt: isoTimestamp(row.pinned_at)
  }));
  const observationGroups = (await orderedRows(connection, "observation_groups")).map((row) => compact({
    id: row.id,
    kind: row.kind,
    label: row.label,
    sourceId: row.source_id,
    importId: row.import_id,
    startAt: optionalTimestamp(row.start_at),
    endAt: optionalTimestamp(row.end_at),
    collectedAt: optionalTimestamp(row.collected_at),
    metadata: optionalJson(row.metadata)
  }));
  const observations = (await orderedRows(connection, "observations")).map((row) => withStoredJson(compact({
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
  }), row.source_json_present, row.source_json));
  const timeSeriesSamples = (await orderedRows(connection, "time_series_samples")).map((row) => withStoredJson(compact({
    id: row.id,
    measurementCode: row.measurement_code,
    startAt: isoTimestamp(row.start_at),
    endAt: isoTimestamp(row.end_at),
    value: Number(row.value),
    unit: row.unit,
    sourceId: row.source_id,
    deviceId: row.device_id
  }), row.source_json_present, row.source_json));
  const measurementAggregates = (await orderedRows(connection, "measurement_aggregates")).map((row) => withStoredJson(compact({
    id: row.id,
    measurementCode: row.measurement_code,
    granularity: row.granularity,
    startAt: isoTimestamp(row.start_at),
    endAt: isoTimestamp(row.end_at),
    average: Number(row.average),
    minimum: Number(row.minimum),
    maximum: Number(row.maximum),
    count: Number(row.measurement_count),
    unit: row.unit,
    sourceId: row.source_id,
    calendarDate: row.calendar_date ? String(row.calendar_date).slice(0, 10) : undefined
  }), row.source_json_present, row.source_json));
  const activitySessions = (await orderedRows(connection, "activities")).map((row) => withStoredJson(compact({
    id: row.id,
    activityType: row.activity_type,
    startAt: isoTimestamp(row.start_at),
    endAt: optionalTimestamp(row.end_at),
    durationMinutes: optionalNumber(row.duration_minutes),
    energyKcal: optionalNumber(row.energy_kcal),
    distanceMeters: optionalNumber(row.distance_meters),
    sourceId: row.source_id
  }), row.source_json_present, row.source_json));
  const eventRows = await orderedRows(connection, "health_events");
  const immunizations = new Map((await all(connection, "SELECT * FROM immunizations;")).map((row) => [String(row.health_event_id), row]));
  const healthEvents = eventRows.map((row) => {
    const base = compact({ id: row.id, kind: row.kind, status: row.status, occurredAt: isoTimestamp(row.occurred_at),
      source: row.source, provider: row.provider, notes: row.notes, metadata: optionalJson(row.metadata) });
    const immunization = immunizations.get(String(row.id));
    if (immunization) return { ...base, kind: "immunization", immunization: compact({ vaccine: immunization.vaccine, targetDisease: immunization.target_disease, doseNumber: optionalNumber(immunization.dose_number), series: immunization.series, manufacturer: immunization.manufacturer, lotNumber: immunization.lot_number, expiresAt: immunization.expires_at ? String(immunization.expires_at).slice(0, 10) : undefined, route: immunization.route, site: immunization.site, reaction: immunization.reaction }) };
    const kind = String(row.kind);
    if (!isHealthEventKind(kind)) throw new Error(`Unsupported health event kind "${kind}".`);
    return { ...base, kind };
  });
  const careItems = (await orderedRows(connection, "care_items")).map((row) => compact({
    id: row.id, kind: row.kind, code: row.code, title: row.title, dueStart: optionalTimestamp(row.due_start),
    reminderAt: optionalTimestamp(row.reminder_at), priority: row.priority, status: row.status, scheduleProvenance: row.schedule_provenance,
    scheduleVersion: row.schedule_version, notes: row.notes,
    completedHealthEventId: row.completed_health_event_id, completedAt: optionalTimestamp(row.completed_at)
  }));
  const medications = (await orderedRows(connection, "medications")).map(mapMedicationExportRow);
  const insights = (await orderedRows(connection, "insights")).map((row) => compact({
    id: row.id,
    createdAt: isoTimestamp(row.created_at),
    title: row.title,
    body: row.body,
    evidence: requiredJson(row.evidence),
    confidence: row.confidence,
    model: row.model,
    safetyNotice: row.safety_notice
  }));
  const auditEvents = (await orderedRows(connection, "audit_events")).map((row) => compact({
    id: row.id,
    createdAt: isoTimestamp(row.created_at),
    eventType: row.event_type,
    detail: row.detail
  }));

  return healthStoreDataSchema.parse({
    schemaVersion: EXPORT_FORMAT_VERSION,
    profile,
    sourceImports,
    dataSources,
    devices,
    measurementTypes,
    personalReferenceRanges,
    pinnedMeasurements,
    observations,
    observationGroups,
    timeSeriesSamples,
    measurementAggregates,
    activitySessions,
    healthEvents,
    careItems,
    medications,
    insights,
    auditEvents
  }) as HealthStoreData;
}

export async function insertStore(connection: duckdb.Connection, store: HealthStoreData): Promise<void> {
  const customProperties = json(profileProperties(store.profile));
  await run(connection, `INSERT INTO profile (${selectColumns("profile")}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    store.profile.id, store.profile.displayName, store.profile.sex ?? null,
    store.profile.heightCm ?? null, store.profile.bloodType ?? null, store.profile.goalSummary ?? null,
    store.profile.units, store.profile.updatedAt, customProperties, store.profile.subjectKind, store.profile.birthDate ?? null,
    store.profile.pet?.species ?? null, store.profile.pet?.breed ?? null, store.profile.pet?.reproductiveStatus ?? null, store.profile.pet?.microchipId ?? null);

  await insertRows(connection, "imports",
    store.sourceImports.map((entry, ordinal) => [ordinal, entry.id, entry.sourceKind, entry.fileName, entry.importedAt,
      entry.parserVersion, entry.checksum, entry.rowCount, entry.status, json(entry.diagnostics), entry.rawContent ?? null]));
  await insertRows(connection, "sources",
    store.dataSources.map((entry, ordinal) => [ordinal, entry.id, entry.sourceKind, entry.label, entry.importId ?? null, entry.createdAt]));
  await insertRows(connection, "devices",
    store.devices.map((entry, ordinal) => [ordinal, entry.id, entry.label, entry.manufacturer ?? null, entry.model ?? null, entry.sourceId ?? null]));
  await insertRows(connection, "measurement_types",
    store.measurementTypes.map((entry, ordinal) => [ordinal, entry.code, entry.display, entry.category, entry.kind,
      entry.canonicalUnit, json(entry.aliases), entry.aggregation, json(measurementTypeProperties(entry))]));
  await insertRows(connection, "personal_reference_ranges",
    store.personalReferenceRanges.map((entry) => [
      entry.measurementCode, entry.normalLow ?? null, entry.normalHigh ?? null, entry.unit, entry.updatedAt,
      entry.optimalLow ?? null, entry.optimalHigh ?? null
    ]));
  await insertRows(connection, "pinned_measurements",
    store.pinnedMeasurements.map((entry) => [entry.measurementCode, entry.pinnedAt]));
  await insertRows(connection, "observation_groups",
    store.observationGroups.map((entry, ordinal) => [ordinal, entry.id, entry.kind, entry.label, entry.sourceId ?? null,
      entry.importId ?? null, entry.startAt ?? null, entry.endAt ?? null, entry.collectedAt ?? null, optionalJsonValue(entry.metadata)]));
  await insertObservationRows(connection, store.observations, 0);
  await insertTimeSeriesSampleRows(connection, store.timeSeriesSamples, 0);
  await insertRows(connection, "measurement_aggregates", store.measurementAggregates.map((entry, ordinal) => [
    ordinal, entry.id, entry.measurementCode, entry.granularity, entry.startAt, entry.endAt,
    entry.average, entry.minimum, entry.maximum, entry.count, entry.unit, entry.sourceId,
    entry.calendarDate ?? null, entry.sourceJson !== undefined, optionalJsonValue(entry.sourceJson)
  ]));
  await insertActivityRows(connection, store.activitySessions, 0);
  await insertHealthEventRows(connection, store.healthEvents ?? []);
  await insertRows(connection, "care_items",
    (store.careItems ?? []).map((entry, ordinal) => [ordinal, entry.id, entry.kind, entry.code ?? null, entry.title, entry.dueStart ?? null, entry.reminderAt ?? null, entry.priority, entry.status, entry.scheduleProvenance ?? null, entry.scheduleVersion ?? null, entry.notes ?? null, entry.completedHealthEventId ?? null, entry.completedAt ?? null]));
  await insertRows(connection, "medications",
    (store.medications ?? []).map((entry, ordinal) => [
      ordinal, entry.id, entry.name, entry.activeIngredient ?? null, entry.dose ?? null, entry.unit ?? null,
      entry.startDate ?? null, entry.endDate ?? null, entry.notes ?? null, entry.createdAt, entry.updatedAt
    ]));
  await insertRows(connection, "insights",
    store.insights.map((entry, ordinal) => [ordinal, entry.id, entry.createdAt, entry.title, entry.body,
      json(entry.evidence), entry.confidence, entry.model, entry.safetyNotice]));
  await insertRows(connection, "audit_events",
    store.auditEvents.map((entry, ordinal) => [ordinal, entry.id, entry.createdAt, entry.eventType, entry.detail]));
}

/**
 * Computes the canonical store digest through bounded export pages. This keeps staged hydration
 * verification from allocating a second whole-profile object just to read it back.
 */
export async function digestBackupExportData(connection: duckdb.Connection): Promise<string> {
  const digest = createHash("sha256");
  const dataKeys = [...profileExportCollections, "profile", "schemaVersion"].sort();
  const metadata = await profileExportMetadata(connection);
  digest.update("{");
  for (let keyIndex = 0; keyIndex < dataKeys.length; keyIndex += 1) {
    const key = dataKeys[keyIndex];
    if (keyIndex > 0) digest.update(",");
    digest.update(`${JSON.stringify(key)}:`);
    if (key === "profile") {
      digest.update(canonicalJson(metadata.profile));
      continue;
    }
    if (key === "schemaVersion") {
      digest.update(JSON.stringify(metadata.schemaVersion));
      continue;
    }

    digest.update("[");
    let offset = 0;
    let itemIndex = 0;
    while (true) {
      const page = await profileExportPage(connection, key as ProfileExportCollection, offset, 250);
      for (const item of page.items) {
        if (itemIndex++ > 0) digest.update(",");
        digest.update(canonicalJson(item));
      }
      offset += page.items.length;
      if (page.done) break;
      if (page.items.length === 0) throw new Error(`Backup export page for ${key} made no progress.`);
    }
    digest.update("]");
  }
  digest.update("}");
  return digest.digest("hex");
}

export function digestHealthStoreData(store: HealthStoreData): string {
  return createHash("sha256").update(canonicalJson(store)).digest("hex");
}

export function firstDifferencePath(expected: unknown, actual: unknown, path = "$" ): string {
  if (Object.is(expected, actual)) {
    return path;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return `${path}.length`;
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifferencePath(expected[index], actual[index], `${path}[${index}]`);
      if (difference !== `${path}[${index}]`) {
        return difference;
      }
      if (!Object.is(expected[index], actual[index]) && canonicalJson(expected[index]) !== canonicalJson(actual[index])) {
        return difference;
      }
    }
    return path;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])].sort();
    for (const key of keys) {
      if (!(key in expectedRecord) || !(key in actualRecord)) {
        return `${path}.${key}`;
      }
      if (canonicalJson(expectedRecord[key]) !== canonicalJson(actualRecord[key])) {
        return firstDifferencePath(expectedRecord[key], actualRecord[key], `${path}.${key}`);
      }
    }
  }
  return path;
}

async function insertHealthEventRows(connection: duckdb.Connection, events: HealthEvent[]): Promise<void> {
  await insertRows(connection, "health_events", events.map((event, ordinal) => [
    ordinal, event.id, event.kind, event.status, event.occurredAt, event.source,
    event.provider ?? null, event.notes ?? null, optionalJsonValue(event.metadata)
  ]));
  await insertRows(connection, "immunizations",
    events.filter((event): event is Extract<HealthEvent, { kind: "immunization" }> & { immunization: NonNullable<Extract<HealthEvent, { kind: "immunization" }>["immunization"]> } => event.kind === "immunization" && !!event.immunization).map((event) => [
      event.id, event.immunization.vaccine, event.immunization.targetDisease ?? null, event.immunization.doseNumber ?? null,
      event.immunization.series ?? null, event.immunization.manufacturer ?? null, event.immunization.lotNumber ?? null,
      event.immunization.expiresAt ?? null, event.immunization.route ?? null, event.immunization.site ?? null, event.immunization.reaction ?? null
    ]));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function profileExportMetadata(connection: duckdb.Connection): Promise<ProfileExportMetadata> {
  const rows = await all(connection, `SELECT ${selectColumns("profile")} FROM profile;`);
  if (rows.length !== 1) {
    throw new Error(`DuckDB expected exactly one profile row, found ${rows.length}.`);
  }
  return { schemaVersion: EXPORT_FORMAT_VERSION, profile: profileFromRow(rows[0]) };
}

export async function profileExportPage(
  connection: duckdb.Connection,
  collection: ProfileExportCollection,
  offset: number,
  limit: number
): Promise<ProfileExportPage> {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Backup export page bounds are invalid.");
  }
  const { sql, map } = exportCollectionQuery(collection);
  const rows = await allWithParams(connection, `${sql} LIMIT ? OFFSET ?;`, limit, offset);
  return { items: rows.map(map), done: rows.length < limit };
}

function exportCollectionQuery(collection: ProfileExportCollection): {
  sql: string;
  map: (row: Record<string, unknown>) => unknown;
} {
  switch (collection) {
    case "sourceImports": {
      const columns = tableColumns.imports.filter((column) => column !== "ordinal").join(", ");
      return { sql: `SELECT ${columns} FROM imports ORDER BY ordinal`, map: (row) => compact({
        id: row.id, sourceKind: row.source_kind, fileName: row.file_name,
        importedAt: isoTimestamp(row.imported_at), parserVersion: row.parser_version,
        checksum: row.checksum, rowCount: Number(row.row_count), status: row.status,
        diagnostics: requiredJson(row.diagnostics), rawContent: row.raw_content
      }) };
    }
    case "dataSources":
      return orderedExportQuery("sources", (row) => compact({ id: row.id, sourceKind: row.source_kind,
        label: row.label, importId: row.import_id, createdAt: isoTimestamp(row.created_at) }));
    case "devices":
      return orderedExportQuery("devices", (row) => compact({ id: row.id, label: row.label,
        manufacturer: row.manufacturer, model: row.model, sourceId: row.source_id }));
    case "measurementTypes":
      return orderedExportQuery("measurement_types", (row) => compact({ code: row.code, display: row.display,
        category: row.category, kind: row.kind, canonicalUnit: row.canonical_unit,
        aliases: requiredJson(row.aliases), ...(optionalJson<Record<string, unknown>>(row.custom_properties) ?? {}),
        aggregation: row.aggregation }));
    case "personalReferenceRanges":
      return { sql: "SELECT measurement_code, normal_low, normal_high, optimal_low, optimal_high, unit, updated_at FROM personal_reference_ranges ORDER BY measurement_code", map: (row) => compact({
        measurementCode: row.measurement_code, normalLow: optionalNumber(row.normal_low), normalHigh: optionalNumber(row.normal_high),
        optimalLow: optionalNumber(row.optimal_low), optimalHigh: optionalNumber(row.optimal_high), unit: row.unit,
        updatedAt: isoTimestamp(row.updated_at)
      }) };
    case "pinnedMeasurements":
      return { sql: "SELECT measurement_code, pinned_at FROM pinned_measurements ORDER BY pinned_at, measurement_code", map: (row) => ({
        measurementCode: String(row.measurement_code), pinnedAt: isoTimestamp(row.pinned_at)
      }) };
    case "observationGroups":
      return orderedExportQuery("observation_groups", (row) => compact({ id: row.id, kind: row.kind, label: row.label,
        sourceId: row.source_id, importId: row.import_id, startAt: optionalTimestamp(row.start_at),
        endAt: optionalTimestamp(row.end_at), collectedAt: optionalTimestamp(row.collected_at), metadata: optionalJson(row.metadata) }));
    case "observations":
      return orderedExportQuery("observations", (row) => withStoredJson(compact({ id: row.id, measurementCode: row.measurement_code,
        observedAt: isoTimestamp(row.observed_at), effectiveStart: optionalTimestamp(row.effective_start),
        effectiveEnd: optionalTimestamp(row.effective_end), value: Number(row.value), unit: row.unit,
        sourceId: row.source_id, observationGroupId: row.observation_group_id, deviceId: row.device_id, note: row.note
      }), row.source_json_present, row.source_json));
    case "timeSeriesSamples":
      return orderedExportQuery("time_series_samples", (row) => withStoredJson(compact({ id: row.id,
        measurementCode: row.measurement_code, startAt: isoTimestamp(row.start_at), endAt: isoTimestamp(row.end_at),
        value: Number(row.value), unit: row.unit, sourceId: row.source_id, deviceId: row.device_id
      }), row.source_json_present, row.source_json));
    case "measurementAggregates":
      return orderedExportQuery("measurement_aggregates", (row) => withStoredJson(compact({ id: row.id,
        measurementCode: row.measurement_code, granularity: row.granularity, startAt: isoTimestamp(row.start_at),
        endAt: isoTimestamp(row.end_at), average: Number(row.average), minimum: Number(row.minimum),
        maximum: Number(row.maximum), count: Number(row.measurement_count), unit: row.unit, sourceId: row.source_id,
        calendarDate: row.calendar_date ? String(row.calendar_date).slice(0, 10) : undefined
      }), row.source_json_present, row.source_json));
    case "activitySessions":
      return orderedExportQuery("activities", (row) => withStoredJson(compact({ id: row.id, activityType: row.activity_type,
        startAt: isoTimestamp(row.start_at), endAt: optionalTimestamp(row.end_at), durationMinutes: optionalNumber(row.duration_minutes),
        energyKcal: optionalNumber(row.energy_kcal), distanceMeters: optionalNumber(row.distance_meters), sourceId: row.source_id
      }), row.source_json_present, row.source_json));
    case "healthEvents":
      return { sql: `SELECT h.${selectColumns("health_events", { excludeOrdinal: true }).split(", ").join(", h.")},
          i.vaccine, i.target_disease, i.dose_number, i.series, i.manufacturer AS immunization_manufacturer,
          i.lot_number, i.expires_at, i.route AS immunization_route, i.site, i.reaction
        FROM health_events h
        LEFT JOIN immunizations i ON i.health_event_id = h.id
        ORDER BY h.ordinal`, map: mapHealthEventExportRow };
    case "careItems":
      return orderedExportQuery("care_items", (row) => compact({ id: row.id, kind: row.kind, code: row.code, title: row.title,
        dueStart: optionalTimestamp(row.due_start), reminderAt: optionalTimestamp(row.reminder_at), priority: row.priority,
        status: row.status, scheduleProvenance: row.schedule_provenance, scheduleVersion: row.schedule_version,
        notes: row.notes, completedHealthEventId: row.completed_health_event_id, completedAt: optionalTimestamp(row.completed_at) }));
    case "medications":
      return orderedExportQuery("medications", mapMedicationExportRow);
    case "insights":
      return orderedExportQuery("insights", (row) => compact({ id: row.id, createdAt: isoTimestamp(row.created_at),
        title: row.title, body: row.body, evidence: requiredJson(row.evidence), confidence: row.confidence,
        model: row.model, safetyNotice: row.safety_notice }));
    case "auditEvents":
      return orderedExportQuery("audit_events", (row) => compact({ id: row.id, createdAt: isoTimestamp(row.created_at),
        eventType: row.event_type, detail: row.detail }));
  }
}

function orderedExportQuery(
  table: Parameters<typeof selectColumns>[0],
  map: (row: Record<string, unknown>) => unknown
) {
  return { sql: `SELECT ${selectColumns(table, { excludeOrdinal: true })} FROM ${table} ORDER BY ordinal`, map };
}

function mapHealthEventExportRow(row: Record<string, unknown>): unknown {
  const base = compact({ id: row.id, kind: row.kind, status: row.status, occurredAt: isoTimestamp(row.occurred_at),
    source: row.source, provider: row.provider, notes: row.notes, metadata: optionalJson(row.metadata) });
  if (row.vaccine) return { ...base, kind: "immunization", immunization: compact({ vaccine: row.vaccine,
    targetDisease: row.target_disease, doseNumber: optionalNumber(row.dose_number), series: row.series,
    manufacturer: row.immunization_manufacturer, lotNumber: row.lot_number,
    expiresAt: row.expires_at ? dateOnly(row.expires_at) : undefined,
    route: row.immunization_route, site: row.site, reaction: row.reaction }) };
  const kind = String(row.kind);
  if (!isHealthEventKind(kind)) throw new Error(`Unsupported health event kind "${kind}".`);
  return { ...base, kind };
}

function mapMedicationExportRow(row: Record<string, unknown>): unknown {
  return compact({
    id: row.id,
    name: row.name,
    activeIngredient: row.active_ingredient,
    dose: optionalNumber(row.dose),
    unit: row.unit,
    startDate: row.start_date ? dateOnly(row.start_date) : undefined,
    endDate: row.end_date ? dateOnly(row.end_date) : undefined,
    notes: row.notes,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at)
  });
}