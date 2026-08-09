import { z } from "zod";
import { healthEventKindCodes, normalizedCareItemKind } from "./types.js";
import type { HealthStoreData, InsightModel } from "./types.js";

/**
 * Version of the *document* format — the shape of a `HealthStoreData` object as it appears in an
 * export or a backup envelope. It is deliberately distinct from `DB_SCHEMA_VERSION` in
 * `apps/api/src/storage/duckdbRuntime.ts`, which versions the *physical* DuckDB table layout.
 *
 * The two move independently: a DuckDB migration that only adds an index bumps DB_SCHEMA_VERSION
 * and leaves this alone, while a new field on an observation bumps this and leaves the table
 * layout alone. Confusing them breaks backup/restore, which reads and writes this format and has
 * no knowledge of the storage engine that produced it.
 */
export const EXPORT_FORMAT_VERSION = 12 as const;

export const sourceKindSchema = z.enum([
  "health-connect", "manual-entry", "blood-test-csv", "observation-csv", "structured-upload",
  "blood-test-report", "body-composition-report", "derived"
]);
const sourceKind = sourceKindSchema;
export const observationGroupKindSchema = z.enum([
  "lab_panel", "body_composition_report", "activity_session", "sleep_session", "import_batch", "custom"
]);
const stringRecord = z.record(z.unknown());

export const profileObjectSchema = z.object({
  id: z.string(), displayName: z.string(), subjectKind: z.enum(["adult", "child", "pet"]).default("adult"),
  setupStatus: z.enum(["pending", "dismissed", "complete"]),
  birthDate: z.string().date().optional(),
  sex: z.enum(["female", "male", "intersex", "unknown", "not-specified"]).optional(),
  bloodType: z.enum([
    "a-positive", "a-negative", "b-positive", "b-negative", "ab-positive", "ab-negative",
    "o-positive", "o-negative", "unknown"
  ]).optional(),
  heightCm: z.number().optional(), goalSummary: z.string().optional(),
  cloudAiConsent: z.object({
    enabled: z.boolean(), providerScopeAccepted: z.boolean(), consentedAt: z.string().optional(), consentVersion: z.string().optional()
  }).optional(),
  pet: z.object({
    species: z.string().min(1), breed: z.string().optional(),
    reproductiveStatus: z.enum(["intact", "neutered", "spayed", "unknown"]).optional(),
    microchipId: z.string().optional()
  }).strict().optional(),
  units: z.enum(["metric", "imperial"]), updatedAt: z.string()
}).strict();

export const profileSchema = profileObjectSchema.superRefine((profile, context) => {
  if (profile.subjectKind === "pet" && !profile.pet?.species?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pet", "species"], message: "Pet profiles require a species." });
  }
});

export const insightSchema = z.object({
  id: z.string(), createdAt: z.string(), title: z.string(), body: z.string(), evidence: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  model: z.custom<InsightModel>((value) =>
    value === "deterministic" || value === "local-llm" ||
    (typeof value === "string" && /^(ollama|openai):.+$/.test(value))
  ),
  safetyNotice: z.string()
}).strict();

export const referenceRangeSchema = z.object({
  low: z.number().optional(), high: z.number().optional(), unit: z.string(),
  label: z.string().optional(), source: z.string().optional()
}).strict();

export const measurementTypeSchema = z.object({
  code: z.string(), display: z.string(), description: z.string().default(""),
  category: z.enum(["activity", "cardio", "sleep", "body", "lab", "derived"]),
  kind: z.enum(["point", "interval", "event", "panel-component"]), canonicalUnit: z.string(), aliases: z.array(z.string()),
  preferredUnits: z.object({ metric: z.string().optional(), imperial: z.string().optional() }).strict().optional(),
  unitAliases: z.record(z.array(z.string())).optional(),
  fhirCode: z.string().optional(), loincCode: z.string().optional(), openMHealthSchema: z.string().optional(),
  normalLow: z.number().optional(), normalHigh: z.number().optional(),
  referenceRanges: z.array(referenceRangeSchema).optional(),
  aggregation: z.enum(["sum", "average", "min", "max", "latest", "none"])
}).strict();

