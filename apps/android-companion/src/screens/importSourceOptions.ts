import type { HealthSourceProvider } from "@vitana/shared";

export type ImportSource = "sync" | "scan" | "manual";

export interface ImportSourceOption {
  source: ImportSource;
  title: string;
  detail: string;
}

export function buildImportSourceOptions(
  healthSourceProvider: Pick<HealthSourceProvider, "label"> | undefined,
  platform: string
): ImportSourceOption[] {
  return [
    ...(healthSourceProvider ? [{
      source: "sync" as const,
      title: "Sync",
      detail: platform === "android"
        ? "Bring in recent health data from this Android device."
        : "Bring in recent health data from your phone."
    }] : []),
    {
      source: "scan",
      title: "Scan a report",
      detail: "Photograph a lab test or body composition report for review."
    },
    {
      source: "manual",
      title: "Enter manually",
      detail: "Add a single reading or a reusable group of measurements."
    }
  ];
}