/**
 * Shared front-end types extracted from App.tsx.
 */

import { profileDataCategories, type ProfileDataCategory, type UploadDraftRow } from "@vitana/shared";

export { profileDataCategories };
export type { ProfileDataCategory };

export type AppRoute = "dashboard" | "import" | "track" | "care" | "insights" | "export" | "about" | "settings";
export type InsightsTab = "biological-age" | "ai-query" | "ai-review";
export type CareView = "items" | "health-events" | "medications";
export type TrackView = "measurements" | "body-trend" | "calendar" | "journal";
export type SummarySort = "name" | "count" | "recency";
export type ImportMode = "manual" | "upload" | "sync";
export type SettingsView = "app" | "ai";
export const profileDataCategoryIconPaths: Record<ProfileDataCategory, string> = {
  activity: "/images/profile-navigation/activity.png",
  body: "/images/profile-navigation/body-composition.png",
  lab: "/images/profile-navigation/lab-results.png",
  sleep: "/images/profile-navigation/sleep.png"
};

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
