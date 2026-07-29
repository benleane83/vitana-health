export type MeasurementKind = "point" | "interval" | "event" | "panel-component";

export type BloodType = "a-positive" | "a-negative" | "b-positive" | "b-negative" | "ab-positive" | "ab-negative" | "o-positive" | "o-negative" | "unknown";

export type SourceKind =
  | "health-connect"
  | "manual-entry"
  | "blood-test-csv"
  | "observation-csv"
  | "structured-upload"
  | "blood-test-report"
  | "body-composition-report"
  | "derived";

export type UnitSystem = "metric" | "imperial";
export type SubjectKind = "adult" | "child" | "pet";

export interface Profile {
  id: string;
  displayName: string;
  subjectKind?: SubjectKind;
  birthDate?: string;
  sex?: "female" | "male" | "intersex" | "unknown" | "not-specified";
  heightCm?: number;
  bloodType?: BloodType;
  goalSummary?: string;
  cloudAiConsent?: CloudAiConsent;
  pet?: {
    species: string;
    breed?: string;
    reproductiveStatus?: "intact" | "neutered" | "spayed" | "unknown";
    microchipId?: string;
  };
  units: UnitSystem;
  updatedAt: string;
}

export const healthEventKindCodes = [
  "visit",
  "condition",
  "symptom",
  "injury",
  "test",
  "procedure",
  "treatment",
  "medication-administration",
  "immunization",
  "allergy-reaction",
  "dental",
  "other"
] as const;
export type HealthEventKind = typeof healthEventKindCodes[number];
export const healthEventKindLabels: Record<HealthEventKind, string> = {
  visit: "Visit or consultation",
  condition: "Illness or diagnosis",
  symptom: "Symptom or concern",
  injury: "Injury or accident",
  test: "Test or screening",
  procedure: "Procedure or surgery",
  treatment: "Treatment or therapy",
  "medication-administration": "Medication",
  immunization: "Immunization",
  "allergy-reaction": "Allergy or reaction",
  dental: "Dental or oral care",
  other: "Other health event"
};
export const generalHealthEventKindCodes = [
  "visit",
  "condition",
  "symptom",
  "injury",
  "test",
  "procedure",
  "treatment",
  "allergy-reaction",
  "dental",
  "other"
] as const satisfies readonly HealthEventKind[];
export type GeneralHealthEventKind = typeof generalHealthEventKindCodes[number];
export type HealthEventStatus = "completed" | "entered-in-error";
export interface ImmunizationDetails {
  vaccine: string;
  targetDisease?: string;
  doseNumber?: number;
  series?: string;
  manufacturer?: string;
  lotNumber?: string;
  expiresAt?: string;
  route?: string;
  site?: string;
  reaction?: string;
}
export interface MedicationAdministrationDetails {
  medication: string;
  activeIngredient?: string;
  dose: number;
  unit: string;
  route?: string;
}
export interface HealthEventBase {
  id: string;
  kind: HealthEventKind;
  status: HealthEventStatus;
  occurredAt: string;
  source: SourceKind;
  provider?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}
export interface ImmunizationEvent extends HealthEventBase {
  kind: "immunization";
  immunization?: ImmunizationDetails;
}
export interface MedicationAdministrationEvent extends HealthEventBase {
  kind: "medication-administration";
  medicationAdministration?: MedicationAdministrationDetails;
}
export interface GeneralHealthEvent extends HealthEventBase { kind: GeneralHealthEventKind; }
export type OtherHealthEvent = GeneralHealthEvent & { kind: "other" };
export type HealthEvent = ImmunizationEvent | MedicationAdministrationEvent | GeneralHealthEvent;

export type CareItemStatus = "open" | "completed" | "cancelled" | "skipped";
export type CareItemPriority = "low" | "normal" | "high";
export const careItemKindCodes = [
  "routine-checkup",
  "follow-up",
  "immunization",
  "medication",
  "test-screening",
  "procedure",
  "treatment-therapy",
  "monitoring",
  "dental",
  "other"
] as const;
export type CareItemKind = typeof careItemKindCodes[number];
export const careItemKindLabels: Record<CareItemKind, string> = {
  "routine-checkup": "Routine check-up",
  "follow-up": "Follow-up or recheck",
  immunization: "Immunization or booster",
  medication: "Medication or refill",
  "test-screening": "Test or screening",
  procedure: "Procedure or surgery",
  "treatment-therapy": "Treatment or therapy",
  monitoring: "Monitoring or measurement",
  dental: "Dental or oral care",
  other: "Other care item"
};
export const careItemReminderLeadCodes = ["one-day", "one-week"] as const;
export type CareItemReminderLead = typeof careItemReminderLeadCodes[number];
export const careItemReminderLeadLabels: Record<CareItemReminderLead, string> = {
  "one-day": "1 day before",
  "one-week": "1 week before"
};

