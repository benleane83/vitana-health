export type MeasurementKind = "point" | "interval" | "event" | "panel-component";

export type SourceKind = "samsung-health" | "manual-entry" | "blood-test-csv" | "derived";

export interface Profile {
  id: "self";
  displayName: string;
  birthYear?: number;
  sex?: "female" | "male" | "intersex" | "unknown" | "not-specified";
  heightCm?: number;
  goalSummary?: string;
  units: "metric" | "imperial";
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
  category: "activity" | "cardio" | "sleep" | "body" | "lab" | "metabolic" | "derived";
  kind: MeasurementKind;
  canonicalUnit: string;
  aliases: string[];
  fhirCode?: string;
  loincCode?: string;
  openMHealthSchema?: string;
  normalLow?: number;
  normalHigh?: number;
  aggregation: "sum" | "average" | "min" | "max" | "latest" | "none";
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
  deviceId?: string;
  note?: string;
  sourceJson?: unknown;
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
}

export interface SleepSession {
  id: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  efficiencyPercent?: number;
  sourceId: string;
}

export interface SleepStageInterval {
  id: string;
  sleepSessionId: string;
  stage: "awake" | "light" | "deep" | "rem" | "unknown";
  startAt: string;
  endAt: string;
}

export interface LabResultPanel {
  id: string;
  collectedAt: string;
  labName?: string;
  panelName: string;
  sourceId: string;
  notes?: string;
}

export interface LabResultMarker {
  id: string;
  panelId: string;
  measurementCode: string;
  displayName: string;
  value: number;
  unit: string;
  referenceLow?: number;
  referenceHigh?: number;
  flag?: "low" | "normal" | "high" | "critical" | "unknown";
}

export interface Insight {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  evidence: string[];
  confidence: "low" | "medium" | "high";
  model: "deterministic" | "local-llm";
  safetyNotice: string;
}

export interface AuditEvent {
  id: string;
  createdAt: string;
  eventType: "store-created" | "profile-updated" | "import-processed" | "insight-generated" | "export-created";
  detail: string;
}

export interface HealthStoreData {
  profile: Profile;
  sourceImports: SourceImport[];
  dataSources: DataSource[];
  devices: Device[];
  measurementTypes: MeasurementType[];
  observations: Observation[];
  timeSeriesSamples: TimeSeriesSample[];
  activitySessions: ActivitySession[];
  sleepSessions: SleepSession[];
  sleepStageIntervals: SleepStageInterval[];
  labPanels: LabResultPanel[];
  labMarkers: LabResultMarker[];
  insights: Insight[];
  auditEvents: AuditEvent[];
}

export interface AnalyticsSummary {
  counts: {
    imports: number;
    observations: number;
    samples: number;
    activities: number;
    labMarkers: number;
    insights: number;
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

