export interface AppBuildLabelInput {
  version?: string | null;
  /**
   * The native build number (`versionCode` on Android). EAS increments this on every `preview` and
   * `production` build, so it is the only identifier that distinguishes two testers running the
   * same marketing version. Bug reports quote the label, so it has to be visible in the app.
   */
  build?: string | null;
  publishedAt?: Date | null;
}

export function formatAppBuildLabel({ version, build, publishedAt }: AppBuildLabelInput): string {
  const versionLabel = version?.trim() || "development";
  const buildLabel = build?.trim();
  const releaseLabel = buildLabel ? `${versionLabel} (${buildLabel})` : versionLabel;
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) {
    return `Version ${releaseLabel} · Local build`;
  }
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(publishedAt);
  return `Version ${releaseLabel} · Published ${dateLabel}`;
}
