import type { Observation, ObservationGroup, UnitSystem } from "./types.js";
import { findMeasurementType, getPreferredUnit } from "./measurementRegistry.js";
import {
  checksum,
  fallbackMeasurementCode,
  normalizeFieldKey,
  parseDelimitedWithHeaders,
  readDate,
  readNumber,
  stableId,
  toDisplayName
} from "./parserPrimitives.js";
import type {
  ParsedImport,
  UploadColumnMapping,
  UploadColumnMappingOverride,
  UploadDraftRow,
  UploadFileFormat,
  UploadImportCommitPayload,
  UploadImportDraft,
  UploadLayout,
  UploadMeasurementColumnMapping
} from "./parserTypes.js";

/** Draft rows are capped so preview/review stays responsive and bounded. */
export const MAX_UPLOAD_DRAFT_ROWS = 200;

const dateHeaderCandidates = ["observed_at", "collected_at", "date", "timestamp", "datetime", "time", "day"];
const measurementHeaderCandidates = ["measurement", "measurement_name", "marker", "name", "metric", "field"];
const measurementCodeHeaderCandidates = ["measurement_code", "marker_code", "code"];
const valueHeaderCandidates = ["value", "result", "reading", "amount"];
const unitHeaderCandidates = ["unit", "units"];
const labelHeaderCandidates = ["label", "panel_name", "group", "observation_group"];
const sourceNameHeaderCandidates = ["source_name", "source", "lab_name"];
const noteHeaderCandidates = ["note", "notes", "comment", "comments"];

const columnUnitSuffixes: Record<string, string> = {
  kg: "kg", lb: "lb", lbs: "lb", cm: "cm", in: "in",
  bpm: "bpm", pct: "%", percent: "%", kcal: "kcal",
  steps: "steps", min: "min", minutes: "min", hours: "h", hour: "h"
};

/** Detects CSV vs TSV from the file name, falling back to sniffing the header line. */
export function detectUploadFormat(fileName: string, content: string): UploadFileFormat {
  if (/\.tsv$/i.test(fileName)) return "tsv";
  if (/\.csv$/i.test(fileName)) return "csv";
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "tsv" : "csv";
}

function findHeader(headers: string[], candidates: string[]): string | undefined {
  return headers.find((header) => candidates.includes(normalizeFieldKey(header)));
}

function splitHeaderUnit(header: string): { base: string; unit?: string } {
  const parenMatch = header.match(/^(.*?)\s*[([]([^()[\]]+)[)\]]\s*$/);
  if (parenMatch) return { base: parenMatch[1].trim(), unit: parenMatch[2].trim() };
  const normalized = normalizeFieldKey(header);
  for (const [suffix, unit] of Object.entries(columnUnitSuffixes)) {
    if (normalized.endsWith(`_${suffix}`)) {
      return { base: normalized.slice(0, -(suffix.length + 1)).replace(/_/g, " "), unit };
    }
  }
  return { base: header };
}

/**
 * Detects whether a structured upload is "long" (measurement + value columns,
 * one observation per row) or "wide" (a date column plus one column per
 * measurement).
 */
export function detectUploadLayout(headers: string[]): UploadLayout {
  const hasValueColumn = Boolean(findHeader(headers, valueHeaderCandidates));
  const hasMeasurementColumn = Boolean(
    findHeader(headers, measurementHeaderCandidates) ?? findHeader(headers, measurementCodeHeaderCandidates)
  );
  return hasValueColumn && hasMeasurementColumn ? "long" : "wide";
}

