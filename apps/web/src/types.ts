/**
 * Shared front-end types extracted from App.tsx.
 */

import type { UploadDraftRow } from "@vitana/shared";

export type AppRoute = "dashboard" | "import" | "track" | "care" | "insights" | "export" | "about" | "settings";
export type InsightsTab = "biological-age" | "ai-query" | "ai-review";
export type CareView = "items" | "health-events";
export type TrackView = "measurements" | "body-trend" | "calendar" | "journal";
export type SummarySort = "name" | "count" | "recency";
export type ImportMode = "manual" | "upload" | "sync";
export type SettingsView = "app" | "ai";
export type ProfileDataCategory = "activity" | "body" | "lab" | "sleep";

type ProfileDataCategoryConfig = {
  key: ProfileDataCategory;
  label: string;
  manualGroup?: string;
  uploadKind?: "structured" | "body-composition" | "blood-test";
};

export const profileDataCategories: readonly ProfileDataCategoryConfig[] = [
  { key: "activity", label: "Activities", manualGroup: "Activity", uploadKind: "structured" },
  { key: "body", label: "Body", manualGroup: "Body", uploadKind: "body-composition" },
  { key: "lab", label: "Lab Results", manualGroup: "Lab", uploadKind: "blood-test" },
  { key: "sleep", label: "Sleep" }
];

export function isProfileDataCategory(value: string | null): value is ProfileDataCategory {
  return profileDataCategories.some((category) => category.key === value);
}

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
export type UploadEditableRow = Omit<UploadDraftRow, "value"> & {
  value: string;
  manuallyAdded?: boolean;
};
