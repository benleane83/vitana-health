import type duckdb from "duckdb";
import { createHash } from "node:crypto";
import {
  careItemSchema,
  canonicalizeMeasurement,
  completeCareItemInputSchema,
  createCareItemInputSchema,
  createHealthEventInputSchema,
  convertMeasurementValue,
  defaultHealthEventKindForCareItem,
  describeMeasurementRejection,
  isHealthEventKind,
  insightSchema,
  personalReferenceRangeInputSchema,
  personalReferenceRangeSchema,
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
  insertObservationRows,
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
import { selectColumns } from "./duckdbColumns.js";

// Named column lists, not `SELECT * EXCLUDE (...)`: that syntax is DuckDB-only, and `*` silently
// widens every DTO the moment the schema gains a column.
const measurementTypeColumns = selectColumns("measurement_types", { excludeOrdinal: true });
const observationColumns = selectColumns("observations", { excludeOrdinal: true });
const healthEventColumns = selectColumns("health_events", { excludeOrdinal: true });
const careItemColumns = selectColumns("care_items", { excludeOrdinal: true });

/**
 * Bulk deletes report the identifiers they removed so callers can emit one replica tombstone per
 * row instead of diffing the whole store.
 */
export interface DeletedIdsResult {
  deletedCount: number;
  deletedIds: string[];
}

export type DeleteObservationsByTypeResult = DeleteObservationsByTypeResponse & DeletedIdsResult;

async function deletedObservationIds(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<string[]> {
  const rows = await allWithParams(
    connection,
    "SELECT id FROM observations WHERE measurement_code = ?;",
    measurementCode
  );
  return rows.map((row) => String(row.id));
}

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
  const parsedInput = personalReferenceRangeInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new RepositoryValidationError(parsedInput.error.issues[0]?.message ?? "Invalid reference range.");
  }
  input = parsedInput.data;
  const typeRows = await allWithParams(
    connection,
    `SELECT ${measurementTypeColumns} FROM measurement_types WHERE code = ?;`,
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
  const optimalLow = typeof input.optimalLow === "number"
    ? convertMeasurementValue(input.optimalLow, type, input.unit, type.canonicalUnit)
    : input.optimalLow;
  const optimalHigh = typeof input.optimalHigh === "number"
    ? convertMeasurementValue(input.optimalHigh, type, input.unit, type.canonicalUnit)
    : input.optimalHigh;
  if ((input.low !== undefined && low === undefined) || (input.high !== undefined && high === undefined) ||
      (typeof input.optimalLow === "number" && optimalLow === undefined) ||
      (typeof input.optimalHigh === "number" && optimalHigh === undefined)) {
    throw new RepositoryValidationError(`Unit "${input.unit}" is not supported for ${type.display}.`);
  }
  const existingRows = input.optimalLow === undefined
    ? await allWithParams(
        connection,
        "SELECT optimal_low, optimal_high FROM personal_reference_ranges WHERE measurement_code = ?;",
        measurementCode
      )
    : [];
  const persistedOptimalLow = input.optimalLow === undefined
    ? existingRows[0]?.optimal_low === null || existingRows[0]?.optimal_low === undefined ? undefined : Number(existingRows[0].optimal_low)
    : optimalLow === null ? undefined : optimalLow;
  const persistedOptimalHigh = input.optimalHigh === undefined
    ? existingRows[0]?.optimal_high === null || existingRows[0]?.optimal_high === undefined ? undefined : Number(existingRows[0].optimal_high)
    : optimalHigh === null ? undefined : optimalHigh;
  const range = {
    measurementCode,
    ...(low === undefined ? {} : { normalLow: low }),
    ...(high === undefined ? {} : { normalHigh: high }),
    ...(persistedOptimalLow === undefined ? {} : { optimalLow: persistedOptimalLow }),
    ...(persistedOptimalHigh === undefined ? {} : { optimalHigh: persistedOptimalHigh }),
    unit: type.canonicalUnit,
    updatedAt: new Date().toISOString()
  };
  const parsedRange = personalReferenceRangeSchema.safeParse(range);
  if (!parsedRange.success) {
    throw new RepositoryValidationError(parsedRange.error.issues[0]?.message ?? "Invalid reference range.");
  }
  await run(connection, `
    INSERT INTO personal_reference_ranges
      (measurement_code, normal_low, normal_high, optimal_low, optimal_high, unit, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (measurement_code) DO UPDATE SET
      normal_low = EXCLUDED.normal_low, normal_high = EXCLUDED.normal_high,
      optimal_low = EXCLUDED.optimal_low, optimal_high = EXCLUDED.optimal_high,
      unit = EXCLUDED.unit, updated_at = EXCLUDED.updated_at;
  `, parsedRange.data.measurementCode, parsedRange.data.normalLow ?? null, parsedRange.data.normalHigh ?? null,
  parsedRange.data.optimalLow ?? null, parsedRange.data.optimalHigh ?? null, parsedRange.data.unit, parsedRange.data.updatedAt);
  await insertAudit(connection, "personal-reference-range-set", `Personal reference range set for ${measurementCode}.`);
  return parsedRange.data;
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
  const { accepted, rejections } = await insertObservationRows(connection, [observation], ordinal);
  if (accepted.length === 0) {
    throw new RepositoryValidationError(rejections[0] ?? "Observation could not be stored.");
  }
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
): Promise<DeletedIdsResult> {
  const deletedIds = await deletedObservationIds(connection, measurementCode);
  if (deletedIds.length > 0) {
    await run(connection, "DELETE FROM observations WHERE measurement_code = ?;", measurementCode);
  }
  return { deletedCount: deletedIds.length, deletedIds };
}

export async function deleteObservation(
  connection: duckdb.Connection,
  id: string
): Promise<DeleteObservationResponse | undefined> {
  const rows = await allWithParams(connection, `SELECT ${observationColumns} FROM observations WHERE id = ?;`, id);
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
  // Manual edits go through the same canonicalization as imports, otherwise editing a row could
  // reintroduce a unit the aggregation views cannot sum.
  const canonical = canonicalizeMeasurement(input.measurementCode, input.value, input.unit);
  if (canonical.rejected) {
    throw new RepositoryValidationError(describeMeasurementRejection(canonical));
  }
  await run(
    connection,
    `UPDATE observations SET measurement_code = ?, observed_at = ?, value = ?, unit = ?, source_unit = ?, note = ? WHERE id = ?;`,
    input.measurementCode,
    input.observedAt,
    canonical.value,
    canonical.unit,
    canonical.sourceUnit ?? null,
    input.note ?? null,
    id
  );
  const updatedRows = await allWithParams(connection, `SELECT ${observationColumns} FROM observations WHERE id = ?;`, id);
  const updatedObservation = observationFromRow(updatedRows[0]);
  await insertAudit(connection, "observation-updated", `${updatedObservation.measurementCode} observation updated for ${updatedObservation.observedAt}.`);
  return { updatedObservation, counts: await storageCounts(connection) };
}

export async function deleteObservationsByMeasurementCode(
  connection: duckdb.Connection,
  measurementCode: string
): Promise<DeleteObservationsByTypeResult> {
  const deletedIds = await deletedObservationIds(connection, measurementCode);
  const deletedCount = deletedIds.length;
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
    deletedIds,
    measurementCode,
    counts: await storageCounts(connection)
  };
}

