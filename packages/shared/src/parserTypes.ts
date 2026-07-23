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
  note?: string;
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

export interface BloodTestDraft {
  fileName: string;
  reportDate?: string;
  sourceText: string;
  checksum: string;
  parserVersion: "blood-test-text-v1";
  diagnostics: string[];
  rows: BodyCompositionDraftRow[];
}

export type BloodTestDraftCommitPayload = BodyCompositionDraftCommitPayload;

// ─── Generic structured (CSV/TSV) upload import ───────────────────────────────
//
// Standards-aware, dependency-free parsing of arbitrary CSV/TSV observation
// exports. One observation is read from each row using measurement name/code,
// value, and optional timestamp/unit columns. Column mapping is suggested
// automatically and may be overridden by the caller
// before a fresh draft is regenerated. PDF/image reports are not supported here;
// see BodyCompositionDraft / BloodTestDraft for the existing scan-based flow.

export type UploadFileFormat = "csv" | "tsv";
export type UploadDraftRowConfidence = "high" | "medium" | "low";

/** Column-to-role assignment for a structured upload. */
export interface UploadColumnMapping {
  dateColumn?: string;
  measurementColumn?: string;
  measurementCodeColumn?: string;
  valueColumn?: string;
  unitColumn?: string;
  labelColumn?: string;
  sourceNameColumn?: string;
  noteColumn?: string;
}

export type UploadColumnMappingOverride = Partial<UploadColumnMapping>;

export interface UploadDraftRow {
  id: string;
  label: string;
  measurementCode: string;
  displayName: string;
  value: number;
  unit: string;
  observedAt?: string;
  confidence: UploadDraftRowConfidence;
  sourceText?: string;
  sourceName?: string;
  note?: string;
  included: boolean;
  generatedCode?: boolean;
  sourceRowIndex?: number;
  sourceColumn?: string;
}

export interface UploadImportDraft {
  fileName: string;
  format: UploadFileFormat;
  checksum: string;
  parserVersion: "structured-upload-v1";
  /** Raw column headers, in file order — used to render mapping controls. */
  columns: string[];
  mapping: UploadColumnMapping;
  mappingSuggestion: UploadColumnMapping;
  /** Total data rows detected in the file (before the row ceiling is applied). */
  rowCount: number;
  diagnostics: string[];
  rows: UploadDraftRow[];
  /** True when `rows` were clipped to the draft row ceiling. */
  truncated: boolean;
}

export interface UploadImportPreviewPayload {
  fileName: string;
  format?: UploadFileFormat;
  content: string;
  mapping?: UploadColumnMappingOverride;
}

export interface UploadImportCommitPayload {
  fileName: string;
  format?: UploadFileFormat;
  checksum?: string;
  rows: UploadDraftRow[];
}