export function isHealthEventKind(value: string): value is HealthEventKind {
  return (healthEventKindCodes as readonly string[]).includes(value);
}

export function isCareItemKind(value: string): value is CareItemKind {
  return (careItemKindCodes as readonly string[]).includes(value);
}

export function normalizedCareItemKind(value: string): CareItemKind {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-").replace(/\s+/g, "-");
  if (isCareItemKind(normalized)) return normalized;
  if (normalized === "appointment" || normalized === "check-up" || normalized === "checkup") return "routine-checkup";
  if (normalized === "followup") return "follow-up";
  return "other";
}

export function careItemReminderAt(dueStart: string | undefined, lead: CareItemReminderLead): string | undefined {
  if (!dueStart) return undefined;
  const reminder = new Date(dueStart);
  if (!Number.isFinite(reminder.getTime())) return undefined;
  reminder.setDate(reminder.getDate() - (lead === "one-day" ? 1 : 7));
  return reminder.toISOString();
}

export function careItemReminderLead(
  dueStart: string | undefined,
  reminderAt: string | undefined
): CareItemReminderLead | undefined {
  if (!dueStart || !reminderAt) return undefined;
  const expectedTime = new Date(reminderAt).getTime();
  if (!Number.isFinite(expectedTime)) return undefined;
  return careItemReminderLeadCodes.find((lead) => {
    const candidate = careItemReminderAt(dueStart, lead);
    return candidate ? new Date(candidate).getTime() === expectedTime : false;
  });
}

