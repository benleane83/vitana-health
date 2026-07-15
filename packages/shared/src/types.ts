export type MeasurementKind = "point" | "interval" | "event" | "panel-component";

export type BloodType = "a-positive" | "a-negative" | "b-positive" | "b-negative" | "ab-positive" | "ab-negative" | "o-positive" | "o-negative" | "unknown";

export type SourceKind =
  | "health-connect"
  | "manual-entry"
  | "blood-test-csv"
  | "observation-csv"
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

export type HealthEventKind = "immunization" | "medication-administration" | "other";
export type HealthEventStatus = "completed" | "entered-in-error";
export interface HealthEventBase {
  id: string;
  kind: HealthEventKind;
  status: HealthEventStatus;
  occurredAt: string;
  occurredEnd?: string;
  source: SourceKind;
  provider?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}
export interface ImmunizationEvent extends HealthEventBase {
  kind: "immunization";
  immunization: {
    vaccine: string; targetDisease?: string; doseNumber?: number; series?: string;
    manufacturer?: string; lotNumber?: string; expiresAt?: string; route?: string; site?: string; reaction?: string;
  };
}
export interface MedicationAdministrationEvent extends HealthEventBase {
  kind: "medication-administration";
  medicationAdministration: { medication: string; activeIngredient?: string; dose: number; unit: string; route?: string };
}
export interface OtherHealthEvent extends HealthEventBase { kind: "other"; }
export type HealthEvent = ImmunizationEvent | MedicationAdministrationEvent | OtherHealthEvent;

export type CareItemStatus = "open" | "completed" | "cancelled" | "skipped";
export interface CareItem {
  id: string;
  kind: string;
  code?: string;
  title: string;
  dueStart?: string;
  dueEnd?: string;
  reminderAt?: string;
  priority: "low" | "normal" | "high";
  status: CareItemStatus;
  scheduleProvenance?: string;
  scheduleVersion?: string;
  notes?: string;
  originatingHealthEventId?: string;
  completedHealthEventId?: string;
  completedAt?: string;
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

export interface UpdateObservationInput {
  measurementCode: string;
  observedAt: string;
  value: number;
  unit: string;
  note?: string;
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
    | "health-event-created"
    | "health-event-updated"
    | "health-event-deleted"
    | "care-item-created"
    | "care-item-updated"
    | "care-item-completed"
    | "care-item-cancelled"
    | "care-item-deleted";
  detail: string;
}

export interface HealthStoreData {
  schemaVersion: 2 | 3 | 4;
  profile: Profile;
  sourceImports: SourceImport[];
  dataSources: DataSource[];
  devices: Device[];
  measurementTypes: MeasurementType[];
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
  latestMetrics: Array<{
    code: string;
    label: string;
    value: number;
    unit: string;
    observedAt: string;
    status: "low" | "normal" | "high" | "unknown";
  }>;
  trendCards: Array<{
    code: string;
    label: string;
    unit: string;
    points: Array<{ date: string; value: number }>;
    direction: "up" | "down" | "flat" | "unknown";
    summary: string;
  }>;
  labAlerts: Array<{
    marker: string;
    value: number;
    unit: string;
    reference?: string;
    flag: "low" | "high" | "critical" | "unknown";
  }>;
  evidenceDigest: string[];
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
  category: MeasurementType["category"] | "uncategorized";
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

export interface HealthDataDetail {
  generatedAt: string;
  measurement: HealthDataSummaryTypeRow;
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
  latestMeasurements: Array<{
    displayName: string;
    value: number;
    unit: string;
    measuredAt: string;
  }>;
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
