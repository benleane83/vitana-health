export type ProfileDataCategory = "activity" | "body" | "lab" | "sleep";

export type ProfileDataCategoryConfig = {
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