/** Builds the automatic column-role mapping suggestion for a set of headers. */
export function suggestUploadColumnMapping(headers: string[]): UploadColumnMapping {
  const layout = detectUploadLayout(headers);
  const dateColumn = findHeader(headers, dateHeaderCandidates);
  if (layout === "long") {
    return {
      layout,
      dateColumn,
      measurementColumn: findHeader(headers, measurementHeaderCandidates),
      measurementCodeColumn: findHeader(headers, measurementCodeHeaderCandidates),
      valueColumn: findHeader(headers, valueHeaderCandidates),
      unitColumn: findHeader(headers, unitHeaderCandidates),
      labelColumn: findHeader(headers, labelHeaderCandidates),
      sourceNameColumn: findHeader(headers, sourceNameHeaderCandidates),
      noteColumn: findHeader(headers, noteHeaderCandidates)
    };
  }
  const measurementColumns: Record<string, UploadMeasurementColumnMapping> = {};
  const ignoredColumns: string[] = [];
  for (const header of headers) {
    if (header === dateColumn) continue;
    const { base, unit } = splitHeaderUnit(header);
    const measurementType = findMeasurementType(base) ?? findMeasurementType(header);
    if (measurementType) {
      measurementColumns[header] = { measurementCode: measurementType.code, ...(unit ? { unit } : {}) };
    } else {
      ignoredColumns.push(header);
    }
  }
  return { layout, dateColumn, measurementColumns, ignoredColumns };
}

/**
 * Applies a caller-supplied mapping override on top of the automatic
 * suggestion. Wide-format `measurementColumns` merge per-column; every other
 * field is replaced wholesale when present in the override.
 */
export function mergeUploadColumnMapping(
  suggestion: UploadColumnMapping,
  override?: UploadColumnMappingOverride
): UploadColumnMapping {
  if (!override) return suggestion;
  const layout = override.layout ?? suggestion.layout;
  if (layout === "long") {
    return {
      layout,
      dateColumn: override.dateColumn ?? suggestion.dateColumn,
      measurementColumn: override.measurementColumn ?? suggestion.measurementColumn,
      measurementCodeColumn: override.measurementCodeColumn ?? suggestion.measurementCodeColumn,
      valueColumn: override.valueColumn ?? suggestion.valueColumn,
      unitColumn: override.unitColumn ?? suggestion.unitColumn,
      labelColumn: override.labelColumn ?? suggestion.labelColumn,
      sourceNameColumn: override.sourceNameColumn ?? suggestion.sourceNameColumn,
      noteColumn: override.noteColumn ?? suggestion.noteColumn
    };
  }
  const measurementColumns = { ...suggestion.measurementColumns, ...override.measurementColumns };
  for (const ignoredColumn of override.ignoredColumns ?? []) {
    delete measurementColumns[ignoredColumn];
  }
  return {
    layout,
    dateColumn: override.dateColumn ?? suggestion.dateColumn,
    measurementColumns,
    ignoredColumns: override.ignoredColumns ?? suggestion.ignoredColumns
  };
}

export interface ParseStructuredUploadOptions {
  format?: UploadFileFormat;
  mapping?: UploadColumnMappingOverride;
  units?: UnitSystem;
}

/**
 * Parses a CSV/TSV upload into a fresh review draft. Always recomputed from
 * scratch (never resumed) so mapping overrides can't drift from stale rows.
 * Unknown/ambiguous measurements are included in the draft but excluded
 * (`included: false`) until the caller maps or confirms them.
 */
export function parseStructuredUpload(
  fileName: string,
  content: string,
  options: ParseStructuredUploadOptions = {}
): UploadImportDraft {
  const format = options.format ?? detectUploadFormat(fileName, content);
  const delimiter = format === "tsv" ? "\t" : ",";
  const { headers, rows } = parseDelimitedWithHeaders(content, delimiter);
  const sourceChecksum = checksum(content);
  const units = options.units ?? "metric";
  const diagnostics: string[] = [];

  const mappingSuggestion = suggestUploadColumnMapping(headers);
  const mapping = mergeUploadColumnMapping(mappingSuggestion, options.mapping);

  const draftRows = mapping.layout === "long"
    ? buildLongFormatRows(rows, mapping, sourceChecksum, units, diagnostics)
    : buildWideFormatRows(rows, mapping, sourceChecksum, units, diagnostics);

  const truncated = draftRows.length > MAX_UPLOAD_DRAFT_ROWS;
  if (truncated) {
    diagnostics.push(`Only the first ${MAX_UPLOAD_DRAFT_ROWS} parsed rows are shown; refine the file or mapping to reduce rows.`);
  }
  if (headers.length === 0) diagnostics.push("No header row was detected in the uploaded file.");
  if (rows.length === 0 && headers.length > 0) diagnostics.push("No data rows were found beneath the header row.");

  return {
    fileName,
    format,
    layout: mapping.layout,
    checksum: sourceChecksum,
    parserVersion: "structured-upload-v1",
    columns: headers,
    mapping,
    mappingSuggestion,
    rowCount: rows.length,
    diagnostics: diagnostics.slice(0, 50),
    rows: draftRows.slice(0, MAX_UPLOAD_DRAFT_ROWS),
    truncated
  };
}

