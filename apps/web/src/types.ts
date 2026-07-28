/**
 * Shared front-end types extracted from App.tsx.
 */

export type AppRoute = "dashboard" | "import" | "track" | "care" | "insights" | "export" | "settings";
export type InsightsTab = "biological-age" | "ai-query" | "ai-review";
export type CareView = "items" | "health-events";
export type SummarySort = "name" | "count" | "recency";
export type ImportMode = "manual" | "upload" | "sync";
export type SettingsView = "app" | "ai";

export interface ManualMarkerRow {
  id: string;
  marker: string;
  measurementCode?: string;
  value: string;
  unit: string;
}

/** Editable form of an `UploadDraftRow` (see `@vitana/shared`) for the review table. */
export interface UploadEditableRow {
  id: string;
  label: string;
  measurementCode: string;
  displayName: string;
  value: string;
  unit: string;
  observedAt?: string;
  confidence: "high" | "medium" | "low";
  sourceText?: string;
  sourceName?: string;
  note?: string;
  included: boolean;
  generatedCode?: boolean;
  sourceRowIndex?: number;
  sourceColumn?: string;
}
