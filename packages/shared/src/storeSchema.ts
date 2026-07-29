import { z } from "zod";
import { healthEventKindCodes } from "./types.js";
import type { HealthStoreData, InsightModel } from "./types.js";
import { defaultMeasurementTypes } from "./registry.js";

export const CURRENT_SCHEMA_VERSION = 8 as const;

/**
 * Every persisted schema version `parsePersistedHealthStore` can read. Anything else is rejected
 * rather than silently mis-parsed - see the coverage test that walks this list.
 */
export const SUPPORTED_PERSISTED_SCHEMA_VERSIONS = [1, 2, 4, 5, 6, 7, 8] as const;

const sourceKind = z.enum([
  "health-connect", "manual-entry", "blood-test-csv", "observation-csv", "structured-upload",
  "blood-test-report", "body-composition-report", "derived"
]);
const stringRecord = z.record(z.unknown());

export const profileSchema = z.object({
  id: z.string(), displayName: z.string(), subjectKind: z.enum(["adult", "child", "pet"]).default("adult"),
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
}).strict().superRefine((profile, context) => {
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

const measurementTypeSchema = z.object({
  code: z.string(), display: z.string(), description: z.string().default(""),
  category: z.enum(["activity", "cardio", "sleep", "body", "lab", "derived"]),
  kind: z.enum(["point", "interval", "event", "panel-component"]), canonicalUnit: z.string(), aliases: z.array(z.string()),
  preferredUnits: z.object({ metric: z.string().optional(), imperial: z.string().optional() }).strict().optional(),
  unitAliases: z.record(z.array(z.string())).optional(),
  fhirCode: z.string().optional(), loincCode: z.string().optional(), openMHealthSchema: z.string().optional(),
  normalLow: z.number().optional(), normalHigh: z.number().optional(),
  referenceRanges: z.array(z.object({ low: z.number().optional(), high: z.number().optional(), unit: z.string(), label: z.string().optional(), source: z.string().optional() }).strict()).optional(),
  aggregation: z.enum(["sum", "average", "min", "max", "latest", "none"])
}).strict();

const personalReferenceRangeSchema = z.object({
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
  if (range.optimalLow !== undefined && range.optimalHigh !== undefined && range.optimalLow > range.optimalHigh) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["optimalHigh"], message: "Optimal upper bound must be greater than or equal to lower bound." });
  }
});

const version5PersonalReferenceRangeSchema = z.object({
  measurementCode: z.string().trim().min(1),
  low: z.number().finite().optional(),
  high: z.number().finite().optional(),
  unit: z.string().trim().min(1),
  updatedAt: z.string()
}).strict();

const storeFields = {
  profile: profileSchema,
  sourceImports: z.array(z.object({
    id: z.string(), sourceKind, fileName: z.string(), importedAt: z.string(), parserVersion: z.string(),
    checksum: z.string(), rowCount: z.number(), status: z.enum(["processed", "needs-review", "failed"]),
    diagnostics: z.array(z.string()), rawContent: z.string().optional()
  }).strict()),
  dataSources: z.array(z.object({
    id: z.string(), sourceKind, label: z.string(), importId: z.string().optional(), createdAt: z.string()
  }).strict()),
  devices: z.array(z.object({
    id: z.string(), label: z.string(), manufacturer: z.string().optional(), model: z.string().optional(), sourceId: z.string().optional()
  }).strict()),
  measurementTypes: z.array(measurementTypeSchema),
  personalReferenceRanges: z.array(personalReferenceRangeSchema).default([]),
  pinnedMeasurements: z.array(z.object({
    measurementCode: z.string().trim().min(1),
    pinnedAt: z.string().datetime({ offset: true })
  }).strict()).default([]),
  observations: z.array(z.object({
    id: z.string(), measurementCode: z.string(), observedAt: z.string(), effectiveStart: z.string().optional(), effectiveEnd: z.string().optional(),
    value: z.number(), unit: z.string(), sourceId: z.string(), observationGroupId: z.string().optional(), deviceId: z.string().optional(),
    note: z.string().optional(), sourceJson: z.unknown().optional()
  }).strict()),
  observationGroups: z.array(z.object({
    id: z.string(), kind: z.enum(["lab_panel", "body_composition_report", "activity_session", "sleep_session", "import_batch", "custom"]),
    label: z.string(), sourceId: z.string().optional(), importId: z.string().optional(), startAt: z.string().optional(),
    endAt: z.string().optional(), collectedAt: z.string().optional(), metadata: stringRecord.optional()
  }).strict()),
  timeSeriesSamples: z.array(z.object({
    id: z.string(), measurementCode: z.string(), startAt: z.string(), endAt: z.string(), value: z.number(), unit: z.string(),
    sourceId: z.string(), deviceId: z.string().optional(), sourceJson: z.unknown().optional()
  }).strict()),
  activitySessions: z.array(z.object({
    id: z.string(), activityType: z.string(), startAt: z.string(), endAt: z.string().optional(), durationMinutes: z.number().optional(),
    energyKcal: z.number().optional(), distanceMeters: z.number().optional(), sourceId: z.string(), sourceJson: z.unknown().optional()
  }).strict()),
  healthEvents: z.array(z.object({
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
  }).strict().superRefine((value, context) => {
    if (value.immunization && value.kind !== "immunization") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["immunization"], message: "Immunization details require an immunization event." });
    }
    if (value.medicationAdministration && value.kind !== "medication-administration") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["medicationAdministration"], message: "Medication details require a medication event." });
    }
  })).default([]),
  careItems: z.array(z.object({
    id: z.string(), kind: z.string(), code: z.string().optional(), title: z.string(), dueStart: z.string().optional(),
    reminderAt: z.string().optional(), priority: z.enum(["low", "normal", "high"]),
    status: z.enum(["open", "completed", "cancelled", "skipped"]), scheduleProvenance: z.string().optional(),
    scheduleVersion: z.string().optional(), notes: z.string().optional(),
    completedHealthEventId: z.string().optional(), completedAt: z.string().optional()
  }).strict()).default([]),
  insights: z.array(insightSchema),
  auditEvents: z.array(z.object({
    id: z.string(), createdAt: z.string(),
    eventType: z.enum(["store-created", "profile-updated", "migration-applied", "import-processed", "insight-generated", "export-created", "observation-updated", "observation-deleted", "observation-type-deleted", "daily-step-aggregates-deleted", "health-event-created", "health-event-updated", "health-event-deleted", "care-item-created", "care-item-updated", "care-item-completed", "care-item-cancelled", "care-item-deleted", "personal-reference-range-set", "personal-reference-range-removed", "measurement-pinned", "measurement-unpinned", "profile-photo-replaced", "profile-photo-deleted"]),
    detail: z.string()
  }).strict())
};

