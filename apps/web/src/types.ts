/**
 * Shared front-end types extracted from App.tsx.
 */

export type AppRoute = "dashboard" | "biological-age" | "summary" | "import" | "export" | "query" | "settings";
export type SummarySort = "name" | "count" | "recency";
export type ImportMode = "manual" | "upload" | "scan" | "fitness";
export type ScanKind = "body-composition" | "blood-test";

export interface ManualMarkerRow {
  id: string;
  marker: string;
  measurementCode?: string;
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
