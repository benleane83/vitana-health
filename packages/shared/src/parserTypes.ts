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

export type BloodTestDraft = BodyCompositionDraft;
export type BloodTestDraftCommitPayload = BodyCompositionDraftCommitPayload;

// ─── Generic structured (CSV/TSV) upload import ───────────────────────────────
//
// Standards-aware, dependency-free parsing of arbitrary CSV/TSV observation
// exports. Two layouts are supported:
//   - "long":  one row per observation — measurement name/code + value (+ unit) columns.
//   - "wide":  one row per timestamp — one column per known measurement.
// Column mapping is suggested automatically and may be overridden by the caller
// before a fresh draft is regenerated. PDF/image reports are not supported here;
// see BodyCompositionDraft / BloodTestDraft for the existing scan-based flow.

export type UploadFileFormat = "csv" | "tsv";
export type UploadLayout = "long" | "wide";
export type UploadDraftRowConfidence = "high" | "medium" | "low";

export interface UploadMeasurementColumnMapping {
  measurementCode: string;
  unit?: string;
}

/**
 * Column-to-role assignment for a structured upload. `layout` selects which of
 * the long-format or wide-format fields apply. Suggested automatically from
 * column headers and may be partially overridden by the caller.
 */
export interface UploadColumnMapping {
  layout: UploadLayout;
  /** Long: the observation timestamp column. Wide: the shared timestamp column. */
  dateColumn?: string;
  /** Long format only. */
  measurementColumn?: string;
  measurementCodeColumn?: string;
  valueColumn?: string;
  unitColumn?: string;
  labelColumn?: string;
  sourceNameColumn?: string;
  noteColumn?: string;
  /** Wide format only: column name → resolved measurement. Unlisted columns are ignored. */
  measurementColumns?: Record<string, UploadMeasurementColumnMapping>;
  /** Wide format only: columns that were not recognized as a known measurement. */
  ignoredColumns?: string[];
}

export type UploadColumnMappingOverride = Partial<Omit<UploadColumnMapping, "layout">> & { layout?: UploadLayout };

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
  included: boolean;
  generatedCode?: boolean;
  sourceRowIndex?: number;
  sourceColumn?: string;
}

export interface UploadImportDraft {
  fileName: string;
  format: UploadFileFormat;
  layout: UploadLayout;
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
  layout?: UploadLayout;
  rows: UploadDraftRow[];
}