export async function deleteDailyAggregateStepSamples(
  connection: duckdb.Connection
): Promise<DeleteObservationsByTypeResult> {
  const dailyAggregatePredicate = `
    measurement_code = 'steps'
      AND DATE_DIFF('second', start_at, end_at) >= 23 * 60 * 60
  `;
  const rows = await all(
    connection,
    `SELECT id FROM time_series_samples WHERE ${dailyAggregatePredicate};`
  );
  const deletedIds = rows.map((row) => String(row.id));
  const deletedCount = deletedIds.length;
  if (deletedCount > 0) {
    await run(connection, `DELETE FROM time_series_samples WHERE ${dailyAggregatePredicate};`);
    await insertAudit(
      connection,
      "daily-step-aggregates-deleted",
      `${deletedCount} daily aggregate Steps sample(s) deleted.`
    );
  }
  return {
    deletedCount,
    deletedIds,
    measurementCode: "steps",
    counts: await storageCounts(connection)
  };
}

export async function normalizeHealthConnectStepSamples(
  connection: duckdb.Connection,
  sourceId: string,
  replacementDates: readonly string[]
): Promise<string[]> {
  const dates = [...new Set(replacementDates.map((value) => value.slice(0, 10)))];
  const deletedIds: string[] = [];
  if (dates.length > 0) {
    const placeholders = dates.map(() => "?").join(", ");
    const rows = await allWithParams(
      connection,
      `SELECT id FROM time_series_samples
       WHERE measurement_code = 'steps' AND source_id = ? AND CAST(end_at AS DATE) IN (${placeholders});`,
      sourceId,
      ...dates
    );
    deletedIds.push(...rows.map((row) => String(row.id)));
    if (deletedIds.length > 0) {
      await run(
        connection,
        `DELETE FROM time_series_samples WHERE id IN (${deletedIds.map(() => "?").join(", ")});`,
        ...deletedIds
      );
    }
  }

  const duplicateRows = await allWithParams(connection, `
    SELECT duplicate.id
    FROM time_series_samples AS duplicate
    JOIN time_series_samples AS keeper
      ON keeper.measurement_code = duplicate.measurement_code
      AND keeper.source_id = duplicate.source_id
      AND CAST(keeper.end_at AS DATE) = CAST(duplicate.end_at AS DATE)
      AND (keeper.end_at > duplicate.end_at OR (keeper.end_at = duplicate.end_at AND keeper.id > duplicate.id))
    WHERE duplicate.measurement_code = 'steps' AND duplicate.source_id = ?;
  `, sourceId);
  const duplicateIds = duplicateRows.map((row) => String(row.id));
  if (duplicateIds.length > 0) {
    deletedIds.push(...duplicateIds);
    await run(
      connection,
      `DELETE FROM time_series_samples WHERE id IN (${duplicateIds.map(() => "?").join(", ")});`,
      ...duplicateIds
    );
  }

  await run(
    connection,
    `UPDATE time_series_samples
     SET start_at = DATE_TRUNC('day', end_at), end_at = DATE_TRUNC('day', end_at)
     WHERE measurement_code = 'steps' AND source_id = ?;`,
    sourceId
  );
  return deletedIds;
}

