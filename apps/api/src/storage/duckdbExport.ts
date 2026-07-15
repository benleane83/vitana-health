import { createHash } from "node:crypto";
import type duckdb from "duckdb";
import {
  CURRENT_SCHEMA_VERSION,
  healthStoreDataSchema,
  type HealthEvent,
  type HealthStoreData
} from "@local-fitness-advisor/shared";
import {
  all,
  compact,
  isoTimestamp,
  insertObservationRows,
  insertRows,
  json,
  measurementTypeProperties,
  optionalJson,
  optionalJsonValue,
  optionalNumber,
  optionalTimestamp,
  orderedRows,
  profileFromRow,
  requiredJson,
  run,
  withStoredJson
} from "./duckdbRows.js";
import { insertAudit } from "./duckdbCommands.js";

export async function exportData(connection: duckdb.Connection): Promise<HealthStoreData> {
  await insertAudit(connection, "export-created", "Full local data export created.");
  return snapshot(connection);
}

export async function snapshot(
  connection: duckdb.Connection,
  options: { includeRaw?: boolean } = { includeRaw: true }
): Promise<HealthStoreData> {
  const profileRows = await all(connection, "SELECT * FROM profile;");
  if (profileRows.length !== 1) {
    throw new Error(`DuckDB expected exactly one profile row, found ${profileRows.length}.`);
  }
  const profile = profileFromRow(profileRows[0]);

  const importRows = options.includeRaw === true
    ? await orderedRows(connection, "imports")
    : await all(connection, "SELECT * EXCLUDE (ordinal, raw_content) FROM imports ORDER BY ordinal;");
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
  const medications = new Map((await all(connection, "SELECT * FROM medication_administrations;")).map((row) => [String(row.health_event_id), row]));
  const healthEvents = eventRows.map((row) => {
    const base = compact({ id: row.id, kind: row.kind, status: row.status, occurredAt: isoTimestamp(row.occurred_at),
      occurredEnd: optionalTimestamp(row.occurred_end), source: row.source, provider: row.provider, notes: row.notes, metadata: optionalJson(row.metadata) });
    const immunization = immunizations.get(String(row.id));
    const medication = medications.get(String(row.id));
    if (immunization) return { ...base, kind: "immunization", immunization: compact({ vaccine: immunization.vaccine, targetDisease: immunization.target_disease, doseNumber: optionalNumber(immunization.dose_number), series: immunization.series, manufacturer: immunization.manufacturer, lotNumber: immunization.lot_number, expiresAt: immunization.expires_at ? String(immunization.expires_at).slice(0, 10) : undefined, route: immunization.route, site: immunization.site, reaction: immunization.reaction }) };
    if (medication) return { ...base, kind: "medication-administration", medicationAdministration: compact({ medication: medication.medication, activeIngredient: medication.active_ingredient, dose: Number(medication.dose), unit: medication.unit, route: medication.route }) };
    return { ...base, kind: "other" };
  });
  const careItems = (await orderedRows(connection, "care_items")).map((row) => compact({
    id: row.id, kind: row.kind, code: row.code, title: row.title, dueStart: optionalTimestamp(row.due_start), dueEnd: optionalTimestamp(row.due_end),
    reminderAt: optionalTimestamp(row.reminder_at), priority: row.priority, status: row.status, scheduleProvenance: row.schedule_provenance,
    scheduleVersion: row.schedule_version, notes: row.notes, originatingHealthEventId: row.originating_health_event_id,
    completedHealthEventId: row.completed_health_event_id, completedAt: optionalTimestamp(row.completed_at)
  }));
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
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile,
    sourceImports,
    dataSources,
    devices,
    measurementTypes,
    observations,
    observationGroups,
    timeSeriesSamples,
    activitySessions,
    healthEvents,
    careItems,
    insights,
    auditEvents
  }) as HealthStoreData;
}

