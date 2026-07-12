import { z } from "zod";
import type { HealthStoreData } from "./types.js";

export const CURRENT_SCHEMA_VERSION = 2 as const;

const sourceKind = z.enum([
  "health-connect", "manual-entry", "blood-test-csv", "observation-csv",
  "blood-test-report", "body-composition-report", "derived"
]);
const stringRecord = z.record(z.unknown());

const profileSchema = z.object({
  id: z.string(), displayName: z.string(), birthYear: z.number().optional(),
  sex: z.enum(["female", "male", "intersex", "unknown", "not-specified"]).optional(),
  bloodType: z.string().optional(),
  heightCm: z.number().optional(), goalSummary: z.string().optional(),
  cloudAiConsent: z.object({
    enabled: z.boolean(), providerScopeAccepted: z.boolean(), consentedAt: z.string().optional(), consentVersion: z.string().optional()
  }).optional(),
  units: z.enum(["metric", "imperial"]), updatedAt: z.string()
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
  measurementTypes: z.array(z.object({
    code: z.string(), display: z.string(),
    category: z.enum(["activity", "cardio", "sleep", "body", "lab", "metabolic", "derived"]),
    kind: z.enum(["point", "interval", "event", "panel-component"]), canonicalUnit: z.string(), aliases: z.array(z.string()),
    fhirCode: z.string().optional(), loincCode: z.string().optional(), openMHealthSchema: z.string().optional(),
    normalLow: z.number().optional(), normalHigh: z.number().optional(),
    referenceRanges: z.array(z.object({ low: z.number().optional(), high: z.number().optional(), unit: z.string(), label: z.string().optional(), source: z.string().optional() }).strict()).optional(),
    aggregation: z.enum(["sum", "average", "min", "max", "latest", "none"])
  }).strict()),
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
  insights: z.array(z.object({
    id: z.string(), createdAt: z.string(), title: z.string(), body: z.string(), evidence: z.array(z.string()),
    confidence: z.enum(["low", "medium", "high"]), model: z.string(), safetyNotice: z.string()
  }).strict()),
  auditEvents: z.array(z.object({
    id: z.string(), createdAt: z.string(),
    eventType: z.enum(["store-created", "profile-updated", "migration-applied", "import-processed", "insight-generated", "export-created", "observation-deleted", "observation-type-deleted"]),
    detail: z.string()
  }).strict())
};

export const healthStoreDataSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  ...storeFields
}).strict();

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
  if (version === CURRENT_SCHEMA_VERSION) {
    return { data: healthStoreDataSchema.parse(data) as HealthStoreData, migrated: false };
  }
  if (version === 1) {
    return { data: migrateV1ToV2(legacyStoreSchema.parse(data)), migrated: true };
  }
  throw new Error(`Unsupported health store schema version ${version}.`);
}
