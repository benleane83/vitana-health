import type duckdb from "duckdb";
import { createHash } from "node:crypto";
import {
  careItemSchema,
  completeCareItemInputSchema,
  createCareItemInputSchema,
  createHealthEventInputSchema,
  convertMeasurementValue,
  isHealthEventKind,
  insightSchema,
  profileSchema,
  updateCareItemInputSchema,
  updateHealthEventInputSchema,
  type AppBootstrap,
  type CareItem,
  type CareItemMutationResponse,
  type CompleteCareItemInput,
  type CompleteCareItemResponse,
  type CreateCareItemInput,
  type CreateHealthEventInput,
  type DeleteCareItemResponse,
  type DeleteHealthEventResponse,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type HealthEvent,
  type HealthEventMutationResponse,
  type HealthStoreData,
  type LinkedCareItemConflict,
  type Observation,
  type PinnedMeasurement,
  type PersonalReferenceRange,
  type PersonalReferenceRangeInput,
  type Profile,
  type UpdateCareItemInput,
  type UpdateHealthEventInput,
  type UpdateObservationInput,
  type UpdateObservationResponse
} from "@vitana/shared";
import { storageCounts } from "./duckdbProjections.js";
import {
  all,
  allWithParams,
  json,
  measurementTypeFromRow,
  observationFromRow,
  isoTimestamp,
  optionalJson,
  optionalJsonValue,
  optionalTimestamp,
  profileFromRow,
  run
} from "./duckdbRows.js";
import { CareItemCompletionConflictError, HealthEventDeleteConflictError, RepositoryValidationError } from "./profileRepository.js";
import type { StoredProfilePhoto } from "./profileRepository.js";

export async function getProfile(connection: duckdb.Connection): Promise<Profile> {
  const profileRows = await all(connection, "SELECT * FROM profile;");
  if (profileRows.length !== 1) {
    throw new Error(`DuckDB expected exactly one profile row, found ${profileRows.length}.`);
  }
  return profileFromRow(profileRows[0]);
}

export async function replaceProfile(
  connection: duckdb.Connection,
  profile: HealthStoreData["profile"]
): Promise<HealthStoreData["profile"]> {
  const current = await getProfile(connection);
  const nextProfile = profileSchema.parse({
    ...profile,
    id: current.id,
    updatedAt: new Date().toISOString()
  });
  const profileProperties = nextProfile.cloudAiConsent ? json({ cloudAiConsent: nextProfile.cloudAiConsent }) : null;
  await run(
    connection,
    `UPDATE profile SET display_name = ?, sex = ?, height_cm = ?, blood_type = ?,
      goal_summary = ?, units = ?, updated_at = ?, custom_properties = ?, subject_kind = ?, birth_date = ?,
      pet_species = ?, pet_breed = ?, pet_reproductive_status = ?, pet_microchip_id = ? WHERE id = ?;`,
    nextProfile.displayName,
    nextProfile.sex ?? null,
    nextProfile.heightCm ?? null,
    nextProfile.bloodType ?? null,
    nextProfile.goalSummary ?? null,
    nextProfile.units,
    nextProfile.updatedAt,
    profileProperties,
    nextProfile.subjectKind,
    nextProfile.birthDate ?? null,
    nextProfile.pet?.species ?? null,
    nextProfile.pet?.breed ?? null,
    nextProfile.pet?.reproductiveStatus ?? null,
    nextProfile.pet?.microchipId ?? null,
    current.id
  );
  await insertAudit(connection, "profile-updated", "Profile details updated locally.");
  return nextProfile;
}

export async function getProfilePhoto(connection: duckdb.Connection): Promise<StoredProfilePhoto | undefined> {
  const rows = await allWithParams(
    connection,
    "SELECT content_type, content, revision, updated_at FROM profile_media WHERE media_kind = ?;",
    "profile-photo"
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    contentType: "image/jpeg",
    bytes: Buffer.from(row.content as Buffer),
    revision: String(row.revision),
    updatedAt: isoTimestamp(row.updated_at)
  };
}

