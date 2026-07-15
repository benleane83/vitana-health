import type {
  ActivitySession,
  DataSource,
  Observation,
  ObservationGroup,
  SourceImport,
  TimeSeriesSample
} from "./types.js";

export interface ParsedImport {
  sourceImport: SourceImport;
  dataSource: DataSource;
  observations: Observation[];
  observationGroups: ObservationGroup[];
  timeSeriesSamples: TimeSeriesSample[];
  activitySessions: ActivitySession[];
}

export interface ManualLabEntryMarkerInput {
  markerName?: string;
  markerCode?: string;
  value: number;
  unit?: string;
}

export interface ManualLabEntryPayload {
  collectedAt: string;
  panelName: string;
  labName?: string;
  markers: ManualLabEntryMarkerInput[];
}

export interface ManualObservationInput {
  measurementName?: string;
  measurementCode?: string;
  value: number;
  unit?: string;
}

export interface ManualObservationPayload {
  observedAt: string;
  label: string;
  sourceName?: string;
  observations: ManualObservationInput[];
}

export type BodyCompositionDraftConfidence = "high" | "medium" | "low";

export interface BodyCompositionDraftRow {
  id: string;
  label: string;
  measurementCode: string;
  displayName: string;
  value: number;
  unit: string;
  observedAt?: string;
  confidence: BodyCompositionDraftConfidence;
  sourceText?: string;
  included: boolean;
  generatedCode?: boolean;
}

export interface BodyCompositionDraft {
  fileName: string;
  reportDate?: string;
  sourceText: string;
  checksum: string;
  parserVersion: "body-composition-text-v1";
  diagnostics: string[];
  rows: BodyCompositionDraftRow[];
}

export interface BodyCompositionDraftCommitPayload {
  fileName: string;
  reportDate?: string;
  sourceText?: string;
  sourceChecksum?: string;
  rows: BodyCompositionDraftRow[];
}

export type BloodTestDraft = BodyCompositionDraft;
export type BloodTestDraftCommitPayload = BodyCompositionDraftCommitPayload;
