/**
 * Formatting utilities extracted from App.tsx.
 */

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return timestampFormatter.format(date);
}

export function formatShortTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

export function formatChartTimestamp(timestamp: number, rangeMs: number): string {
  const options: Intl.DateTimeFormatOptions =
    rangeMs <= 24 * 60 * 60 * 1000
      ? { hour: "2-digit", minute: "2-digit" }
      : rangeMs <= 90 * 24 * 60 * 60 * 1000
        ? { month: "short", day: "numeric" }
        : rangeMs <= 365 * 24 * 60 * 60 * 1000
          ? { month: "short", year: "numeric" }
          : { year: "numeric" };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

export function formatDetailValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, "");
}

export function formatProfileSex(value?: string): string {
  if (!value || value === "not-specified") return "Prefer not to say";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatProfileType(value?: string): string {
  if (!value) return "Adult";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatBloodType(value?: string): string {
  if (!value || value === "unknown") return "Unknown";
  return value
    .replace("-positive", "+")
    .replace("-negative", "-")
    .toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read selected file."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function isSupportedBodyCompMimeType(
  mimeType: string
): mimeType is "application/pdf" | "image/jpeg" | "image/png" {
  return mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png";
}