export const personalReferenceRangeSchema = z.object({
  measurementCode: z.string().trim().min(1),
  normalLow: z.number().finite().optional(),
  normalHigh: z.number().finite().optional(),
  optimalLow: z.number().finite().optional(),
  optimalHigh: z.number().finite().optional(),
  unit: z.string().trim().min(1),
  updatedAt: z.string()
}).strict().superRefine((range, context) => {
  if (range.normalLow === undefined && range.normalHigh === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one normal reference-range bound is required." });
  }
  if (range.normalLow !== undefined && range.normalHigh !== undefined && range.normalLow > range.normalHigh) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["normalHigh"], message: "Normal upper bound must be greater than or equal to lower bound." });
  }
  if ((range.optimalLow === undefined) !== (range.optimalHigh === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [range.optimalLow === undefined ? "optimalLow" : "optimalHigh"], message: "Enter both optimal reference-range bounds." });
  }
  if (range.optimalLow !== undefined && range.optimalHigh !== undefined && range.optimalLow > range.optimalHigh) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["optimalHigh"], message: "Optimal upper bound must be greater than or equal to lower bound." });
  }
  if (range.optimalLow !== undefined && range.optimalHigh !== undefined) {
    if (range.normalLow === undefined || range.normalHigh === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["optimalLow"], message: "Optimal bounds require both normal reference-range bounds." });
    } else if (range.optimalLow < range.normalLow || range.optimalHigh > range.normalHigh) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["optimalLow"], message: "Optimal range must sit within the normal range." });
    }
  }
});


export const sourceImportSchema = z.object({
  id: z.string(), sourceKind, fileName: z.string(), importedAt: z.string(), parserVersion: z.string(),
  checksum: z.string(), rowCount: z.number(), status: z.enum(["processed", "needs-review", "failed"]),
  diagnostics: z.array(z.string()), rawContent: z.string().optional()
}).strict();

export const dataSourceSchema = z.object({
  id: z.string(), sourceKind, label: z.string(), importId: z.string().optional(), createdAt: z.string()
}).strict();

export const deviceSchema = z.object({
  id: z.string(), label: z.string(), manufacturer: z.string().optional(), model: z.string().optional(), sourceId: z.string().optional()
}).strict();

export const pinnedMeasurementSchema = z.object({
  measurementCode: z.string().trim().min(1),
  pinnedAt: z.string().datetime({ offset: true })
}).strict();

export const observationSchema = z.object({
  id: z.string(), measurementCode: z.string(), observedAt: z.string(), effectiveStart: z.string().optional(), effectiveEnd: z.string().optional(),
  value: z.number(), unit: z.string(), sourceId: z.string(), observationGroupId: z.string().optional(), deviceId: z.string().optional(),
  note: z.string().optional(), sourceJson: z.unknown().optional()
}).strict();

export const observationGroupSchema = z.object({
  id: z.string(), kind: observationGroupKindSchema,
  label: z.string(), sourceId: z.string().optional(), importId: z.string().optional(), startAt: z.string().optional(),
  endAt: z.string().optional(), collectedAt: z.string().optional(), metadata: stringRecord.optional()
}).strict();

export const timeSeriesSampleSchema = z.object({
  id: z.string(), measurementCode: z.string(), startAt: z.string(), endAt: z.string(), value: z.number(), unit: z.string(),
  sourceId: z.string(), deviceId: z.string().optional(), sourceJson: z.unknown().optional()
}).strict();

