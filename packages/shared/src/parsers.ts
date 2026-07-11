import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import type {
  ActivitySession,
  DataSource,
  Observation,
  ObservationGroup,
  SourceImport,
  TimeSeriesSample
} from "./types.js";
import { findMeasurementType } from "./registry.js";

export interface ParsedImport {
  sourceImport: SourceImport;
  dataSource: DataSource;
  observations: Observation[];
  observationGroups: ObservationGroup[];
  timeSeriesSamples: TimeSeriesSample[];
  activitySessions: ActivitySession[];
}

export interface ManualLabEntryMarkerInput {
  markerName?: string;
  markerCode?: string;
  value: number;
  unit?: string;
}

export interface ManualLabEntryPayload {
  collectedAt: string;
  panelName: string;
  labName?: string;
  markers: ManualLabEntryMarkerInput[];
}

export interface ManualObservationInput {
  measurementName?: string;
  measurementCode?: string;
  value: number;
  unit?: string;
}

export interface ManualObservationPayload {
  observedAt: string;
  label: string;
  sourceName?: string;
  observations: ManualObservationInput[];
}

export type BodyCompositionDraftConfidence = "high" | "medium" | "low";

export interface BodyCompositionDraftRow {
  id: string;
  label: string;
  measurementCode: string;
  displayName: string;
  value: number;
  unit: string;
  observedAt?: string;
  confidence: BodyCompositionDraftConfidence;
  sourceText?: string;
  included: boolean;
  generatedCode?: boolean;
}

export interface BodyCompositionDraft {
  fileName: string;
  reportDate?: string;
  sourceText: string;
  checksum: string;
  parserVersion: "body-composition-text-v1";
  diagnostics: string[];
  rows: BodyCompositionDraftRow[];
}

export interface BodyCompositionDraftCommitPayload {
  fileName: string;
  reportDate?: string;
  sourceText?: string;
  sourceChecksum?: string;
  rows: BodyCompositionDraftRow[];
}

export function checksum(content: string): string {
  return `sha256-${bytesToHex(sha256(content))}`;
}

export function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });
}