function buildLongFormatRows(
  rows: Array<Record<string, string>>,
  mapping: UploadColumnMapping,
  sourceChecksum: string,
  units: UnitSystem,
  diagnostics: string[]
): UploadDraftRow[] {
  const result: UploadDraftRow[] = [];
  rows.forEach((row, index) => {
    const observedAt = readDate(mapping.dateColumn ? row[mapping.dateColumn] : undefined);
    const rawLabel = (mapping.measurementColumn ? row[mapping.measurementColumn] : undefined)?.trim() ?? "";
    const rawCode = (mapping.measurementCodeColumn ? row[mapping.measurementCodeColumn] : undefined)?.trim();
    const rawValue = mapping.valueColumn ? row[mapping.valueColumn] : undefined;
    const value = readNumber(rawValue);
    if (value === undefined) {
      diagnostics.push(`Row ${index + 2}: skipped — no numeric value found.`);
      return;
    }
    if (!rawLabel && !rawCode) {
      diagnostics.push(`Row ${index + 2}: skipped — no measurement name or code found.`);
      return;
    }
    const measurementType = (rawCode ? findMeasurementType(rawCode) : undefined) ?? (rawLabel ? findMeasurementType(rawLabel) : undefined);
    const measurementCode = measurementType?.code ?? rawCode ?? fallbackMeasurementCode(rawLabel);
    const displayName = measurementType?.display ?? toDisplayName(rawLabel || rawCode || measurementCode);
    const rawUnit = mapping.unitColumn ? row[mapping.unitColumn]?.trim() : undefined;
    const unit = rawUnit || (measurementType ? getPreferredUnit(measurementType, units) : "unknown");
    const generatedCode = !measurementType;
    if (generatedCode) diagnostics.push(`Row ${index + 2}: "${rawLabel || rawCode}" is not a recognized measurement; excluded until mapped.`);
    result.push({
      id: stableId("upload-draft", [sourceChecksum, String(index), measurementCode, String(value), unit]),
      label: rawLabel || rawCode || displayName,
      measurementCode,
      displayName,
      value,
      unit,
      observedAt,
      confidence: measurementType ? "high" : "low",
      sourceText: mapping.labelColumn ? row[mapping.labelColumn] : undefined,
      sourceName: mapping.sourceNameColumn ? row[mapping.sourceNameColumn]?.trim() : undefined,
      note: mapping.noteColumn ? row[mapping.noteColumn]?.trim() : undefined,
      included: !generatedCode,
      generatedCode,
      sourceRowIndex: index
    });
  });
  return result;
}

