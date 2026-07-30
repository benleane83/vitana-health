/**
 * Shared front-end types extracted from App.tsx.
 */

import type { UploadDraftRow } from "@vitana/shared";

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

/**
 * Editable form of an `UploadDraftRow` for the review table: identical apart from `value`, which is
 * held as raw text while the user is mid-edit and only parsed back to a number on submit.
 */
export type UploadEditableRow = Omit<UploadDraftRow, "value"> & { value: string };