export const defaultHealthEventKindForCareItem: Record<CareItemKind, HealthEventKind> = {
  "routine-checkup": "visit",
  "follow-up": "visit",
  immunization: "immunization",
  medication: "medication-administration",
  "test-screening": "test",
  procedure: "procedure",
  "treatment-therapy": "treatment",
  monitoring: "other",
  dental: "dental",
  other: "other"
};
export interface HealthEventReference {
  id: string;
  kind: HealthEventKind;
  occurredAt: string;
  provider?: string;
}
export interface CareItem {
  id: string;
  kind: CareItemKind;
  code?: string;
  title: string;
  dueStart?: string;
  reminderAt?: string;
  priority: CareItemPriority;
  status: CareItemStatus;
  scheduleProvenance?: string;
  scheduleVersion?: string;
  notes?: string;
  completedHealthEventId?: string;
  completedAt?: string;
  completedHealthEvent?: HealthEventReference;
}
export interface CarePagination {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface PaginatedResult<T> extends CarePagination {
  items: T[];
}

/**
 * Query and mutation input shapes live with their zod schemas in `apiContract.ts` and are derived
 * from them with `z.infer`, so the validator and the type cannot drift apart.
 */

export interface HealthEventMutationResponse {
  healthEvent: HealthEvent;
  counts: AppBootstrap["counts"];
}

export interface CareItemMutationResponse {
  careItem: CareItem;
  counts: AppBootstrap["counts"];
}

export interface CompleteCareItemResponse {
  careItem: CareItem;
  healthEvent: HealthEvent;
  counts: AppBootstrap["counts"];
}

export interface DeleteHealthEventResponse {
  deletedCount: number;
  deletedHealthEvent?: HealthEvent;
  counts: AppBootstrap["counts"];
}

export interface DeleteCareItemResponse {
  deletedCount: number;
  deletedCareItem?: CareItem;
  counts: AppBootstrap["counts"];
}

export type CareLinkedHealthEventRole = "completion";

export interface LinkedCareItemConflict {
  id: string;
  title: string;
  role: CareLinkedHealthEventRole;
}

export interface CloudAiConsent {
  enabled: boolean;
  providerScopeAccepted: boolean;
  consentedAt?: string;
  consentVersion?: string;
}

export interface ProfileListEntry {
  id: string;
  displayName: string;
  updatedAt: string;
  profilePhoto?: ProfilePhotoMetadata;
}

export interface ProfilePhotoMetadata {
  revision: string;
  updatedAt: string;
}

export interface ProfilePhotoResponse extends ProfilePhotoMetadata {
  contentType: "image/jpeg";
  contentBase64: string;
}

export interface SourceImport {
  id: string;
  sourceKind: SourceKind;
  fileName: string;
  importedAt: string;
  parserVersion: string;
  checksum: string;
  rowCount: number;
  status: "processed" | "needs-review" | "failed";
  diagnostics: string[];
  rawContent?: string;
}

export interface DataSource {
  id: string;
  sourceKind: SourceKind;
  label: string;
  importId?: string;
  createdAt: string;
}

export interface Device {
  id: string;
  label: string;
  manufacturer?: string;
  model?: string;
  sourceId?: string;
}

export interface MeasurementType {
  code: string;
  display: string;
  description: string;
  category: "activity" | "cardio" | "sleep" | "body" | "lab" | "derived";
  kind: MeasurementKind;
  canonicalUnit: string;
  preferredUnits?: Partial<Record<UnitSystem, string>>;
  unitAliases?: Record<string, string[]>;
  aliases: string[];
  fhirCode?: string;
  loincCode?: string;
  openMHealthSchema?: string;
  normalLow?: number;
  normalHigh?: number;
  referenceRanges?: ReferenceRange[];
  aggregation: "sum" | "average" | "min" | "max" | "latest" | "none";
}

export interface ReferenceRange {
  low?: number;
  high?: number;
  unit: string;
  label?: string;
  source?: string;
}

export interface PersonalReferenceRange {
  measurementCode: string;
  normalLow?: number;
  normalHigh?: number;
  optimalLow?: number;
  optimalHigh?: number;
  unit: string;
  updatedAt: string;
}

export type ReferenceRangeSource = "personal" | "catalog" | "none";

export interface ReferenceRangeState {
  personal?: ReferenceRange;
  catalog?: ReferenceRange;
  effective?: ReferenceRange;
  source: ReferenceRangeSource;
}

export type ObservationGroupKind =
  | "lab_panel"
  | "body_composition_report"
  | "activity_session"
  | "sleep_session"
  | "import_batch"
  | "custom";

export interface ObservationGroup {
  id: string;
  kind: ObservationGroupKind;
  label: string;
  sourceId?: string;
  importId?: string;
  startAt?: string;
  endAt?: string;
  collectedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface Observation {
  id: string;
  measurementCode: string;
  observedAt: string;
  effectiveStart?: string;
  effectiveEnd?: string;
  value: number;
  unit: string;
  sourceId: string;
  observationGroupId?: string;
  deviceId?: string;
  note?: string;
  sourceJson?: unknown;
}

export interface UpdateObservationResponse {
  updatedObservation: Observation;
  counts: AppBootstrap["counts"];
}

export interface TimeSeriesSample {
  id: string;
  measurementCode: string;
  startAt: string;
  endAt: string;
  value: number;
  unit: string;
  sourceId: string;
  deviceId?: string;
  sourceJson?: unknown;
}

export interface ActivitySession {
  id: string;
  activityType: string;
  startAt: string;
  endAt?: string;
  durationMinutes?: number;
  energyKcal?: number;
  distanceMeters?: number;
  sourceId: string;
  sourceJson?: unknown;
}

export type InsightModel = "deterministic" | "local-llm" | `${"ollama" | "openai"}:${string}`;

export interface Insight {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  evidence: string[];
  confidence: "low" | "medium" | "high";
  model: InsightModel;
  safetyNotice: string;
}

export interface AuditEvent {
  id: string;
  createdAt: string;
  eventType:
    | "store-created"
    | "profile-updated"
    | "migration-applied"
    | "import-processed"
    | "insight-generated"
    | "export-created"
    | "observation-updated"
    | "observation-deleted"
    | "observation-type-deleted"
    | "daily-step-aggregates-deleted"
    | "health-event-created"
    | "health-event-updated"
    | "health-event-deleted"
    | "care-item-created"
    | "care-item-updated"
    | "care-item-completed"
    | "care-item-cancelled"
    | "care-item-deleted"
    | "personal-reference-range-set"
    | "personal-reference-range-removed"
    | "measurement-pinned"
    | "measurement-unpinned"
    | "profile-photo-replaced"
    | "profile-photo-deleted";
  detail: string;
}

export interface PinnedMeasurement {
  measurementCode: string;
  pinnedAt: string;
}

export interface MeasurementPinState {
  measurementCode: string;
  isPinned: boolean;
  pinnedAt?: string;
}

export interface HealthStoreData {
  /**
   * Always the current version. Older persisted stores are upgraded by `parsePersistedHealthStore`
   * before they ever become a `HealthStoreData`.
   */
  schemaVersion: 8;
  profile: Profile;
  sourceImports: SourceImport[];
  dataSources: DataSource[];
  devices: Device[];
  measurementTypes: MeasurementType[];
  personalReferenceRanges: PersonalReferenceRange[];
  pinnedMeasurements: PinnedMeasurement[];
  observations: Observation[];
  observationGroups: ObservationGroup[];
  timeSeriesSamples: TimeSeriesSample[];
  activitySessions: ActivitySession[];
  healthEvents?: HealthEvent[];
  careItems?: CareItem[];
  insights: Insight[];
  auditEvents: AuditEvent[];
}

export interface ManualObservationGroupTemplate {
  label: string;
  normalizedLabel: string;
  measurements: Array<{
    measurementCode: string;
    marker: string;
    unit: string;
  }>;
}

export interface AppBootstrap {
  profile: Profile;
  profilePhoto?: ProfilePhotoMetadata;
  measurementTypes: MeasurementType[];
  manualObservationGroupTemplates: ManualObservationGroupTemplate[];
  latestInsight?: Insight;
  counts: {
    imports: number;
    observations: number;
    samples: number;
    activities: number;
    healthEvents: number;
    careItems: number;
  };
}

export interface AnalyticsSummary {
  counts: {
    imports: number;
    observations: number;
    samples: number;
    activities: number;
    insights: number;
    healthEvents: number;
    careItems: number;
  };
  latestMetrics: LatestMetric[];
  latestMetricsForInsight?: LatestMetric[];
  trendCards: Array<{
    code: string;
    label: string;
    unit: string;
    points: Array<{ date: string; value: number }>;
    direction: "up" | "down" | "flat" | "unknown";
    summary: string;
  }>;
  labAlerts: Array<{
    code: string;
    marker: string;
    value: number;
    unit: string;
    observedAt: string;
    reference?: string;
    flag: "low" | "high" | "critical" | "unknown";
  }>;
  evidenceDigest: string[];
}

export interface LatestMetric {
    code: string;
    label: string;
    value: number;
    unit: string;
    observedAt: string;
    status: "low" | "normal" | "high" | "unknown";
    isPinned: boolean;
}

export type BiologicalAgeModelStatus = "available" | "incomplete" | "not-implemented";

export interface BiologicalAgeInput {
  code: string;
  label: string;
  value?: number;
  unit?: string;
  normalizedValue?: number;
  normalizedUnit: string;
  observedAt?: string;
  status: "used" | "missing" | "invalid";
  detail?: string;
}

export interface BiologicalAgeModelResult {
  id: "phenoage-levine-2018";
  name: string;
  version: string;
  status: BiologicalAgeModelStatus;
  methodology: string;
  citation: string;
  chronologicalAge?: number;
  chronologicalAgeDetail?: string;
  biologicalAge?: number;
  ageAcceleration?: number;
  calculatedAt?: string;
  panelCollectedAt?: string;
  inputs: BiologicalAgeInput[];
  limitations: string[];
}

export interface BiologicalAgeReport {
  generatedAt: string;
  disclaimer: string;
  models: BiologicalAgeModelResult[];
}

export interface HealthDataSummarySourceCounts {
  observations: number;
  samples: number;
  activities: number;
}

export interface HealthDataSummaryTypeRow {
  code: string;
  displayName: string;
  description?: string;
  category: MeasurementType["category"] | "uncategorized";
  aggregation?: MeasurementType["aggregation"];
  counts: HealthDataSummarySourceCounts & {
    total: number;
  };
  lastMeasuredAt?: string;
}

export interface HealthDataSummaryCategoryGroup {
  key: HealthDataSummaryTypeRow["category"];
  label: string;
  counts: HealthDataSummarySourceCounts & {
    total: number;
    types: number;
  };
  rows: HealthDataSummaryTypeRow[];
}

export interface HealthDataSummary {
  generatedAt: string;
  totals: HealthDataSummarySourceCounts & {
    total: number;
    types: number;
  };
  categories: HealthDataSummaryCategoryGroup[];
}

export type HealthDataDetailEntryKind = "observation" | "sample" | "activity";

export interface HealthDataDetailEntry {
  kind: HealthDataDetailEntryKind;
  id: string;
  measurementCode: string;
  displayName: string;
  timestamp: string;
  value: number;
  unit: string;
  sourceLabel?: string;
  sourceKind?: SourceKind;
  importFileName?: string;
  importedAt?: string;
  note?: string;
  observationGroup?: Pick<ObservationGroup, "id" | "kind" | "label" | "collectedAt">;
  referenceRange?: ReferenceRange;
  status?: "low" | "normal" | "high" | "unknown";
  canDelete?: boolean;
  deleteLabel?: string;
}

export interface HealthDataDetailChartPoint {
  kind: HealthDataDetailEntryKind;
  timestamp: string;
  value: number;
  unit: string;
  referenceRange?: ReferenceRange;
}

export type HealthDataChartRange = "all" | "1y" | "3m" | "1m";
export type HealthDataChartMode = "auto" | "raw";
export type HealthDataChartGranularity = "raw" | "daily" | "weekly";

export interface HealthDataChartSeriesOptions {
  range: HealthDataChartRange;
  mode: HealthDataChartMode;
}

export interface HealthDataChartSeriesPoint {
  timestamp: string;
  value: number;
  unit: string;
  count: number;
  minValue?: number;
  maxValue?: number;
  referenceRange?: ReferenceRange;
}

export interface HealthDataChartSeries {
  generatedAt: string;
  measurementCode: string;
  range: HealthDataChartRange;
  requestedMode: HealthDataChartMode;
  granularity: HealthDataChartGranularity;
  aggregation: MeasurementType["aggregation"];
  points: HealthDataChartSeriesPoint[];
  totalPoints: number;
  truncated: boolean;
}

export interface HealthDataDetail {
  generatedAt: string;
  measurement: HealthDataSummaryTypeRow;
  isPinned: boolean;
  referenceRange: ReferenceRangeState;
  entries: HealthDataDetailEntry[];
  chartPoints: HealthDataDetailChartPoint[];
  counts: HealthDataSummarySourceCounts & {
    total: number;
  };
  deletion: {
    observationEntries: number;
    deletableEntries: number;
  };
  pagination: {
    limit: number;
    loaded: number;
    total: number;
    hasMore: boolean;
  };
}

export interface ClinicianReport {
  generatedAt: string;
  disclaimer: string;
  patient: Pick<Profile, "displayName" | "subjectKind" | "birthDate" | "sex" | "heightCm" | "units"> & {
    height?: { value: number; unit: string };
  };
  totals: {
    observations: number;
    samples: number;
    activities: number;
  };
  latestMeasurements: ClinicianReportLatestMeasurement[];
  flaggedLabs: Array<{
    displayName: string;
    value: number;
    unit: string;
    flag: "low" | "high" | "critical" | "unknown";
    collectedAt: string;
    referenceRange?: string;
  }>;
  trends: Array<{
    displayName: string;
    unit: string;
    direction: "up" | "down" | "flat" | "unknown";
    summary: string;
  }>;
  sources: Array<{
    fileName: string;
    sourceKind: SourceKind;
    importedAt: string;
    status: SourceImport["status"];
    rowCount: number;
  }>;
}

export interface ClinicianReportLatestMeasurement {
  category: MeasurementType["category"] | "uncategorized";
  displayName: string;
  measuredAt: string;
  value?: number;
  unit?: string;
  activity?: {
    activityType: string;
    durationMinutes?: number;
  };
}

export interface DeleteObservationResponse {
  deletedCount: number;
  deletedObservation?: Observation;
  counts: AppBootstrap["counts"];
}

export interface DeleteObservationsByTypeResponse {
  deletedCount: number;
  measurementCode: string;
  counts: AppBootstrap["counts"];
}
