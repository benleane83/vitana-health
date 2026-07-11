/**
 * Shared front-end types extracted from App.tsx.
 */

export type AppRoute = "dashboard" | "summary" | "import" | "export" | "query";
export type SummarySort = "name" | "count" | "recency";
export type ImportMode = "manual" | "upload" | "scan" | "fitness";
export type ScanKind = "body-composition" | "blood-test";

export interface ManualMarkerRow {
  id: string;
  marker: string;
  value: string;
  unit: string;
}

export interface BodyCompositionEditableRow {
  id: string;
  label: string;
  measurementCode: string;
  displayName: string;
  value: string;
  unit: string;
  observedAt?: string;
  confidence: "high" | "medium" | "low";
  sourceText?: string;
  included: boolean;
  generatedCode?: boolean;
}