export async function replaceProfilePhoto(
  connection: duckdb.Connection,
  contentType: "image/jpeg",
  bytes: Buffer
): Promise<StoredProfilePhoto> {
  const revision = createHash("sha256").update(bytes).digest("hex");
  const updatedAt = new Date().toISOString();
  await run(
    connection,
    `INSERT INTO profile_media VALUES ('profile-photo', ?, from_base64(?), ?, ?)
      ON CONFLICT (media_kind) DO UPDATE SET
        content_type = EXCLUDED.content_type, content = EXCLUDED.content,
        revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at;`,
    contentType,
    bytes.toString("base64"),
    revision,
    updatedAt
  );
  await insertAudit(connection, "profile-photo-replaced", "Profile photo replaced locally.");
  return { contentType, bytes, revision, updatedAt };
}

export async function deleteProfilePhoto(connection: duckdb.Connection): Promise<boolean> {
  const existing = await getProfilePhoto(connection);
  if (!existing) return false;
  await run(connection, "DELETE FROM profile_media WHERE media_kind = 'profile-photo';");
  await insertAudit(connection, "profile-photo-deleted", "Profile photo removed locally.");
  return true;
}

export async function addInsight(
  connection: duckdb.Connection,
  insight: HealthStoreData["insights"][number]
): Promise<HealthStoreData["insights"][number]> {
  const validatedInsight = insightSchema.parse(insight);
  const ordinal = await prependOrdinal(connection, "insights");
  await run(
    connection,
    "INSERT INTO insights VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
    ordinal, validatedInsight.id, validatedInsight.createdAt, validatedInsight.title, validatedInsight.body,
    json(validatedInsight.evidence), validatedInsight.confidence, validatedInsight.model, validatedInsight.safetyNotice
  );
  await insertAudit(connection, "insight-generated", `${validatedInsight.model} insight generated.`);
  return validatedInsight;
}

export async function upsertPersonalReferenceRange(
  connection: duckdb.Connection,
  measurementCode: string,
  input: PersonalReferenceRangeInput
): Promise<PersonalReferenceRange> {
  if (input.low === undefined && input.high === undefined) {
    throw new RepositoryValidationError("Enter a lower bound, an upper bound, or both.");
  }
  if ((input.low !== undefined && !Number.isFinite(input.low)) || (input.high !== undefined && !Number.isFinite(input.high))) {
    throw new RepositoryValidationError("Reference-range bounds must be finite numbers.");
  }
  if (input.low !== undefined && input.high !== undefined && input.low > input.high) {
    throw new RepositoryValidationError("Upper bound must be greater than or equal to lower bound.");
  }
  if (!input.unit.trim()) {
    throw new RepositoryValidationError("Reference-range unit is required.");
  }
  const typeRows = await allWithParams(
    connection,
    "SELECT * EXCLUDE (ordinal) FROM measurement_types WHERE code = ?;",
    measurementCode
  );
  if (!typeRows[0]) {
    throw new RepositoryValidationError(`Unknown measurement type "${measurementCode}".`);
  }
  const type = measurementTypeFromRow(typeRows[0]);
  const low = input.low === undefined
    ? undefined
    : convertMeasurementValue(input.low, type, input.unit, type.canonicalUnit);
  const high = input.high === undefined
    ? undefined
    : convertMeasurementValue(input.high, type, input.unit, type.canonicalUnit);
  if ((input.low !== undefined && low === undefined) || (input.high !== undefined && high === undefined)) {
    throw new RepositoryValidationError(`Unit "${input.unit}" is not supported for ${type.display}.`);
  }
  const range = {
    measurementCode,
    ...(low === undefined ? {} : { normalLow: low }),
    ...(high === undefined ? {} : { normalHigh: high }),
    unit: type.canonicalUnit,
    updatedAt: new Date().toISOString()
  };
  await run(connection, `
    INSERT INTO personal_reference_ranges
      (measurement_code, normal_low, normal_high, optimal_low, optimal_high, unit, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT (measurement_code) DO UPDATE SET
      normal_low = EXCLUDED.normal_low, normal_high = EXCLUDED.normal_high,
      unit = EXCLUDED.unit, updated_at = EXCLUDED.updated_at;
  `, range.measurementCode, range.normalLow ?? null, range.normalHigh ?? null, range.unit, range.updatedAt);
  await insertAudit(connection, "personal-reference-range-set", `Personal reference range set for ${measurementCode}.`);
  return range;
}

