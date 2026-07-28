export interface AppBuildLabelInput {
  version?: string | null;
  publishedAt?: Date | null;
}

export function formatAppBuildLabel({ version, publishedAt }: AppBuildLabelInput): string {
  const versionLabel = version?.trim() || "development";
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) {
    return `Version ${versionLabel} · Local build`;
  }
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(publishedAt);
  return `Version ${versionLabel} · Published ${dateLabel}`;
}