export const measurementAggregateSchema = z.object({
  id: z.string(), measurementCode: z.string(), granularity: z.enum(["15m", "day"]),
  startAt: z.string(), endAt: z.string(), average: z.number(), minimum: z.number(), maximum: z.number(),
  count: z.number().int().positive(), unit: z.string(), sourceId: z.string(), calendarDate: z.string().optional(),
  sourceJson: z.unknown().optional()
}).strict();

export const activitySessionSchema = z.object({
  id: z.string(), activityType: z.string(), startAt: z.string(), endAt: z.string().optional(), durationMinutes: z.number().optional(),
  energyKcal: z.number().optional(), distanceMeters: z.number().optional(), sourceId: z.string(), sourceJson: z.unknown().optional()
}).strict();

export const healthEventObjectSchema = z.object({
  id: z.string(), kind: z.enum(healthEventKindCodes), status: z.enum(["completed", "entered-in-error"]),
  occurredAt: z.string(), source: sourceKind, provider: z.string().optional(),
  notes: z.string().optional(), metadata: stringRecord.optional(),
  immunization: z.object({
    vaccine: z.string(), targetDisease: z.string().optional(), doseNumber: z.number().int().positive().optional(),
    series: z.string().optional(), manufacturer: z.string().optional(), lotNumber: z.string().optional(),
    expiresAt: z.string().optional(), route: z.string().optional(), site: z.string().optional(), reaction: z.string().optional()
  }).strict().optional(),
  medicationAdministration: z.object({
    medication: z.string(), activeIngredient: z.string().optional(), dose: z.number(), unit: z.string(), route: z.string().optional()
  }).strict().optional()
}).strict();

export const persistedHealthEventSchema = healthEventObjectSchema.superRefine((value, context) => {
  if (value.immunization && value.kind !== "immunization") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["immunization"], message: "Immunization details require an immunization event." });
  }
  if (value.medicationAdministration && value.kind !== "medication") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["medicationAdministration"], message: "Medication details require a medication event." });
  }
});

/**
 * `kind` is normalised rather than rejected: care items can arrive from schedule templates and
 * older stores that predate the closed taxonomy, and losing the whole store to one stray label
 * would be a far worse failure than filing it under "other".
 */
export const persistedCareItemSchema = z.object({
  id: z.string(), kind: z.string().transform(normalizedCareItemKind), code: z.string().optional(), title: z.string(), dueStart: z.string().optional(),
  reminderAt: z.string().optional(), priority: z.enum(["low", "normal", "high"]),
  status: z.enum(["open", "completed", "cancelled", "skipped"]), scheduleProvenance: z.string().optional(),
  scheduleVersion: z.string().optional(), notes: z.string().optional(),
  completedHealthEventId: z.string().optional(), completedAt: z.string().optional(),
  completedHealthEvent: z.object({
    id: z.string(), kind: z.enum(healthEventKindCodes), occurredAt: z.string(), provider: z.string().optional()
  }).strict().optional()
}).strict();

const storeFields = {
  profile: profileSchema,
  sourceImports: z.array(sourceImportSchema),
  dataSources: z.array(dataSourceSchema),
  devices: z.array(deviceSchema),
  measurementTypes: z.array(measurementTypeSchema),
  personalReferenceRanges: z.array(personalReferenceRangeSchema).default([]),
  pinnedMeasurements: z.array(pinnedMeasurementSchema).default([]),
  observations: z.array(observationSchema),
  observationGroups: z.array(observationGroupSchema),
  timeSeriesSamples: z.array(timeSeriesSampleSchema),
  measurementAggregates: z.array(measurementAggregateSchema),
  activitySessions: z.array(activitySessionSchema),
  healthEvents: z.array(persistedHealthEventSchema).default([]),
  careItems: z.array(persistedCareItemSchema).default([]),
  insights: z.array(insightSchema),
  auditEvents: z.array(z.object({
    id: z.string(), createdAt: z.string(),
    eventType: z.enum(["store-created", "profile-updated", "migration-applied", "import-processed", "insight-generated", "export-created", "observation-updated", "observation-group-updated", "observation-deleted", "observation-type-deleted", "daily-step-aggregates-deleted", "step-samples-deleted", "health-event-created", "health-event-updated", "health-event-deleted", "care-item-created", "care-item-updated", "care-item-completed", "care-item-cancelled", "care-item-deleted", "personal-reference-range-set", "personal-reference-range-removed", "measurement-pinned", "measurement-unpinned", "profile-photo-replaced", "profile-photo-deleted"]),
    detail: z.string()
  }).strict())
};

