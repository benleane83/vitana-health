import type {
  ActivitySession,
  DataSource,
  LabResultMarker,
  LabResultPanel,
  Observation,
  SourceImport,
  TimeSeriesSample
} from "./types.js";
import { findMeasurementType } from "./registry.js";

export interface ParsedImport {
  sourceImport: SourceImport;
  dataSource: DataSource;
  observations: Observation[];
  timeSeriesSamples: TimeSeriesSample[];
  activitySessions: ActivitySession[];
  labPanels: LabResultPanel[];
  labMarkers: LabResultMarker[];
}

export interface ManualLabEntryMarkerInput {
  markerName?: string;
  markerCode?: string;
  value: number;
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
}

export interface ManualLabEntryPayload {
  collectedAt: string;
  panelName: string;
  labName?: string;
  markers: ManualLabEntryMarkerInput[];
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
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
  const importId = cryptoId("import");
  const sourceId = cryptoId("source");
  const panelId = cryptoId("panel");
  const diagnostics: string[] = [];
  const panel: LabResultPanel = {
    id: panelId,
    collectedAt: readDate(rows[0]?.collectedAt ?? rows[0]?.collected_at ?? rows[0]?.date) ?? importedAt,
    labName: rows[0]?.labName ?? rows[0]?.lab_name,
    panelName: rows[0]?.panelName ?? rows[0]?.panel_name ?? "Blood test panel",
    sourceId
  };
  const markers: LabResultMarker[] = [];
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
    const referenceLow = readNumber(normalized.reference_low ?? normalized.ref_low ?? normalized.low);
    const referenceHigh = readNumber(normalized.reference_high ?? normalized.ref_high ?? normalized.high);
    const marker: LabResultMarker = {
      id: cryptoId("marker"),
      panelId,
      measurementCode: measurementType.code,
      displayName: label || measurementType.display,
      value,
      unit: normalized.unit || measurementType.canonicalUnit,
      referenceLow,
      referenceHigh,
      flag: readFlag(value, referenceLow, referenceHigh)
    };
    markers.push(marker);
    observations.push({
      id: cryptoId("obs"),
      measurementCode: measurementType.code,
      observedAt: panel.collectedAt,
      value,
      unit: marker.unit,
      sourceId,
      note: `Lab marker from ${panel.panelName}`,
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
      checksum: checksum(content),
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
    timeSeriesSamples: [],
    activitySessions: [],
    labPanels: [panel],
    labMarkers: markers
  };
}

export function buildManualLabEntryImport(payload: ManualLabEntryPayload, importedAt = new Date().toISOString()): ParsedImport {
  const importId = cryptoId("import");
  const sourceId = cryptoId("source");
  const panelId = cryptoId("panel");
  const diagnostics: string[] = [];
  const panelName = payload.panelName.trim() || "Manual lab panel";
  const panel: LabResultPanel = {
    id: panelId,
    collectedAt: readDate(payload.collectedAt) ?? importedAt,
    labName: payload.labName?.trim() || undefined,
    panelName,
    sourceId
  };
  const markers: LabResultMarker[] = [];
  const observations: Observation[] = [];

  for (const row of payload.markers) {
    const markerName = row.markerName?.trim();
    const markerCode = row.markerCode?.trim();
    const measurementType = markerCode
      ? findMeasurementType(markerCode) ?? (markerName ? findMeasurementType(markerName) : undefined)
      : markerName
        ? findMeasurementType(markerName)
        : undefined;
    const value = row.value;
    if (!Number.isFinite(value)) {
      diagnostics.push(`Skipped manual marker with invalid value: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }
    if (!measurementType && !markerName && !markerCode) {
      diagnostics.push(`Skipped manual marker with no name or code: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }
    const referenceLow = row.referenceLow;
    const referenceHigh = row.referenceHigh;
    const displayName = markerName || measurementType?.display || markerCode || "Manual marker";
    const measurementCode = measurementType?.code || markerCode || fallbackMeasurementCode(displayName);
    const marker: LabResultMarker = {
      id: cryptoId("marker"),
      panelId,
      measurementCode,
      displayName,
      value,
      unit: row.unit?.trim() || measurementType?.canonicalUnit || "unknown",
      referenceLow,
      referenceHigh,
      flag: readFlag(value, referenceLow, referenceHigh)
    };
    markers.push(marker);
    observations.push({
      id: cryptoId("obs"),
      measurementCode,
      observedAt: panel.collectedAt,
      value,
      unit: marker.unit,
      sourceId,
      note: `Lab marker from ${panel.panelName}`,
      sourceJson: row
    });
  }

  const serializedPayload = JSON.stringify({
    collectedAt: panel.collectedAt,
    panelName: panel.panelName,
    labName: panel.labName,
    markers: payload.markers
  });
  const fileName = `${panel.panelName.replace(/\s+/g, "-").toLowerCase()}-${panel.collectedAt.slice(0, 10)}.manual-entry`;

  return {
    sourceImport: {
      id: importId,
      sourceKind: "manual-entry",
      fileName,
      importedAt,
      parserVersion: "manual-lab-entry-v1",
      checksum: checksum(serializedPayload),
      rowCount: payload.markers.length,
      status: diagnostics.length > payload.markers.length / 2 ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25),
      rawContent: serializedPayload
    },
    dataSource: {
      id: sourceId,
      sourceKind: "manual-entry",
      label: `Manual lab entry: ${panel.panelName}`,
      importId,
      createdAt: importedAt
    },
    observations,
    timeSeriesSamples: [],
    activitySessions: [],
    labPanels: [panel],
    labMarkers: markers
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
    timeSeriesSamples: [],
    activitySessions: [],
    labPanels: [],
    labMarkers: []
  };
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

function readBodyCompositionDate(text: string): string | undefined {
  const datePatterns = [
    /(?:test|scan|report|measurement|measured|date)\s*(?:date)?\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /(?:test|scan|report|measurement|measured|date)\s*(?:date)?\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
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
  return `${prefix}_${checksum(parts.join("|")).replace(/^fnv1a-/, "")}`;
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
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function readFlag(value: number, low?: number, high?: number): LabResultMarker["flag"] {
  if (low !== undefined && value < low) return "low";
  if (high !== undefined && value > high) return "high";
  if (low !== undefined || high !== undefined) return "normal";
  return "unknown";
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
