export function sanitizeFilenameSegment(value: string, fallback = "profile"): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return normalized || fallback;
}

export function reportFilename(displayName: string): string {
  return `${sanitizeFilenameSegment(displayName, "health")}-health-report.pdf`;
}

export function healthDataFilename(displayName: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `${sanitizeFilenameSegment(displayName)}-health-data-${day}.xlsx`;
}