export const healthStoreDataSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  ...storeFields
}).strict();

const version4StoreSchema = healthStoreDataSchema.extend({ schemaVersion: z.literal(4) });
const version2StoreSchema = healthStoreDataSchema.extend({ schemaVersion: z.literal(2) });
const version5StoreSchema = healthStoreDataSchema.extend({
  schemaVersion: z.literal(5),
  measurementTypes: z.array(measurementTypeSchema.extend({
    category: z.enum(["activity", "cardio", "sleep", "body", "lab", "metabolic", "derived"])
  })),
  personalReferenceRanges: z.array(version5PersonalReferenceRangeSchema).default([])
});

const retiredMetabolicStoreSchema = healthStoreDataSchema.extend({
  measurementTypes: z.array(measurementTypeSchema.extend({
    category: z.enum(["activity", "cardio", "sleep", "body", "lab", "metabolic", "derived"])
  }))
});

const legacyStoreSchema = z.object({
  schemaVersion: z.literal(1),
  ...storeFields,
  observationGroups: storeFields.observationGroups.optional(),
  labPanels: z.array(z.object({
    id: z.string(), collectedAt: z.string(), panelName: z.string(), sourceId: z.string(), labName: z.string().optional()
  }).strict()).optional(),
  labMarkers: z.array(z.object({
    id: z.string(), panelId: z.string(), measurementCode: z.string(), value: z.number(), unit: z.string()
  }).strict()).optional(),
  sleepSessions: z.array(z.unknown()).optional(),
  sleepStageIntervals: z.array(z.unknown()).optional()
}).strict();

type LegacyStoreData = z.infer<typeof legacyStoreSchema>;

function migrateV1ToV2(data: LegacyStoreData): HealthStoreData {
  const observationGroups = [...(data.observationGroups ?? [])];
  const observations = data.observations.map((observation) => ({ ...observation }));
  for (const panel of data.labPanels ?? []) {
    const groupId = `group_legacy_${panel.id}`;
    if (!observationGroups.some((group) => group.id === groupId)) {
      observationGroups.push({
        id: groupId, kind: "lab_panel", label: panel.panelName, sourceId: panel.sourceId, collectedAt: panel.collectedAt,
        metadata: { labName: panel.labName, legacyPanelId: panel.id }
      });
    }
    for (const marker of (data.labMarkers ?? []).filter((item) => item.panelId === panel.id)) {
      const matching = observations.find((observation) =>
        observation.sourceId === panel.sourceId && observation.measurementCode === marker.measurementCode &&
        observation.observedAt === panel.collectedAt && observation.value === marker.value && observation.unit === marker.unit
      );
      if (matching) {
        if (!matching.observationGroupId) {
          matching.observationGroupId = groupId;
        }
      } else {
        observations.push({
          id: `obs_legacy_${marker.id}`, measurementCode: marker.measurementCode, observedAt: panel.collectedAt,
          value: marker.value, unit: marker.unit, sourceId: panel.sourceId, observationGroupId: groupId,
          note: `Lab marker from ${panel.panelName}`
        });
      }
    }
  }
  const { labPanels: _panels, labMarkers: _markers, sleepSessions: _sleepSessions, sleepStageIntervals: _sleepStages, observationGroups: _groups, schemaVersion: _version, ...rest } = data;
  return healthStoreDataSchema.parse({ ...rest, schemaVersion: CURRENT_SCHEMA_VERSION, observationGroups, observations }) as HealthStoreData;
}