export const healthStoreDataSchema = z.object({
  schemaVersion: z.literal(EXPORT_FORMAT_VERSION),
  ...storeFields
}).strict();

const versionNineHealthStoreSchema = z.object({
  schemaVersion: z.literal(9),
  healthEvents: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()).default([]),
  careItems: z.array(z.object({ completedHealthEventId: z.string().optional() }).passthrough()).default([])
}).passthrough();

function migrateVersionNineHealthStore(data: unknown): unknown {
  const store = versionNineHealthStoreSchema.parse(data);
  const removedKinds = new Set(["treatment", "dental", "test", "injury"]);
  const removedEventIds = new Set(store.healthEvents
    .filter((event) => removedKinds.has(event.kind))
    .map((event) => event.id));
  const healthEvents = store.healthEvents.flatMap((event) => {
    if (removedKinds.has(event.kind)) return [];
    if (event.kind === "medication-administration") return [{ ...event, kind: "medication" }];
    if (event.kind === "allergy-reaction") return [{ ...event, kind: "allergy-intolerance" }];
    return [event];
  });
  const careItems = store.careItems.map((item) => {
    if (!item.completedHealthEventId || !removedEventIds.has(item.completedHealthEventId)) return item;
    const migratedItem = { ...item };
    delete migratedItem.completedHealthEventId;
    return migratedItem;
  });
  return { ...store, schemaVersion: 10, healthEvents, careItems };
}

const versionTenHealthStoreSchema = z.object({
  schemaVersion: z.literal(10),
  careItems: z.array(z.object({ kind: z.string() }).passthrough()).default([])
}).passthrough();

function migrateVersionTenHealthStore(data: unknown): unknown {
  const store = versionTenHealthStoreSchema.parse(data);
  return {
    ...store,
    schemaVersion: 11,
    careItems: store.careItems.map((item) => ({ ...item, kind: normalizedCareItemKind(item.kind) }))
  };
}

const versionElevenHealthStoreSchema = z.object({
  schemaVersion: z.literal(11),
  profile: z.object({}).passthrough()
}).passthrough();

function migrateVersionElevenHealthStore(data: unknown): unknown {
  const store = versionElevenHealthStoreSchema.parse(data);
  return {
    ...store,
    schemaVersion: EXPORT_FORMAT_VERSION,
    profile: { ...store.profile, setupStatus: "complete" }
  };
}

/**
 * Reads the current persisted shape plus the two preceding development formats needed by local
 * profiles. Version 9 first migrates Health Events, then version 10 migrates Care Item kinds.
 */
export function parsePersistedHealthStore(data: unknown): HealthStoreData {
  const version = z.object({ schemaVersion: z.number().int() }).passthrough().parse(data).schemaVersion;
  const versionTenData = version === 9 ? migrateVersionNineHealthStore(data) : data;
  const versionElevenData = version === 9 || version === 10 ? migrateVersionTenHealthStore(versionTenData) : data;
  const currentData = version === 9 || version === 10 || version === 11
    ? migrateVersionElevenHealthStore(versionElevenData)
    : data;
  if (![9, 10, 11, EXPORT_FORMAT_VERSION].includes(version)) {
    throw new Error(`Unsupported health store schema version ${version}.`);
  }
  return healthStoreDataSchema.parse(currentData) as HealthStoreData;
}
