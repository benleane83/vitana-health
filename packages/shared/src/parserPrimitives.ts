import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export function checksum(content: string): string {
  return `sha256-${bytesToHex(sha256(utf8ToBytes(content)))}`;
}

export function parseCsv(content: string): Array<Record<string, string>> {
  return parseDelimitedWithHeaders(content, ",").rows;
}

/**
 * Delimiter-aware structured text parser shared by CSV (",") and TSV ("\t") uploads.
 * Returns both the raw header order (needed for column-mapping suggestions) and the
 * row records keyed by header text.
 */
export function parseDelimitedWithHeaders(
  content: string,
  delimiter: string
): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = splitDelimitedLine(lines[0], delimiter).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });
  return { headers, rows };
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

export function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${checksum(parts.join("|")).replace(/^sha256-/, "")}`;
}

export function normalizeKeys(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeFieldKey(key), value])
  );
}

/**
 * Normalizes a single column/field name to snake_case for role matching
 * (e.g. "Observed At" / "observedAt" → "observed_at"). Shared by the CSV
 * observation parsers and the generic long/wide upload column mapper.
 */
export function normalizeFieldKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function readNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/,/g, "").replace(/(\d)[ ]+([.,])[ ]+(\d)/g, "$1$2$3").replace(/([.,])[ ]+(\d)/g, "$1$2");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const structured = parseStructuredDate(trimmed);
  if (structured) {
    const parsed = new Date(Date.UTC(structured.year, structured.month - 1, structured.day, structured.hour, structured.minute, structured.second));
    return parsed.toISOString();
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

interface StructuredDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const monthNameToIndex: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

function parseStructuredDate(value: string): StructuredDate | undefined {
  const dateTimeMatch = value.match(/^(.*?)(?:\s+(\d{1,2})(?::(\d{2}))(?::(\d{2}))?)?$/);
  if (!dateTimeMatch) return undefined;
  const datePart = dateTimeMatch[1]?.trim();
  if (!datePart) return undefined;

  const hour = Number.parseInt(dateTimeMatch[2] ?? "0", 10);
  const minute = Number.parseInt(dateTimeMatch[3] ?? "0", 10);
  const second = Number.parseInt(dateTimeMatch[4] ?? "0", 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return undefined;

  const ymd = datePart.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) return normalizeStructuredDate(Number.parseInt(ymd[1], 10), Number.parseInt(ymd[2], 10), Number.parseInt(ymd[3], 10), hour, minute, second);

  const dayMonthNameYear = datePart.match(/^(\d{1,2})[\/\-.]([A-Za-z]{3,9})[\/\-.](\d{2,4})$/);
  if (dayMonthNameYear) {
    const month = monthNameToIndex[dayMonthNameYear[2].toLowerCase()];
    return month ? normalizeStructuredDate(Number.parseInt(dayMonthNameYear[3], 10), month, Number.parseInt(dayMonthNameYear[1], 10), hour, minute, second) : undefined;
  }

  const monthNameDayYear = datePart.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (monthNameDayYear) {
    const month = monthNameToIndex[monthNameDayYear[1].toLowerCase()];
    return month ? normalizeStructuredDate(Number.parseInt(monthNameDayYear[3], 10), month, Number.parseInt(monthNameDayYear[2], 10), hour, minute, second) : undefined;
  }

  const ambiguousNumeric = datePart.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (ambiguousNumeric) {
    const first = Number.parseInt(ambiguousNumeric[1], 10);
    const secondPart = Number.parseInt(ambiguousNumeric[2], 10);
    const year = Number.parseInt(ambiguousNumeric[3], 10);
    if (first > 12) return normalizeStructuredDate(year, secondPart, first, hour, minute, second);
    if (secondPart > 12) return normalizeStructuredDate(year, first, secondPart, hour, minute, second);
    return normalizeStructuredDate(year, first, secondPart, hour, minute, second);
  }
  return undefined;
}

export function normalizeStructuredDate(year: number, month: number, day: number, hour: number, minute: number, second: number): StructuredDate | undefined {
  const normalizedYear = year < 100 ? 2000 + year : year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const normalized = new Date(Date.UTC(normalizedYear, month - 1, day, hour, minute, second));
  if (normalized.getUTCFullYear() !== normalizedYear || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== day) return undefined;
  return { year: normalizedYear, month, day, hour, minute, second };
}

export function readReportDate(text: string): string | undefined {
  const maxDateWhitespaceGap = 20;
  const datePatterns = [
    new RegExp(`(?:test|scan|report|measurement|measured|date)\\s{0,${maxDateWhitespaceGap}}(?:date)?\\s{0,${maxDateWhitespaceGap}}[:\\-]?\\s{0,${maxDateWhitespaceGap}}(\\d{1,2}[\\/\\-.][A-Za-z]{3,9}[\\/\\-.]\\d{2,4}(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?)`, "i"),
    new RegExp(`(?:test|scan|report|measurement|measured|date)\\s{0,${maxDateWhitespaceGap}}(?:date)?\\s{0,${maxDateWhitespaceGap}}[:\\-]?\\s{0,${maxDateWhitespaceGap}}(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4})`, "i"),
    new RegExp(`(?:test|scan|report|measurement|measured|date)\\s{0,${maxDateWhitespaceGap}}(?:date)?\\s{0,${maxDateWhitespaceGap}}[:\\-]?\\s{0,${maxDateWhitespaceGap}}([A-Za-z]{3,9}\\s{1,${maxDateWhitespaceGap}}\\d{1,2},?\\s{1,${maxDateWhitespaceGap}}\\d{4})`, "i"),
    /\b(\d{1,2}[\/\-.][A-Za-z]{3,9}[\/\-.]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\b/,
    /\b(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/,
    /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/
  ];
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    const parsed = readDate(match?.[1]);
    if (parsed) return parsed;
  }
  return undefined;
}

export function readDateFromFileName(fileName: string): string | undefined {
  const compact = fileName.match(/(\d{1,2})([A-Za-z]{3,9})(\d{4})/);
  if (compact) return readDate(`${compact[1]} ${compact[2]} ${compact[3]}`);
  const monthFirstCompact = fileName.match(/([A-Za-z]{3,9})(\d{1,2})(\d{4})/);
  if (monthFirstCompact) return readDate(`${monthFirstCompact[1]} ${monthFirstCompact[2]} ${monthFirstCompact[3]}`);
  const separated = fileName.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})|(\d{1,2})[-_](\d{1,2})[-_](\d{2,4})/);
  return separated ? readDate(separated[0].replace(/_/g, "-")) : undefined;
}

export function looksLikeDateOnly(value: string): boolean {
  return /^\D*\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}\D*$/.test(value);
}

export function fallbackMeasurementCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return normalized ? `manual_${normalized}` : `manual_${cryptoId("marker_code")}`;
}

export function fallbackBodyCompositionCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/%/g, " pct ").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return normalized ? `body_comp_${normalized}` : `body_comp_${stableId("field", [value])}`;
}

export function toDisplayName(value: string): string {
  return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeBodyCompositionUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "lbs" || normalized === "lb" || normalized === "pounds" || normalized === "pound") return "lb";
  if (normalized === "l" || normalized === "liter" || normalized === "liters" || normalized === "litre" || normalized === "litres") return "L";
  if (normalized === "kig") return "kg";
  if (normalized === "cal") return "kcal";
  if (normalized === "kg/m²" || normalized === "kg/m^2") return "kg/m2";
  return unit.trim();
}

function cryptoId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}