export async function deletePersonalReferenceRange(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<void> {
  await run(connection, "DELETE FROM personal_reference_ranges WHERE measurement_code = ?;", measurementCode);
  await insertAudit(connection, "personal-reference-range-removed", `Personal reference range removed for ${measurementCode}.`);
}

export interface PinMeasurementCommandResult {
  pin?: PinnedMeasurement;
  changed: boolean;
}

export async function pinMeasurement(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<PinMeasurementCommandResult> {
  const typeRows = await allWithParams(connection, "SELECT 1 AS found FROM measurement_types WHERE code = ? LIMIT 1;", measurementCode);
  if (!typeRows[0]) {
    throw new RepositoryValidationError(`Unknown measurement type "${measurementCode}".`);
  }
  const existingRows = await allWithParams(
    connection,
    "SELECT measurement_code, pinned_at FROM pinned_measurements WHERE measurement_code = ?;",
    measurementCode
  );
  if (existingRows[0]) {
    return {
      pin: { measurementCode, pinnedAt: isoTimestamp(existingRows[0].pinned_at) },
      changed: false
    };
  }
  const pin = { measurementCode, pinnedAt: new Date().toISOString() };
  await run(connection, "INSERT INTO pinned_measurements VALUES (?, ?);", pin.measurementCode, pin.pinnedAt);
  await insertAudit(connection, "measurement-pinned", `${measurementCode} pinned to the dashboard.`);
  return { pin, changed: true };
}

export async function unpinMeasurement(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<PinMeasurementCommandResult> {
  const existingRows = await allWithParams(
    connection,
    "SELECT 1 AS found FROM pinned_measurements WHERE measurement_code = ? LIMIT 1;",
    measurementCode
  );
  if (!existingRows[0]) return { changed: false };
  await run(connection, "DELETE FROM pinned_measurements WHERE measurement_code = ?;", measurementCode);
  await insertAudit(connection, "measurement-unpinned", `${measurementCode} unpinned from the dashboard.`);
  return { changed: true };
}

export async function insertObservationRecord(
  connection: duckdb.Connection,
  observation: Observation
): Promise<boolean> {
  const existing = await allWithParams(connection, "SELECT 1 AS found FROM observations WHERE id = ? LIMIT 1;", observation.id);
  if (existing.length > 0) {
    return false;
  }
  const ordinal = await nextOrdinal(connection, "observations");
  await run(
    connection,
    "INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    ordinal, observation.id, observation.measurementCode, observation.observedAt,
    observation.effectiveStart ?? null, observation.effectiveEnd ?? null, observation.value, observation.unit,
    observation.sourceId, observation.observationGroupId ?? null, observation.deviceId ?? null,
    observation.note ?? null, observation.sourceJson !== undefined, optionalJsonValue(observation.sourceJson)
  );
  return true;
}

export async function deleteObservationRecord(connection: duckdb.Connection, id: string): Promise<boolean> {
  const existing = await allWithParams(connection, "SELECT 1 AS found FROM observations WHERE id = ? LIMIT 1;", id);
  if (existing.length === 0) {
    return false;
  }
  await run(connection, "DELETE FROM observations WHERE id = ?;", id);
  return true;
}

export async function deleteObservationRecordsByMeasurementCode(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<number> {
  const rows = await allWithParams(
    connection,
    "SELECT COUNT(*) AS count FROM observations WHERE measurement_code = ?;",
    measurementCode
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count > 0) {
    await run(connection, "DELETE FROM observations WHERE measurement_code = ?;", measurementCode);
  }
  return count;
}

export async function deleteObservation(
  connection: duckdb.Connection,
  id: string
): Promise<DeleteObservationResponse | undefined> {
  const rows = await allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM observations WHERE id = ?;", id);
  if (!rows[0]) {
    return undefined;
  }
  const observation = observationFromRow(rows[0]);
  await run(connection, "DELETE FROM observations WHERE id = ?;", id);
  await insertAudit(connection, "observation-deleted", observationDeleteDetail(observation));
  return {
    deletedCount: 1,
    deletedObservation: observation,
    counts: await storageCounts(connection)
  };
}

export async function updateObservation(
  connection: duckdb.Connection,
  id: string,
  input: UpdateObservationInput
): Promise<UpdateObservationResponse | undefined> {
  const rows = await allWithParams(connection, "SELECT 1 AS found FROM observations WHERE id = ? LIMIT 1;", id);
  if (!rows[0]) {
    return undefined;
  }
  await run(
    connection,
    `UPDATE observations SET measurement_code = ?, observed_at = ?, value = ?, unit = ?, note = ? WHERE id = ?;`,
    input.measurementCode,
    input.observedAt,
    input.value,
    input.unit,
    input.note ?? null,
    id
  );
  const updatedRows = await allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM observations WHERE id = ?;", id);
  const updatedObservation = observationFromRow(updatedRows[0]);
  await insertAudit(connection, "observation-updated", `${updatedObservation.measurementCode} observation updated for ${updatedObservation.observedAt}.`);
  return { updatedObservation, counts: await storageCounts(connection) };
}

export async function deleteObservationsByMeasurementCode(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<DeleteObservationsByTypeResponse> {
  const countRows = await allWithParams(
    connection,
    "SELECT COUNT(*) AS count FROM observations WHERE measurement_code = ?;",
    measurementCode
  );
  const deletedCount = Number(countRows[0]?.count ?? 0);
  if (deletedCount > 0) {
    await run(connection, "DELETE FROM observations WHERE measurement_code = ?;", measurementCode);
    await insertAudit(
      connection,
      "observation-type-deleted",
      `${deletedCount} observation(s) deleted for ${measurementCode}.`
    );
  }
  return {
    deletedCount,
    measurementCode,
    counts: await storageCounts(connection)
  };
}

export async function deleteDailyAggregateStepSamples(
  connection: duckdb.Connection
): Promise<DeleteObservationsByTypeResponse> {
  const countRows = await all(connection, `
    SELECT COUNT(*) AS count
    FROM time_series_samples
    WHERE measurement_code = 'steps'
      AND DATE_DIFF('second', start_at, end_at) >= 23 * 60 * 60;
  `);
  const deletedCount = Number(countRows[0]?.count ?? 0);
  if (deletedCount > 0) {
    await run(connection, `
      DELETE FROM time_series_samples
      WHERE measurement_code = 'steps'
        AND DATE_DIFF('second', start_at, end_at) >= 23 * 60 * 60;
    `);
    await insertAudit(
      connection,
      "daily-step-aggregates-deleted",
      `${deletedCount} daily aggregate Steps sample(s) deleted.`
    );
  }
  return {
    deletedCount,
    measurementCode: "steps",
    counts: await storageCounts(connection)
  };
}

export async function createHealthEvent(
  connection: duckdb.Connection,
  input: CreateHealthEventInput
): Promise<HealthEventMutationResponse> {
  const validated = createHealthEventInputSchema.parse(input);
  const event = healthEventRecord({
    ...validated,
    id: `event_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
    source: "manual-entry"
  });
  await run(
    connection,
    "INSERT INTO health_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
    await prependOrdinal(connection, "health_events"),
    event.id,
    event.kind,
    event.status,
    event.occurredAt,
    event.source,
    event.provider ?? null,
    event.notes ?? null,
    optionalJsonValue(event.metadata)
  );
  await insertAudit(connection, "health-event-created", `${event.kind} event created for ${event.occurredAt}.`);
  return { healthEvent: event, counts: await storageCounts(connection) };
}

export async function updateHealthEvent(
  connection: duckdb.Connection,
  id: string,
  input: UpdateHealthEventInput
): Promise<HealthEventMutationResponse | undefined> {
  const rows = await allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM health_events WHERE id = ?;", id);
  if (!rows[0]) {
    return undefined;
  }
  const validated = updateHealthEventInputSchema.parse(input);
  const current = healthEventFromRow(rows[0]);
  const event = healthEventRecord({
    ...validated,
    id,
    source: current.source
  });
  await run(
    connection,
    `UPDATE health_events
      SET kind = ?, status = ?, occurred_at = ?, provider = ?, notes = ?, metadata = ?
      WHERE id = ?;`,
    event.kind,
    event.status,
    event.occurredAt,
    event.provider ?? null,
    event.notes ?? null,
    optionalJsonValue(event.metadata),
    id
  );
  if (event.kind !== "immunization") {
    await run(connection, "DELETE FROM immunizations WHERE health_event_id = ?;", id);
  }
  if (event.kind !== "medication-administration") {
    await run(connection, "DELETE FROM medication_administrations WHERE health_event_id = ?;", id);
  }
  await insertAudit(connection, "health-event-updated", `${event.kind} event updated for ${event.occurredAt}.`);
  return { healthEvent: event, counts: await storageCounts(connection) };
}

export async function deleteHealthEvent(
  connection: duckdb.Connection,
  id: string
): Promise<DeleteHealthEventResponse | undefined> {
  const rows = await allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM health_events WHERE id = ?;", id);
  if (!rows[0]) {
    return undefined;
  }
  const conflicts = await linkedCareItemConflicts(connection, id);
  if (conflicts.length > 0) {
    throw new HealthEventDeleteConflictError(conflicts);
  }
  const healthEvent = healthEventFromRow(rows[0]);
  await run(connection, "DELETE FROM immunizations WHERE health_event_id = ?;", id);
  await run(connection, "DELETE FROM medication_administrations WHERE health_event_id = ?;", id);
  await run(connection, "DELETE FROM health_events WHERE id = ?;", id);
  await insertAudit(connection, "health-event-deleted", `${healthEvent.kind} event deleted for ${healthEvent.occurredAt}.`);
  return {
    deletedCount: 1,
    deletedHealthEvent: healthEvent,
    counts: await storageCounts(connection)
  };
}

export async function createCareItem(
  connection: duckdb.Connection,
  input: CreateCareItemInput
): Promise<CareItemMutationResponse> {
  const careItem = await validateAndPrepareCareItem(connection, {
    ...createCareItemInputSchema.parse(input),
    id: `care_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`
  });
  await run(
    connection,
    "INSERT INTO care_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    await prependOrdinal(connection, "care_items"),
    careItem.id,
    careItem.kind,
    careItem.code ?? null,
    careItem.title,
    careItem.dueStart ?? null,
    careItem.reminderAt ?? null,
    careItem.priority,
    careItem.status,
    careItem.scheduleProvenance ?? null,
    careItem.scheduleVersion ?? null,
    careItem.notes ?? null,
    careItem.completedHealthEventId ?? null,
    careItem.completedAt ?? null
  );
  await insertAudit(connection, "care-item-created", `${careItem.title} care item created.`);
  return { careItem, counts: await storageCounts(connection) };
}

export async function updateCareItem(
  connection: duckdb.Connection,
  id: string,
  input: UpdateCareItemInput
): Promise<CareItemMutationResponse | undefined> {
  const rows = await allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM care_items WHERE id = ?;", id);
  if (!rows[0]) {
    return undefined;
  }
  const current = careItemFromRow(rows[0]);
  const validated = updateCareItemInputSchema.parse(input);
  if (current.status !== "completed" && validated.status === "completed") {
    throw new RepositoryValidationError("Complete care items using the completion endpoint.");
  }
  const careItem = await validateAndPrepareCareItem(connection, {
    ...validated,
    id,
    ...(current.status === "completed" ? {
      status: current.status,
      completedAt: current.completedAt,
      completedHealthEventId: current.completedHealthEventId
    } : {})
  });
  await run(
    connection,
    `UPDATE care_items
        SET kind = ?, title = ?, due_start = ?, reminder_at = ?, priority = ?, status = ?, notes = ?,
          completed_health_event_id = ?, completed_at = ?
      WHERE id = ?;`,
    careItem.kind,
    careItem.title,
    careItem.dueStart ?? null,
    careItem.reminderAt ?? null,
    careItem.priority,
    careItem.status,
    careItem.notes ?? null,
    careItem.completedHealthEventId ?? null,
    careItem.completedAt ?? null,
    id
  );
  await insertAudit(connection, "care-item-updated", `${careItem.title} care item updated.`);
  return { careItem, counts: await storageCounts(connection) };
}

export async function completeCareItem(
  connection: duckdb.Connection,
  id: string,
  input: CompleteCareItemInput
): Promise<CompleteCareItemResponse | undefined> {
  const rows = await allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM care_items WHERE id = ?;", id);
  if (!rows[0]) {
    return undefined;
  }
  const current = careItemFromRow(rows[0]);
  if (current.status !== "open") {
    throw new CareItemCompletionConflictError();
  }
  const validated = completeCareItemInputSchema.parse(input);
  const { healthEvent } = await createHealthEvent(connection, {
    kind: validated.kind,
    status: "completed",
    occurredAt: validated.occurredAt,
    notes: `Completed care item: ${current.title}.`
  });
  await run(
    connection,
    `UPDATE care_items
      SET status = 'completed', completed_at = ?, completed_health_event_id = ?
      WHERE id = ?;`,
    validated.occurredAt,
    healthEvent.id,
    id
  );
  await insertAudit(connection, "care-item-completed", `${current.title} care item completed.`);
  const careItem = careItemSchema.parse({
    ...current,
    status: "completed",
    completedAt: validated.occurredAt,
    completedHealthEventId: healthEvent.id,
    completedHealthEvent: {
      id: healthEvent.id,
      kind: healthEvent.kind,
      occurredAt: healthEvent.occurredAt,
      provider: healthEvent.provider
    }
  });
  return { careItem, healthEvent, counts: await storageCounts(connection) };
}

export async function deleteCareItem(
  connection: duckdb.Connection,
  id: string
): Promise<DeleteCareItemResponse | undefined> {
  const rows = await allWithParams(connection, "SELECT * EXCLUDE (ordinal) FROM care_items WHERE id = ?;", id);
  if (!rows[0]) {
    return undefined;
  }
  const careItem = careItemFromRow(rows[0]);
  await run(connection, "DELETE FROM care_items WHERE id = ?;", id);
  await insertAudit(connection, "care-item-deleted", `${careItem.title} care item deleted.`);
  return { deletedCount: 1, deletedCareItem: careItem, counts: await storageCounts(connection) };
}

export async function insertAudit(
  connection: duckdb.Connection,
  eventType: HealthStoreData["auditEvents"][number]["eventType"],
  detail: string
): Promise<HealthStoreData["auditEvents"][number]> {
  const auditEvent = {
    id: `audit_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
    createdAt: new Date().toISOString(),
    eventType,
    detail
  };
  await run(
    connection,
    "INSERT INTO audit_events VALUES (?, ?, ?, ?, ?);",
    await prependOrdinal(connection, "audit_events"),
    auditEvent.id,
    auditEvent.createdAt,
    auditEvent.eventType,
    auditEvent.detail
  );
  return auditEvent;
}

export async function nextOrdinal(connection: duckdb.Connection, table: OrderedTable): Promise<number> {
  const rows = await all(connection, `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM ${table};`);
  return Number(rows[0]?.ordinal ?? 0);
}

async function prependOrdinal(connection: duckdb.Connection, table: OrderedTable): Promise<number> {
  const rows = await all(connection, `SELECT COALESCE(MIN(ordinal), 1) - 1 AS ordinal FROM ${table};`);
  return Number(rows[0]?.ordinal ?? 0);
}

function observationDeleteDetail(observation: Observation): string {
  return `Observation ${observation.measurementCode} deleted at ${observation.observedAt} (${observation.value} ${observation.unit}).`;
}

function healthEventRecord(input: CreateHealthEventInput & { id: string; source: HealthEvent["source"] }): HealthEvent {
  if (input.kind === "immunization") {
    return {
      id: input.id,
      kind: "immunization",
      status: input.status,
      occurredAt: input.occurredAt,
      source: input.source,
      provider: input.provider,
      notes: input.notes
    };
  }
  if (input.kind === "medication-administration") {
    return {
      id: input.id,
      kind: "medication-administration",
      status: input.status,
      occurredAt: input.occurredAt,
      source: input.source,
      provider: input.provider,
      notes: input.notes
    };
  }
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    occurredAt: input.occurredAt,
    source: input.source,
    provider: input.provider,
    notes: input.notes
  };
}

function healthEventFromRow(row: Record<string, unknown>): HealthEvent {
  const kind = String(row.kind);
  if (!isHealthEventKind(kind)) {
    throw new Error(`Unsupported health event kind "${kind}".`);
  }
  const base = {
    id: String(row.id),
    status: String(row.status) as HealthEvent["status"],
    occurredAt: isoTimestamp(row.occurred_at),
    source: String(row.source) as HealthEvent["source"],
    provider: typeof row.provider === "string" ? row.provider : undefined,
    notes: typeof row.notes === "string" ? row.notes : undefined,
    metadata: optionalJson(row.metadata) as Record<string, unknown> | undefined
  };
  if (kind === "immunization") {
    return { ...base, kind: "immunization" };
  }
  if (kind === "medication-administration") {
    return { ...base, kind: "medication-administration" };
  }
  return { ...base, kind };
}

function careItemFromRow(row: Record<string, unknown>): CareItem {
  return careItemSchema.parse({
    id: row.id,
    kind: row.kind,
    code: row.code ?? undefined,
    title: row.title,
    dueStart: optionalTimestamp(row.due_start),
    reminderAt: optionalTimestamp(row.reminder_at),
    priority: row.priority,
    status: row.status,
    scheduleProvenance: row.schedule_provenance ?? undefined,
    scheduleVersion: row.schedule_version ?? undefined,
    notes: row.notes ?? undefined,
    completedHealthEventId: row.completed_health_event_id ?? undefined,
    completedAt: optionalTimestamp(row.completed_at)
  });
}

async function validateAndPrepareCareItem(
  connection: duckdb.Connection,
  input: CreateCareItemInput & { id: string; completedAt?: string; completedHealthEventId?: string }
): Promise<CareItem> {
  if (input.completedHealthEventId) {
    await assertHealthEventExists(connection, input.completedHealthEventId);
  }
  if (input.status === "completed" && !input.completedHealthEventId) {
    throw new RepositoryValidationError("Complete care items using the completion endpoint.");
  }
  return careItemSchema.parse({
    id: input.id,
    kind: input.kind,
    title: input.title,
    dueStart: input.dueStart,
    reminderAt: input.reminderAt,
    priority: input.priority,
    status: input.status,
    notes: input.notes,
    completedHealthEventId: input.status === "completed" ? input.completedHealthEventId : undefined,
    completedAt: input.status === "completed" ? input.completedAt : undefined
  });
}

async function assertHealthEventExists(connection: duckdb.Connection, id: string): Promise<void> {
  const rows = await allWithParams(connection, "SELECT 1 AS found FROM health_events WHERE id = ? LIMIT 1;", id);
  if (!rows[0]) {
    throw new RepositoryValidationError(`Linked health event ${id} was not found.`);
  }
}

async function linkedCareItemConflicts(connection: duckdb.Connection, healthEventId: string): Promise<LinkedCareItemConflict[]> {
  const rows = await allWithParams(connection, `
    SELECT id, title, 'completion' AS role
    FROM care_items
    WHERE completed_health_event_id = ?
    ORDER BY title, id;
  `, healthEventId);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    role: String(row.role) as LinkedCareItemConflict["role"]
  }));
}

type OrderedTable =
  | "imports"
  | "sources"
  | "observations"
  | "observation_groups"
  | "time_series_samples"
  | "activities"
  | "health_events"
  | "care_items"
  | "insights"
  | "audit_events";