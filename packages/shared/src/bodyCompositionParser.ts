import type { Observation, ObservationGroup } from "./types.js";
import { findMeasurementType } from "./measurementRegistry.js";
import {
  checksum,
  escapeRegExp,
  fallbackBodyCompositionCode,
  looksLikeDateOnly,
  normalizeBodyCompositionUnit,
  readDate,
  readDateFromFileName,
  readNumber,
  readReportDate,
  stableId,
  toDisplayName
} from "./parserPrimitives.js";
import type {
  BodyCompositionDraft,
  BodyCompositionDraftCommitPayload,
  BodyCompositionDraftConfidence,
  BodyCompositionDraftRow,
  ParsedImport
} from "./parserTypes.js";

export function parseBodyCompositionText(fileName: string, sourceText: string, importedAt = new Date().toISOString()): BodyCompositionDraft {
  const normalizedText = sourceText.replace(/\r/g, "").trim();
  const sourceChecksum = checksum(normalizedText || fileName);
  const diagnostics: string[] = [];
  const reportDate = readReportDate(normalizedText) ?? readDateFromFileName(fileName);
  const rows = new Map<string, BodyCompositionDraftRow>();

  const lines = normalizedText.split("\n").map((item) => item.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/\bdesirable\s+range\b/i.test(line)) break;
    const parseLine = /\bbmr\b/i.test(line) && lines[index + 1] ? `${line} ${lines[index + 1]}` : line;
    const candidates = parseBodyCompositionLine(parseLine);
    for (const candidate of candidates) {
      const measurementType = findMeasurementType(candidate.label);
      const measurementCode = measurementType?.code ?? fallbackBodyCompositionCode(candidate.label);
      const displayName = measurementType?.display ?? toDisplayName(candidate.label);
      const unit = normalizeBodyCompositionUnit(candidate.unit || measurementType?.canonicalUnit || "unknown");
      const key = `${measurementCode}:${candidate.value}:${unit}`;
      if (rows.has(key)) continue;
      const generatedCode = !measurementType;
      if (generatedCode) diagnostics.push(`Used generated body-composition code for "${candidate.label}".`);
      const included = !generatedCode && isPlausibleBodyCompositionValue(measurementCode, candidate.value, unit);
      if (!included && !generatedCode) diagnostics.push(`Review unusual body-composition value for "${displayName}": ${candidate.value} ${unit}.`);
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

  if (!normalizedText) diagnostics.push("No text was extracted from the report.");
  if (!reportDate) diagnostics.push("No report date was detected; confirm the date before saving.");
  if (rows.size === 0 && normalizedText) diagnostics.push("No body-composition measurements were detected in the extracted text.");

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

export function buildBodyCompositionImportFromDraft(payload: BodyCompositionDraftCommitPayload, importedAt = new Date().toISOString()): ParsedImport {
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
    label: "Body",
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
      rawContent: JSON.stringify({ fileName: payload.fileName, reportDate: observedAt, sourceChecksum, sourceText: payload.sourceText, rows: includedRows })
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

interface BodyCompositionLineCandidate {
  label: string;
  value: number;
  unit?: string;
  confidence: BodyCompositionDraftConfidence;
}

const knownBodyCompositionLabels = [
  "body fat percentage", "body fat", "fat %", "percent body fat", "skeletal muscle mass", "muscle mass",
  "fat mass", "body fat mass", "lean body mass", "lean mass", "fat free mass", "ffm", "body mass index",
  "bmi", "visceral fat level", "visceral fat rating", "visceral fat", "total body water", "tbw %", "tbw",
  "bw", "body water percentage", "body water", "basal metabolic rate", "bmr", "bone mineral content",
  "bone mass", "mineral", "protein mass", "protein", "weight"
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
    if (label === "tbw" && /\btbw\s*%/i.test(normalizedLine)) continue;
    const labelIndex = findBodyCompositionLabelIndex(lowerLine, label);
    if (labelIndex === -1) continue;
    const tail = normalizedLine.slice(labelIndex + label.length);
    const values = readMeasurementValues(tail || normalizedLine);
    const measurementType = findMeasurementType(label);
    const best = pickBodyCompositionValue(values, measurementType?.canonicalUnit);
    if (best) candidates.push({ label, ...best, confidence: "high" });
  }
  if (candidates.length > 0) return candidates;
  const generic = normalizedLine.match(/^([A-Za-z][A-Za-z /()%.-]{2,80}?)\s*[:\-]?\s*(-?\d+(?:[.,]\s*\d+)?)\s*([A-Za-z%/]+)?\b/);
  if (!generic) return [];
  const label = generic[1]?.trim();
  const value = readNumber(generic[2]);
  if (!label || value === undefined || looksLikeDateOnly(normalizedLine)) return [];
  return [{ label, value, unit: generic[3], confidence: "low" }];
}

function findBodyCompositionLabelIndex(line: string, label: string): number {
  const pattern = label.split(/\s+/).map(escapeRegExp).join("\\s+");
  const match = line.match(new RegExp(`(^|[^a-z0-9])(${pattern})(?=$|[^a-z0-9])`, "i"));
  return match?.index === undefined ? -1 : match.index + (match[1]?.length ?? 0);
}

function readMeasurementValues(valueText: string): Array<{ value: number; unit?: string }> {
  const values: Array<{ value: number; unit?: string }> = [];
  const pattern = /(-?\d+(?:[.,]\s*\d+)?)\s*(kg\/m(?:2|²)|kg\/m\^2|kcal|cal|kig|kg|lbs?|pounds?|liters?|litres?|[lL]|%|level|score)?/g;
  for (const match of valueText.matchAll(pattern)) {
    const value = readNumber(match[1]);
    if (value !== undefined) values.push({ value, unit: match[2] });
  }
  return values;
}

function pickBodyCompositionValue(values: Array<{ value: number; unit?: string }>, canonicalUnit?: string): { value: number; unit?: string } | undefined {
  if (!canonicalUnit) return values[0];
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