export async function deleteStepSamples(
  connection: duckdb.Connection
): Promise<DeleteObservationsByTypeResult> {
  const rows = await all(
    connection,
    "SELECT id FROM time_series_samples WHERE measurement_code = 'steps';"
  );
  const deletedIds = rows.map((row) => String(row.id));
  const deletedCount = deletedIds.length;
  if (deletedCount > 0) {
    await run(connection, "DELETE FROM time_series_samples WHERE measurement_code = 'steps';");
    await insertAudit(
      connection,
      "step-samples-deleted",
      `${deletedCount} Steps sample(s) deleted.`
    );
  }
  return {
    deletedCount,
    deletedIds,
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
  const rows = await allWithParams(connection, `SELECT ${healthEventColumns} FROM health_events WHERE id = ?;`, id);
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
  if (event.kind !== "medication") {
    await run(connection, "DELETE FROM medication_administrations WHERE health_event_id = ?;", id);
  }
  await insertAudit(connection, "health-event-updated", `${event.kind} event updated for ${event.occurredAt}.`);
  return { healthEvent: event, counts: await storageCounts(connection) };
}

export async function deleteHealthEvent(
  connection: duckdb.Connection,
  id: string
): Promise<DeleteHealthEventResponse | undefined> {
  const rows = await allWithParams(connection, `SELECT ${healthEventColumns} FROM health_events WHERE id = ?;`, id);
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
  const rows = await allWithParams(connection, `SELECT ${careItemColumns} FROM care_items WHERE id = ?;`, id);
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
  const rows = await allWithParams(connection, `SELECT ${careItemColumns} FROM care_items WHERE id = ?;`, id);
  if (!rows[0]) {
    return undefined;
  }
  const current = careItemFromRow(rows[0]);
  if (current.status !== "open") {
    throw new CareItemCompletionConflictError();
  }
  const validated = completeCareItemInputSchema.parse(input);
  const eventKind = defaultHealthEventKindForCareItem[current.kind];
  const healthEvent = eventKind
    ? (await createHealthEvent(connection, {
        kind: validated.kind ?? eventKind,
        status: "completed",
        occurredAt: validated.occurredAt,
        notes: `Completed care item: ${current.title}.`
      })).healthEvent
    : undefined;
  await run(
    connection,
    `UPDATE care_items
      SET status = 'completed', completed_at = ?, completed_health_event_id = ?
      WHERE id = ?;`,
    validated.occurredAt,
    healthEvent?.id ?? null,
    id
  );
  await insertAudit(connection, "care-item-completed", `${current.title} care item completed.`);
  const careItemInput: CareItem = {
    ...current,
    status: "completed",
    completedAt: validated.occurredAt,
    ...(healthEvent ? {
      completedHealthEventId: healthEvent.id,
      completedHealthEvent: {
        id: healthEvent.id,
        kind: healthEvent.kind,
        occurredAt: healthEvent.occurredAt,
        provider: healthEvent.provider
      }
    } : {})
  };
  if (!healthEvent) {
    delete careItemInput.completedHealthEventId;
    delete careItemInput.completedHealthEvent;
  }
  const careItem = careItemSchema.parse(careItemInput);
  return { careItem, ...(healthEvent ? { healthEvent } : {}), counts: await storageCounts(connection) };
}

export async function deleteCareItem(
  connection: duckdb.Connection,
  id: string
): Promise<DeleteCareItemResponse | undefined> {
  const rows = await allWithParams(connection, `SELECT ${careItemColumns} FROM care_items WHERE id = ?;`, id);
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

/**
 * Ordinal counters cached per connection.
 *
 * Every insert used to aggregate the whole table to find its next ordinal, so a single import paid
 * a full scan per row. The bounds only ever move outwards, so seeding once and advancing in memory
 * gives the same ordering guarantee. A rolled-back transaction or a retention prune merely leaves a
 * gap, which nothing depends on.
 */
const ordinalCounters = new WeakMap<duckdb.Connection, Map<OrderedTable, OrdinalBounds>>();

interface OrdinalBounds {
  next: number;
  previous: number;
}

async function ordinalBounds(connection: duckdb.Connection, table: OrderedTable): Promise<OrdinalBounds> {
  let tables = ordinalCounters.get(connection);
  if (!tables) {
    tables = new Map();
    ordinalCounters.set(connection, tables);
  }
  const cached = tables.get(table);
  if (cached) return cached;
  const rows = await all(
    connection,
    `SELECT COALESCE(MAX(ordinal), -1) + 1 AS next, COALESCE(MIN(ordinal), 1) - 1 AS previous FROM ${table};`
  );
  const bounds: OrdinalBounds = {
    next: Number(rows[0]?.next ?? 0),
    previous: Number(rows[0]?.previous ?? 0)
  };
  tables.set(table, bounds);
  return bounds;
}

/**
 * Reserves consecutive ordinals for writes serialized by `enqueueMutation`. Repository-direct or
 * multi-process writers are unsupported; a future SQLite provider needs an atomic allocator.
 */
export async function nextOrdinal(
  connection: duckdb.Connection,
  table: OrderedTable,
  count = 1
): Promise<number> {
  const bounds = await ordinalBounds(connection, table);
  const first = bounds.next;
  bounds.next += Math.max(count, 0);
  return first;
}

async function prependOrdinal(connection: duckdb.Connection, table: OrderedTable): Promise<number> {
  const bounds = await ordinalBounds(connection, table);
  return bounds.previous--;
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
  if (input.kind === "medication") {
    return {
      id: input.id,
      kind: "medication",
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
  if (kind === "medication") {
    return { ...base, kind: "medication" };
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
  | "measurement_aggregates"
  | "activities"
  | "health_events"
  | "care_items"
  | "insights"
  | "audit_events";