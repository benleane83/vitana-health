import type duckdb from "duckdb";
import {
  insightSchema,
  profileSchema,
  type AppBootstrap,
  type DeleteObservationResponse,
  type DeleteObservationsByTypeResponse,
  type HealthStoreData,
  type Observation,
  type Profile,
  type UpdateObservationInput,
  type UpdateObservationResponse
} from "@local-fitness-advisor/shared";
import { storageCounts } from "./duckdbProjections.js";
import {
  all,
  allWithParams,
  json,
  observationFromRow,
  optionalJsonValue,
  profileFromRow,
  run
} from "./duckdbRows.js";

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

type OrderedTable =
  | "imports"
  | "sources"
  | "observations"
  | "observation_groups"
  | "time_series_samples"
  | "activities"
  | "insights"
  | "audit_events";