function splitCsvLine(line: string): string[] {
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
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

export function parseBloodTestCsv(fileName: string, content: string, importedAt = new Date().toISOString()): ParsedImport {
  const rows = parseCsv(content);
  const sourceChecksum = checksum(content);
  const importId = stableId("import", ["blood-test-csv", fileName, sourceChecksum]);
  const sourceId = stableId("source", ["blood-test-csv", fileName, sourceChecksum]);
  const groupId = stableId("group", ["lab_panel", sourceChecksum]);
  const diagnostics: string[] = [];
  const collectedAt =
    readDate(rows[0]?.collectedAt ?? rows[0]?.collected_at ?? rows[0]?.date) ?? importedAt;
  const group: ObservationGroup = {
    id: groupId,
    kind: "lab_panel",
    label: rows[0]?.panelName ?? rows[0]?.panel_name ?? "Blood test panel",
    sourceId,
    importId,
    collectedAt,
    metadata: { labName: rows[0]?.labName ?? rows[0]?.lab_name }
  };
  const observations: Observation[] = [];

  for (const row of rows) {
    const normalized = normalizeKeys(row);
    const label = normalized.marker || normalized.test || normalized.name || normalized.measurement || "";
    const measurementType = findMeasurementType(label);
    const value = readNumber(normalized.value ?? normalized.result);
    if (!measurementType || value === undefined) {
      diagnostics.push(`Skipped lab row with unrecognized marker or missing value: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }
    const unit = normalized.unit || measurementType.canonicalUnit;
    if (!normalized.unit) {
      diagnostics.push(`Used canonical unit for lab row with no unit: ${measurementType.display}.`);
    }
    observations.push({
      id: stableId("obs", ["blood-test-csv", sourceChecksum, measurementType.code, String(value), unit]),
      measurementCode: measurementType.code,
      observedAt: collectedAt,
      value,
      unit,
      sourceId,
      observationGroupId: groupId,
      note: `Lab marker from ${group.label}`,
      sourceJson: row
    });
  }

  return {
    sourceImport: {
      id: importId,
      sourceKind: "blood-test-csv",
      fileName,
      importedAt,
      parserVersion: "blood-test-csv-v1",
      checksum: sourceChecksum,
      rowCount: rows.length,
      status: diagnostics.length > rows.length / 2 ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25),
      rawContent: content
    },
    dataSource: {
      id: sourceId,
      sourceKind: "blood-test-csv",
      label: `Blood test CSV: ${fileName}`,
      importId,
      createdAt: importedAt
    },
    observations,
    observationGroups: [group],
    timeSeriesSamples: [],
    activitySessions: []
  };
}

/**
 * Parses the strict generic observation CSV template:
 * observedAt,measurement,value,unit,label,sourceName
 *
 * `measurementCode` and common aliases may be used in place of `measurement`.
 */
export function parseObservationCsv(fileName: string, content: string, importedAt = new Date().toISOString()): ParsedImport {
  const rows = parseCsv(content);
  const sourceChecksum = checksum(content);
  const importId = stableId("import", ["observation-csv", fileName, sourceChecksum]);
  const sourceId = stableId("source", ["observation-csv", fileName, sourceChecksum]);
  const diagnostics: string[] = [];
  const first = normalizeKeys(rows[0] ?? {});
  const observedAt = readDate(first.observed_at ?? first.collected_at ?? first.date) ?? importedAt;
  const label = first.label || first.panel_name || "Observation CSV";
  const groupId = stableId("group", ["observation-csv", sourceChecksum]);
  const group: ObservationGroup = {
    id: groupId,
    kind: "custom",
    label,
    sourceId,
    importId,
    collectedAt: observedAt,
    metadata: { sourceName: first.source_name }
  };
  const observations: Observation[] = [];

  for (const row of rows) {
    const normalized = normalizeKeys(row);
    const name = normalized.measurement ?? normalized.measurement_name ?? normalized.marker ?? normalized.name ?? "";
    const code = normalized.measurement_code ?? normalized.marker_code;
    const measurementType = (code ? findMeasurementType(code) : undefined) ?? findMeasurementType(name);
    const value = readNumber(normalized.value ?? normalized.result);
    if (value === undefined || (!name && !code)) {
      diagnostics.push(`Skipped observation row with missing measurement or value: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }
    const measurementCode = measurementType?.code ?? code ?? fallbackMeasurementCode(name);
    if (!measurementType) diagnostics.push(`Used generated code for "${name || code}".`);
    const unit = normalized.unit || measurementType?.canonicalUnit || "unknown";
    const rowObservedAt = readDate(normalized.observed_at ?? normalized.collected_at ?? normalized.date) ?? observedAt;
    observations.push({
      id: stableId("obs", ["observation-csv", sourceChecksum, rowObservedAt, measurementCode, String(value), unit]),
      measurementCode,
      observedAt: rowObservedAt,
      value,
      unit,
      sourceId,
      observationGroupId: groupId,
      note: `Observation from ${label}`,
      sourceJson: row
    });
  }
  return {
    sourceImport: {
      id: importId, sourceKind: "observation-csv", fileName, importedAt, parserVersion: "observation-csv-v1",
      checksum: sourceChecksum, rowCount: rows.length,
      status: diagnostics.length > rows.length / 2 ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25), rawContent: content
    },
    dataSource: { id: sourceId, sourceKind: "observation-csv", label: `Observation CSV: ${fileName}`, importId, createdAt: importedAt },
    observations, observationGroups: [group], timeSeriesSamples: [], activitySessions: []
  };
}

export function buildManualLabEntryImport(payload: ManualLabEntryPayload, importedAt = new Date().toISOString()): ParsedImport {
  return buildManualObservationImport(
    {
      observedAt: payload.collectedAt,
      label: payload.panelName,
      sourceName: payload.labName,
      observations: payload.markers.map(({ markerName, markerCode, value, unit }) => ({
        measurementName: markerName,
        measurementCode: markerCode,
        value,
        unit
      }))
    },
    importedAt,
    "lab_panel"
  );
}

export function buildManualObservationImport(
  payload: ManualObservationPayload,
  importedAt = new Date().toISOString(),
  groupKind: ObservationGroup["kind"] = "custom"
): ParsedImport {
  const diagnostics: string[] = [];
  const panelName = payload.label.trim() || "Manual observations";
  const collectedAt = readDate(payload.observedAt) ?? importedAt;
  const serializedPayload = JSON.stringify({ collectedAt, panelName, sourceName: payload.sourceName?.trim(), observations: payload.observations });
  const sourceChecksum = checksum(serializedPayload);
  const importId = stableId("import", ["manual-entry", sourceChecksum]);
  const sourceId = stableId("source", ["manual-entry", sourceChecksum]);
  const groupId = stableId("group", ["lab_panel", sourceChecksum]);
  const group: ObservationGroup = {
    id: groupId,
    kind: groupKind,
    label: panelName,
    sourceId,
    importId,
    collectedAt,
    metadata: { sourceName: payload.sourceName?.trim() || undefined }
  };
  const observations: Observation[] = [];

  for (const row of payload.observations) {
    const markerName = row.measurementName?.trim();
    const markerCode = row.measurementCode?.trim();
    const measurementType = markerCode
      ? findMeasurementType(markerCode) ?? (markerName ? findMeasurementType(markerName) : undefined)
      : markerName
        ? findMeasurementType(markerName)
        : undefined;
    const value = row.value;
    if (!Number.isFinite(value)) {
      diagnostics.push(`Skipped manual observation with invalid value: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }
    if (!measurementType && !markerName && !markerCode) {
      diagnostics.push(`Skipped manual observation with no name or code: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }
    const displayName = markerName || measurementType?.display || markerCode || "Manual marker";
    const measurementCode = measurementType?.code || markerCode || fallbackMeasurementCode(displayName);
    const unit = row.unit?.trim() || measurementType?.canonicalUnit || "unknown";
    observations.push({
      id: stableId("obs", ["manual-entry", sourceChecksum, measurementCode, String(value), unit]),
      measurementCode,
      observedAt: collectedAt,
      value,
      unit,
      sourceId,
      observationGroupId: groupId,
      note: `Manual observation from ${group.label}`,
      sourceJson: row
    });
  }

  const fileName = `${panelName.replace(/\s+/g, "-").toLowerCase()}-${collectedAt.slice(0, 10)}.manual-entry`;

  return {
    sourceImport: {
      id: importId,
      sourceKind: "manual-entry",
      fileName,
      importedAt,
      parserVersion: "manual-lab-entry-v1",
      checksum: sourceChecksum,
      rowCount: payload.observations.length,
      status: diagnostics.length > payload.observations.length / 2 ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25),
      rawContent: serializedPayload
    },
    dataSource: {
      id: sourceId,
      sourceKind: "manual-entry",
      label: `Manual observations: ${panelName}`,
      importId,
      createdAt: importedAt
    },
    observations,
    observationGroups: [group],
    timeSeriesSamples: [],
    activitySessions: []
  };
}

export function parseBodyCompositionText(fileName: string, sourceText: string, importedAt = new Date().toISOString()): BodyCompositionDraft {
  const normalizedText = sourceText.replace(/\r/g, "").trim();
  const sourceChecksum = checksum(normalizedText || fileName);
  const diagnostics: string[] = [];
  const reportDate = readBodyCompositionDate(normalizedText) ?? readDateFromFileName(fileName);
  const rows = new Map<string, BodyCompositionDraftRow>();

  const lines = normalizedText.split("\n").map((item) => item.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/\bdesirable\s+range\b/i.test(line)) {
      break;
    }
    const parseLine = /\bbmr\b/i.test(line) && lines[index + 1] ? `${line} ${lines[index + 1]}` : line;
    const candidates = parseBodyCompositionLine(parseLine);
    for (const candidate of candidates) {
      const measurementType = findMeasurementType(candidate.label);
      const measurementCode = measurementType?.code ?? fallbackBodyCompositionCode(candidate.label);
      const displayName = measurementType?.display ?? toDisplayName(candidate.label);
      const unit = normalizeBodyCompositionUnit(candidate.unit || measurementType?.canonicalUnit || "unknown");
      const key = `${measurementCode}:${candidate.value}:${unit}`;
      if (rows.has(key)) {
        continue;
      }
      const generatedCode = !measurementType;
      if (generatedCode) {
        diagnostics.push(`Used generated body-composition code for "${candidate.label}".`);
      }
      const included = !generatedCode && isPlausibleBodyCompositionValue(measurementCode, candidate.value, unit);
      if (!included && !generatedCode) {
        diagnostics.push(`Review unusual body-composition value for "${displayName}": ${candidate.value} ${unit}.`);
      }
      rows.set(key, {
        id: stableId("draft", [sourceChecksum, measurementCode, String(candidate.value), unit]),
        label: candidate.label,
        measurementCode,
        displayName,
        value: candidate.value,
        unit,
        observedAt: reportDate,
        confidence: candidate.confidence,
        sourceText: line,
        included,
        generatedCode
      });
    }
  }

  if (!normalizedText) {
    diagnostics.push("No text was extracted from the report.");
  }
  if (!reportDate) {
    diagnostics.push("No report date was detected; confirm the date before saving.");
  }
  if (rows.size === 0 && normalizedText) {
    diagnostics.push("No body-composition measurements were detected in the extracted text.");
  }

  return {
    fileName,
    reportDate,
    sourceText: normalizedText,
    checksum: sourceChecksum,
    parserVersion: "body-composition-text-v1",
    diagnostics: diagnostics.slice(0, 50),
    rows: [...rows.values()]
  };
}

