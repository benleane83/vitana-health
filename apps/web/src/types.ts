/**
 * Shared front-end types extracted from App.tsx.
 */

export type AppRoute = "dashboard" | "biological-age" | "summary" | "import" | "export" | "query" | "settings";
export type SummarySort = "name" | "count" | "recency";
export type LabsMode = "manual" | "upload" | "bodycomp";
export type ImportMode = "labs" | "fitness";

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
