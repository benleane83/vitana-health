import {
  parseBloodTestScanText,
  parseBodyCompositionText,
  type BloodTestDraft,
  type BodyCompositionDraft,
  type BodyCompositionDraftRow
} from "@vitana/shared";

export type ScanReportEditableRow = Omit<BodyCompositionDraftRow, "value"> & {
  value: string;
  manuallyAdded?: boolean;
};

export type ScanReportKind = "body-composition" | "blood-test";

export function parseScanReportText(
  kind: ScanReportKind,
  fileName: string,
  sourceText: string,
  excludedDates: readonly string[] = []
): BodyCompositionDraft | BloodTestDraft {
  return kind === "body-composition"
    ? parseBodyCompositionText(fileName, sourceText)
    : parseBloodTestScanText(fileName, sourceText, undefined, { excludedDates });
}

export function toEditableScanRows(rows: BodyCompositionDraftRow[]): ScanReportEditableRow[] {
  return rows.map((row) => ({ ...row, value: Number.isFinite(row.value) ? String(row.value) : "", manuallyAdded: false }));
}

export function newScanReportRow(id = `manual-${Date.now()}`): ScanReportEditableRow {
  return {
    id,
    label: "Added measurement",
    measurementCode: "",
    displayName: "Added measurement",
    value: "",
    unit: "",
    confidence: "high",
    included: true,
    manuallyAdded: true
  };
}

export function shouldRemoveScanReportRowOnExclude(row: ScanReportEditableRow): boolean {
  return row.manuallyAdded === true && !row.value.trim();
}

export function groupScanRows(rows: ScanReportEditableRow[]): {
  selected: ScanReportEditableRow[];
  notSelected: ScanReportEditableRow[];
} {
  return {
    selected: rows.filter((row) => row.included),
    notSelected: rows.filter((row) => !row.included)
  };
}

export function toCommittedScanRows(rows: ScanReportEditableRow[]): BodyCompositionDraftRow[] {
  const selected = rows.filter((row) => row.included);
  if (selected.length === 0) throw new Error("Include at least one row.");

  return selected.map(({ manuallyAdded: _manuallyAdded, ...row }) => {
    const value = row.value.trim() ? Number(row.value) : Number.NaN;
    if (!row.measurementCode.trim() || !Number.isFinite(value) || !row.unit.trim()) {
      throw new Error("Every included row needs a measurement, numeric value, and unit.");
    }
    return {
      ...row,
      measurementCode: row.measurementCode.trim(),
      value,
      unit: row.unit.trim()
    };
  });
}

export function scanReportDate(reportDate: string | undefined, fallback = new Date()): string {
  const match = reportDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match && isValidDateParts(Number(match[1]), Number(match[2]), Number(match[3]))) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return localDateOnly(fallback);
}

export function localDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateOnlyToLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!isValidDateParts(year, month, day)) return new Date();
  return new Date(year, month - 1, day);
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}