function buildWideFormatRows(
  rows: Array<Record<string, string>>,
  mapping: UploadColumnMapping,
  sourceChecksum: string,
  units: UnitSystem,
  diagnostics: string[]
): UploadDraftRow[] {
  const result: UploadDraftRow[] = [];
  const measurementColumns = Object.entries(mapping.measurementColumns ?? {});
  if (measurementColumns.length === 0) {
    diagnostics.push("No columns were recognized as known measurements; map a column to include data.");
  }
  if (!mapping.dateColumn) {
    diagnostics.push("No date/timestamp column was detected; observations will use the import time.");
  }
  rows.forEach((row, index) => {
    const observedAt = readDate(mapping.dateColumn ? row[mapping.dateColumn] : undefined);
    for (const [column, columnMapping] of measurementColumns) {
      const value = readNumber(row[column]);
      if (value === undefined) continue;
      const measurementType = findMeasurementType(columnMapping.measurementCode);
      const unit = columnMapping.unit || (measurementType ? getPreferredUnit(measurementType, units) : "unknown");
      const displayName = measurementType?.display ?? toDisplayName(column);
      result.push({
        id: stableId("upload-draft", [sourceChecksum, String(index), columnMapping.measurementCode, String(value), unit]),
        label: column,
        measurementCode: columnMapping.measurementCode,
        displayName,
        value,
        unit,
        observedAt,
        confidence: measurementType ? "high" : "medium",
        included: true,
        generatedCode: !measurementType,
        sourceRowIndex: index,
        sourceColumn: column
      });
    }
  });
  return result;
}

/**
 * Builds the committed import from reviewed/approved draft rows, preserving
 * the same deterministic-ID and provenance semantics as the other import
 * parsers (stable observation IDs, source/group linkage, raw content retained
 * locally only).
 */
export function buildStructuredUploadImportFromDraft(
  payload: UploadImportCommitPayload,
  importedAt = new Date().toISOString()
): ParsedImport {
  const sourceChecksum = payload.checksum || checksum(JSON.stringify(payload));
  const importId = stableId("import", ["structured-upload", payload.fileName, sourceChecksum]);
  const sourceId = stableId("source", ["structured-upload", payload.fileName, sourceChecksum]);
  const diagnostics: string[] = [];
  const observations: Observation[] = [];
  const includedRows = payload.rows.filter((row) => row.included !== false);
  const groupId = stableId("group", ["structured_upload", sourceChecksum]);
  const group: ObservationGroup = {
    id: groupId,
    kind: "custom",
    label: `Upload: ${payload.fileName}`,
    sourceId,
    importId,
    collectedAt: importedAt
  };

  for (const row of includedRows) {
    const measurementCode = row.measurementCode?.trim() || fallbackMeasurementCode(row.label || row.displayName);
    const value = Number(row.value);
    if (!Number.isFinite(value)) {
      diagnostics.push(`Skipped upload row with invalid value: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }
    const rowObservedAt = readDate(row.observedAt) ?? importedAt;
    const unit = row.unit?.trim() || findMeasurementType(measurementCode)?.canonicalUnit || "unknown";
    observations.push({
      id: stableId("obs", ["structured-upload", sourceChecksum, rowObservedAt, measurementCode, String(value), unit]),
      measurementCode,
      observedAt: rowObservedAt,
      value,
      unit,
      sourceId,
      observationGroupId: groupId,
      note: row.note?.trim() || `Upload: ${payload.fileName}`,
      sourceJson: {
        label: row.label,
        displayName: row.displayName,
        confidence: row.confidence,
        sourceColumn: row.sourceColumn,
        sourceName: row.sourceName,
        note: row.note,
        generatedCode: row.generatedCode === true
      }
    });
  }

  return {
    sourceImport: {
      id: importId,
      sourceKind: "structured-upload",
      fileName: payload.fileName,
      importedAt,
      parserVersion: "structured-upload-v1",
      checksum: sourceChecksum,
      rowCount: includedRows.length,
      status: diagnostics.length > 0 || includedRows.some((row) => row.confidence === "low") ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25),
      rawContent: JSON.stringify({ fileName: payload.fileName, sourceChecksum, rows: includedRows })
    },
    dataSource: {
      id: sourceId,
      sourceKind: "structured-upload",
      label: `Upload: ${payload.fileName}`,
      importId,
      createdAt: importedAt
    },
    observations,
    observationGroups: [group],
    timeSeriesSamples: [],
    activitySessions: []
  };
}