export function parsePersistedHealthStore(data: unknown): { data: HealthStoreData; migrated: boolean } {
  const version = z.object({ schemaVersion: z.number().int() }).passthrough().parse(data).schemaVersion;
  const normalizedData = version < CURRENT_SCHEMA_VERSION ? stripRetiredCareFields(data) : data;
  if (version === CURRENT_SCHEMA_VERSION) {
    const current = healthStoreDataSchema.safeParse(normalizedData);
    if (current.success) {
      return { data: current.data as HealthStoreData, migrated: false };
    }
    const retired = retiredMetabolicStoreSchema.parse(normalizedData);
    const defaultsByCode = new Map(defaultMeasurementTypes.map((type) => [type.code, type]));
    const measurementTypes = retired.measurementTypes.map((type) => {
      if (type.category !== "metabolic") return type;
      const replacement = defaultsByCode.get(type.code);
      if (!replacement) {
        throw new Error(`Retired metabolic measurement type ${type.code} has no current registry definition.`);
      }
      return replacement;
    });
    return {
      data: healthStoreDataSchema.parse({ ...retired, measurementTypes }) as HealthStoreData,
      migrated: true
    };
  }
  if (version === 7) {
    return {
      data: healthStoreDataSchema.parse({
        ...z.record(z.unknown()).parse(normalizedData),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }) as HealthStoreData,
      migrated: true
    };
  }
  if (version === 6) {
    return {
      data: healthStoreDataSchema.parse({
        ...z.record(z.unknown()).parse(normalizedData),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }) as HealthStoreData,
      migrated: true
    };
  }
  if (version === 5) {
    const legacy = version5StoreSchema.parse(normalizedData);
    const defaultsByCode = new Map(defaultMeasurementTypes.map((type) => [type.code, type]));
    return {
      data: healthStoreDataSchema.parse({
        ...legacy,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        measurementTypes: legacy.measurementTypes.map((type) => {
          if (type.category !== "metabolic") return type;
          const replacement = defaultsByCode.get(type.code);
          if (!replacement) {
            throw new Error(`Retired metabolic measurement type ${type.code} has no current registry definition.`);
          }
          return replacement;
        }),
        personalReferenceRanges: legacy.personalReferenceRanges.map((range) => ({
          measurementCode: range.measurementCode,
          ...(range.low === undefined ? {} : { normalLow: range.low }),
          ...(range.high === undefined ? {} : { normalHigh: range.high }),
          unit: range.unit,
          updatedAt: range.updatedAt
        }))
      }),
      migrated: true
    };
  }
  if (version === 2) {
    const legacy = version2StoreSchema.parse(normalizedData);
    return {
      data: healthStoreDataSchema.parse({ ...legacy, schemaVersion: CURRENT_SCHEMA_VERSION }),
      migrated: true
    };
  }
  if (version === 4) {
    const legacy = version4StoreSchema.parse(normalizedData);
    return {
      data: healthStoreDataSchema.parse({ ...legacy, schemaVersion: CURRENT_SCHEMA_VERSION }),
      migrated: true
    };
  }
  if (version === 1) {
    return { data: migrateV1ToV2(legacyStoreSchema.parse(normalizedData)), migrated: true };
  }
  throw new Error(`Unsupported health store schema version ${version}.`);
}

function stripRetiredCareFields(data: unknown): unknown {
  const store = z.record(z.unknown()).parse(data);
  const healthEvents = Array.isArray(store.healthEvents)
    ? store.healthEvents.map((entry) => {
        const { occurredEnd: _occurredEnd, ...event } = z.record(z.unknown()).parse(entry);
        return event;
      })
    : store.healthEvents;
  const careItems = Array.isArray(store.careItems)
    ? store.careItems.map((entry) => {
        const {
          dueEnd: _dueEnd,
          originatingHealthEventId: _originatingHealthEventId,
          ...careItem
        } = z.record(z.unknown()).parse(entry);
        return careItem;
      })
    : store.careItems;
  return { ...store, healthEvents, careItems };
}