export async function insertStore(connection: duckdb.Connection, store: HealthStoreData): Promise<void> {
  const profileProperties = store.profile.cloudAiConsent
    ? json({ cloudAiConsent: store.profile.cloudAiConsent })
    : null;
  await run(connection, `INSERT INTO profile (
    id, display_name, sex, height_cm, blood_type, goal_summary, units, updated_at, custom_properties,
    subject_kind, birth_date, pet_species, pet_breed, pet_reproductive_status, pet_microchip_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    store.profile.id, store.profile.displayName, store.profile.sex ?? null,
    store.profile.heightCm ?? null, store.profile.bloodType ?? null, store.profile.goalSummary ?? null,
    store.profile.units, store.profile.updatedAt, profileProperties, store.profile.subjectKind, store.profile.birthDate ?? null,
    store.profile.pet?.species ?? null, store.profile.pet?.breed ?? null, store.profile.pet?.reproductiveStatus ?? null, store.profile.pet?.microchipId ?? null);

  await insertRows(connection, "INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    store.sourceImports.map((entry, ordinal) => [ordinal, entry.id, entry.sourceKind, entry.fileName, entry.importedAt,
      entry.parserVersion, entry.checksum, entry.rowCount, entry.status, json(entry.diagnostics), entry.rawContent ?? null]));
  await insertRows(connection, "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?);",
    store.dataSources.map((entry, ordinal) => [ordinal, entry.id, entry.sourceKind, entry.label, entry.importId ?? null, entry.createdAt]));
  await insertRows(connection, "INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?);",
    store.devices.map((entry, ordinal) => [ordinal, entry.id, entry.label, entry.manufacturer ?? null, entry.model ?? null, entry.sourceId ?? null]));
  await insertRows(connection, "INSERT INTO measurement_types VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
    store.measurementTypes.map((entry, ordinal) => [ordinal, entry.code, entry.display, entry.category, entry.kind,
      entry.canonicalUnit, json(entry.aliases), entry.aggregation, json(measurementTypeProperties(entry))]));
  await insertRows(connection, "INSERT INTO observation_groups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    store.observationGroups.map((entry, ordinal) => [ordinal, entry.id, entry.kind, entry.label, entry.sourceId ?? null,
      entry.importId ?? null, entry.startAt ?? null, entry.endAt ?? null, entry.collectedAt ?? null, optionalJsonValue(entry.metadata)]));
  await insertObservationRows(connection, store.observations, 0);
  await insertRows(connection, "INSERT INTO time_series_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    store.timeSeriesSamples.map((entry, ordinal) => [ordinal, entry.id, entry.measurementCode, entry.startAt, entry.endAt,
      entry.value, entry.unit, entry.sourceId, entry.deviceId ?? null, entry.sourceJson !== undefined, optionalJsonValue(entry.sourceJson)]));
  await insertRows(connection, "INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    store.activitySessions.map((entry, ordinal) => [ordinal, entry.id, entry.activityType, entry.startAt, entry.endAt ?? null,
      entry.durationMinutes ?? null, entry.energyKcal ?? null, entry.distanceMeters ?? null, entry.sourceId,
      entry.sourceJson !== undefined, optionalJsonValue(entry.sourceJson)]));
  await insertHealthEventRows(connection, store.healthEvents ?? []);
  await insertRows(connection, "INSERT INTO care_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    (store.careItems ?? []).map((entry, ordinal) => [ordinal, entry.id, entry.kind, entry.code ?? null, entry.title, entry.dueStart ?? null, entry.dueEnd ?? null, entry.reminderAt ?? null, entry.priority, entry.status, entry.scheduleProvenance ?? null, entry.scheduleVersion ?? null, entry.notes ?? null, entry.originatingHealthEventId ?? null, entry.completedHealthEventId ?? null, entry.completedAt ?? null]));
  await insertRows(connection, "INSERT INTO insights VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
    store.insights.map((entry, ordinal) => [ordinal, entry.id, entry.createdAt, entry.title, entry.body,
      json(entry.evidence), entry.confidence, entry.model, entry.safetyNotice]));
  await insertRows(connection, "INSERT INTO audit_events VALUES (?, ?, ?, ?, ?);",
    store.auditEvents.map((entry, ordinal) => [ordinal, entry.id, entry.createdAt, entry.eventType, entry.detail]));
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
  await insertRows(connection, "INSERT INTO health_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);", events.map((event, ordinal) => [
    ordinal, event.id, event.kind, event.status, event.occurredAt, event.occurredEnd ?? null, event.source,
    event.provider ?? null, event.notes ?? null, optionalJsonValue(event.metadata)
  ]));
  await insertRows(connection, "INSERT INTO immunizations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    events.filter((event): event is Extract<HealthEvent, { kind: "immunization" }> => event.kind === "immunization").map((event) => [
      event.id, event.immunization.vaccine, event.immunization.targetDisease ?? null, event.immunization.doseNumber ?? null,
      event.immunization.series ?? null, event.immunization.manufacturer ?? null, event.immunization.lotNumber ?? null,
      event.immunization.expiresAt ?? null, event.immunization.route ?? null, event.immunization.site ?? null, event.immunization.reaction ?? null
    ]));
  await insertRows(connection, "INSERT INTO medication_administrations VALUES (?, ?, ?, ?, ?, ?);",
    events.filter((event): event is Extract<HealthEvent, { kind: "medication-administration" }> => event.kind === "medication-administration").map((event) => [
      event.id, event.medicationAdministration.medication, event.medicationAdministration.activeIngredient ?? null,
      event.medicationAdministration.dose, event.medicationAdministration.unit, event.medicationAdministration.route ?? null
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