export function buildBodyCompositionImportFromDraft(
  payload: BodyCompositionDraftCommitPayload,
  importedAt = new Date().toISOString()
): ParsedImport {
  const sourceChecksum = payload.sourceChecksum || checksum(JSON.stringify(payload));
  const importId = stableId("import", ["body-composition-report", payload.fileName, sourceChecksum]);
  const sourceId = stableId("source", ["body-composition-report", payload.fileName, sourceChecksum]);
  const diagnostics: string[] = [];
  const observations: Observation[] = [];
  const includedRows = payload.rows.filter((row) => row.included !== false);
  const observedAt = readDate(payload.reportDate) ?? importedAt;
  const groupId = stableId("group", ["body_composition_report", sourceChecksum]);
  const group: ObservationGroup = {
    id: groupId,
    kind: "body_composition_report",
    label: payload.fileName,
    sourceId,
    importId,
    collectedAt: observedAt
  };

  for (const row of includedRows) {
    const measurementCode = row.measurementCode?.trim() || fallbackBodyCompositionCode(row.label || row.displayName);
    const value = Number(row.value);
    if (!Number.isFinite(value)) {
      diagnostics.push(`Skipped body-composition row with invalid value: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }
    const rowObservedAt = readDate(row.observedAt) ?? observedAt;
    const unit = normalizeBodyCompositionUnit(row.unit || findMeasurementType(measurementCode)?.canonicalUnit || "unknown");
    observations.push({
      id: stableId("obs", ["body-composition-report", sourceChecksum, rowObservedAt, measurementCode, String(value), unit]),
      measurementCode,
      observedAt: rowObservedAt,
      effectiveStart: rowObservedAt,
      effectiveEnd: rowObservedAt,
      value,
      unit,
      sourceId,
      observationGroupId: groupId,
      note: `Body composition report: ${payload.fileName}`,
      sourceJson: {
        label: row.label,
        displayName: row.displayName,
        confidence: row.confidence,
        sourceText: row.sourceText,
        generatedCode: row.generatedCode === true
      }
    });
  }

  const rawContent = JSON.stringify({
    fileName: payload.fileName,
    reportDate: observedAt,
    sourceChecksum,
    sourceText: payload.sourceText,
    rows: includedRows
  });

  return {
    sourceImport: {
      id: importId,
      sourceKind: "body-composition-report",
      fileName: payload.fileName,
      importedAt,
      parserVersion: "body-composition-report-v1",
      checksum: sourceChecksum,
      rowCount: includedRows.length,
      status: diagnostics.length > 0 || includedRows.some((row) => row.confidence === "low") ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25),
      rawContent
    },
    dataSource: {
      id: sourceId,
      sourceKind: "body-composition-report",
      label: `Body composition report: ${payload.fileName}`,
      importId,
      createdAt: importedAt
    },
    observations,
    observationGroups: [group],
    timeSeriesSamples: [],
    activitySessions: []
  };
}

// Both scan types use the same editable review-row lifecycle.
export type BloodTestDraft = BodyCompositionDraft;
export type BloodTestDraftCommitPayload = BodyCompositionDraftCommitPayload;

export function parseBloodTestScanText(fileName: string, sourceText: string, importedAt = new Date().toISOString()): BloodTestDraft {
  const normalizedText = sourceText.replace(/\r/g, "").trim();
  const sourceChecksum = checksum(normalizedText || fileName);
  const diagnostics: string[] = [];
  const reportDate = readBodyCompositionDate(normalizedText) ?? readDateFromFileName(fileName);
  const rows = new Map<string, BodyCompositionDraftRow>();
  for (const line of normalizedText.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const match = line.match(/^(.{2,100}?)\s*(?::|\s{2,}|-)\s*(-?\d+(?:[.,]\d+)?)\s*([A-Za-z%/]+)?(?:\s|$)/);
    if (!match) continue;
    const label = match[1].trim();
    const value = readNumber(match[2]);
    if (value === undefined || looksLikeDateOnly(line)) continue;
    const measurementType = findMeasurementType(label);
    const measurementCode = measurementType?.code ?? fallbackMeasurementCode(label);
    const unit = match[3] || measurementType?.canonicalUnit || "unknown";
    const key = `${measurementCode}:${value}:${unit}`;
    if (rows.has(key)) continue;
    const generatedCode = !measurementType;
    if (generatedCode) diagnostics.push(`Used generated code for "${label}".`);
    rows.set(key, {
      id: stableId("draft", [sourceChecksum, measurementCode, String(value), unit]),
      label, measurementCode, displayName: measurementType?.display ?? toDisplayName(label), value, unit,
      observedAt: reportDate, confidence: measurementType ? "high" : "low", sourceText: line,
      included: !generatedCode, generatedCode
    });
  }
  if (!normalizedText) diagnostics.push("No text was extracted from the report.");
  if (!reportDate) diagnostics.push("No report date was detected; confirm the date before saving.");
  if (rows.size === 0 && normalizedText) diagnostics.push("No blood-test measurements were detected in the extracted text.");
  return {
    fileName, reportDate, sourceText: normalizedText, checksum: sourceChecksum,
    parserVersion: "body-composition-text-v1", diagnostics: diagnostics.slice(0, 50), rows: [...rows.values()]
  };
}

export function buildBloodTestImportFromDraft(
  payload: BloodTestDraftCommitPayload,
  importedAt = new Date().toISOString()
): ParsedImport {
  const imported = buildManualObservationImport({
    observedAt: payload.reportDate ?? importedAt,
    label: payload.fileName,
    observations: payload.rows.filter((row) => row.included).map((row) => ({
      measurementName: row.displayName || row.label,
      measurementCode: row.measurementCode,
      value: Number(row.value),
      unit: row.unit
    }))
  }, importedAt, "lab_panel");
  imported.sourceImport.sourceKind = "blood-test-report";
  imported.sourceImport.fileName = payload.fileName;
  imported.sourceImport.parserVersion = "blood-test-report-v1";
  imported.sourceImport.rawContent = payload.sourceText;
  imported.dataSource.sourceKind = "blood-test-report";
  imported.dataSource.label = `Blood test report: ${payload.fileName}`;
  return imported;
}

interface BodyCompositionLineCandidate {
  label: string;
  value: number;
  unit?: string;
  confidence: BodyCompositionDraftConfidence;
}

const knownBodyCompositionLabels = [
  "body fat percentage",
  "body fat",
  "fat %",
  "percent body fat",
  "skeletal muscle mass",
  "muscle mass",
  "fat mass",
  "body fat mass",
  "lean body mass",
  "lean mass",
  "fat free mass",
  "ffm",
  "body mass index",
  "bmi",
  "visceral fat level",
  "visceral fat rating",
  "visceral fat",
  "total body water",
  "tbw %",
  "tbw",
  "bw",
  "body water percentage",
  "body water",
  "basal metabolic rate",
  "bmr",
  "bone mineral content",
  "bone mass",
  "mineral",
  "protein mass",
  "protein",
  "weight"
];

function parseBodyCompositionLine(line: string): BodyCompositionLineCandidate[] {
  const normalizedLine = line.replace(/\s+/g, " ").trim();
  const lowerLine = normalizedLine.toLowerCase();
  const ocrFatPercent = normalizedLine.match(/\b(?:fat|frt|ert)\s*[%¥]\s*(-?\d+(?:[.,]\s*\d+)?)/i);
  if (ocrFatPercent) {
    const value = readNumber(ocrFatPercent[1]);
    return value === undefined ? [] : [{ label: "body fat percentage", value, unit: "%", confidence: "medium" }];
  }
  const candidates: BodyCompositionLineCandidate[] = [];
  for (const label of knownBodyCompositionLabels) {
    if (label === "tbw" && /\btbw\s*%/i.test(normalizedLine)) {
      continue;
    }
    const labelIndex = findBodyCompositionLabelIndex(lowerLine, label);
    if (labelIndex === -1) {
      continue;
    }
    const tail = normalizedLine.slice(labelIndex + label.length);
    const values = readMeasurementValues(tail || normalizedLine);
    const measurementType = findMeasurementType(label);
    const best = pickBodyCompositionValue(values, measurementType?.canonicalUnit);
    if (best) {
      candidates.push({ label, ...best, confidence: "high" });
    }
  }
  if (candidates.length > 0) {
    return candidates;
  }
  const generic = normalizedLine.match(/^([A-Za-z][A-Za-z /()%.-]{2,80}?)\s*[:\-]?\s*(-?\d+(?:[.,]\s*\d+)?)\s*([A-Za-z%/]+)?\b/);
  if (!generic) {
    return [];
  }
  const label = generic[1]?.trim();
  const value = readNumber(generic[2]);
  if (!label || value === undefined || looksLikeDateOnly(normalizedLine)) {
    return [];
  }
  return [{ label, value, unit: generic[3], confidence: "low" }];
}

function findBodyCompositionLabelIndex(line: string, label: string): number {
  const pattern = label.split(/\s+/).map(escapeRegExp).join("\\s+");
  const match = line.match(new RegExp(`(^|[^a-z0-9])(${pattern})(?=$|[^a-z0-9])`, "i"));
  return match?.index === undefined ? -1 : match.index + (match[1]?.length ?? 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readMeasurementValues(valueText: string): Array<{ value: number; unit?: string }> {
  const values: Array<{ value: number; unit?: string }> = [];
  const pattern = /(-?\d+(?:[.,]\s*\d+)?)\s*(kg\/m(?:2|²)|kg\/m\^2|kcal|cal|kig|kg|lbs?|pounds?|liters?|litres?|[lL]|%|level|score)?/g;
  for (const match of valueText.matchAll(pattern)) {
    const value = readNumber(match[1]);
    if (value === undefined) {
      continue;
    }
    values.push({ value, unit: match[2] });
  }
  return values;
}

function pickBodyCompositionValue(values: Array<{ value: number; unit?: string }>, canonicalUnit?: string): { value: number; unit?: string } | undefined {
  if (!canonicalUnit) {
    return values[0];
  }
  const normalizedCanonicalUnit = normalizeBodyCompositionUnit(canonicalUnit);
  return values.find((item) => item.unit && normalizeBodyCompositionUnit(item.unit) === normalizedCanonicalUnit) ?? values[0];
}

function isPlausibleBodyCompositionValue(measurementCode: string, value: number, unit: string): boolean {
  if (!Number.isFinite(value)) return false;
  if (measurementCode === "body_fat_pct" || measurementCode === "body_water_pct") return value >= 1 && value <= 100;
  if (measurementCode === "bmi") return value >= 5 && value <= 90;
  if (measurementCode === "visceral_fat_level") return value >= 0 && value <= 100;
  if (measurementCode === "basal_metabolic_rate") return value >= 500 && value <= 5000;
  if (measurementCode === "weight") return value >= 10 && value <= 500;
  if (["fat_mass", "lean_body_mass", "skeletal_muscle_mass", "total_body_water", "bone_mineral_content", "protein_mass"].includes(measurementCode)) {
    return value >= 0 && value <= 300 && unit !== "%";
  }
  return true;
}

function normalizeBodyCompositionUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "lbs" || normalized === "lb" || normalized === "pounds" || normalized === "pound") return "lb";
  if (normalized === "l" || normalized === "liter" || normalized === "liters" || normalized === "litre" || normalized === "litres") return "L";
  if (normalized === "kig") return "kg";
  if (normalized === "cal") return "kcal";
  if (normalized === "kg/m²" || normalized === "kg/m^2") return "kg/m2";
  return unit.trim();
}

const maxDateWhitespaceGap = 20;
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

function readBodyCompositionDate(text: string): string | undefined {
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
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function readDateFromFileName(fileName: string): string | undefined {
  const compact = fileName.match(/(\d{1,2})([A-Za-z]{3,9})(\d{4})/);
  if (compact) {
    return readDate(`${compact[1]} ${compact[2]} ${compact[3]}`);
  }
  const monthFirstCompact = fileName.match(/([A-Za-z]{3,9})(\d{1,2})(\d{4})/);
  if (monthFirstCompact) {
    return readDate(`${monthFirstCompact[1]} ${monthFirstCompact[2]} ${monthFirstCompact[3]}`);
  }
  const separated = fileName.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})|(\d{1,2})[-_](\d{1,2})[-_](\d{2,4})/);
  if (!separated) {
    return undefined;
  }
  return readDate(separated[0].replace(/_/g, "-"));
}

function looksLikeDateOnly(value: string): boolean {
  return /^\D*\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}\D*$/.test(value);
}

function fallbackBodyCompositionCode(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return normalized ? `body_comp_${normalized}` : `body_comp_${stableId("field", [value])}`;
}

function toDisplayName(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${checksum(parts.join("|")).replace(/^sha256-/, "")}`;
}

function normalizeKeys(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, ""),
      value
    ])
  );
}

function readNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/,/g, "").replace(/(\d)[ ]+([.,])[ ]+(\d)/g, "$1$2$3").replace(/([.,])[ ]+(\d)/g, "$1$2");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readDate(value: string | undefined): string | undefined {
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

function parseStructuredDate(value: string): StructuredDate | undefined {
  const dateTimeMatch = value.match(/^(.*?)(?:\s+(\d{1,2})(?::(\d{2}))(?::(\d{2}))?)?$/);
  if (!dateTimeMatch) {
    return undefined;
  }

  const datePart = dateTimeMatch[1]?.trim();
  if (!datePart) {
    return undefined;
  }

  const hour = Number.parseInt(dateTimeMatch[2] ?? "0", 10);
  const minute = Number.parseInt(dateTimeMatch[3] ?? "0", 10);
  const second = Number.parseInt(dateTimeMatch[4] ?? "0", 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return undefined;
  }

  const ymd = datePart.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) {
    return normalizeStructuredDate(Number.parseInt(ymd[1], 10), Number.parseInt(ymd[2], 10), Number.parseInt(ymd[3], 10), hour, minute, second);
  }

  const dayMonthNameYear = datePart.match(/^(\d{1,2})[\/\-.]([A-Za-z]{3,9})[\/\-.](\d{2,4})$/);
  if (dayMonthNameYear) {
    const month = monthNameToIndex[dayMonthNameYear[2].toLowerCase()];
    if (!month) {
      return undefined;
    }
    return normalizeStructuredDate(Number.parseInt(dayMonthNameYear[3], 10), month, Number.parseInt(dayMonthNameYear[1], 10), hour, minute, second);
  }

  const monthNameDayYear = datePart.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (monthNameDayYear) {
    const month = monthNameToIndex[monthNameDayYear[1].toLowerCase()];
    if (!month) {
      return undefined;
    }
    return normalizeStructuredDate(Number.parseInt(monthNameDayYear[3], 10), month, Number.parseInt(monthNameDayYear[2], 10), hour, minute, second);
  }

  const ambiguousNumeric = datePart.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (ambiguousNumeric) {
    const first = Number.parseInt(ambiguousNumeric[1], 10);
    const secondPart = Number.parseInt(ambiguousNumeric[2], 10);
    const year = Number.parseInt(ambiguousNumeric[3], 10);
    if (first > 12) {
      return normalizeStructuredDate(year, secondPart, first, hour, minute, second);
    }
    if (secondPart > 12) {
      return normalizeStructuredDate(year, first, secondPart, hour, minute, second);
    }
    // Preserve prior behavior for ambiguous values where both month/day are <= 12.
    return normalizeStructuredDate(year, first, secondPart, hour, minute, second);
  }

  return undefined;
}

function normalizeStructuredDate(year: number, month: number, day: number, hour: number, minute: number, second: number): StructuredDate | undefined {
  const normalizedYear = year < 100 ? 2000 + year : year;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const normalized = new Date(Date.UTC(normalizedYear, month - 1, day, hour, minute, second));
  if (
    normalized.getUTCFullYear() !== normalizedYear ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { year: normalizedYear, month, day, hour, minute, second };
}

function fallbackMeasurementCode(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return normalized ? `manual_${normalized}` : `manual_${cryptoId("marker_code")}`;
}

function cryptoId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}
