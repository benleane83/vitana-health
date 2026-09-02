import type { Observation, ObservationGroup } from "./types.js";
import { findMeasurementType } from "./measurementRegistry.js";
import {
  checksum,
  escapeRegExp,
  fallbackBodyCompositionCode,
  isAdministrativeMeasurementLabel,
  looksLikeDateOnly,
  normalizeBodyCompositionUnit,
  readDate,
  readDateFromFileName,
  readNumber,
  readReportDate,
  stableId,
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
  const eufyCandidates = parseEufyTileCandidates(lines);
  const isEufyTileLayout = eufyCandidates.length >= 4;
  addBodyCompositionCandidates(rows, eufyCandidates, sourceChecksum, reportDate, diagnostics);

  let skippingHistory = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/\bdesirable\s+range\b/i.test(line)) break;
    if (isBodyCompositionHistoryHeading(line)) {
      skippingHistory = true;
      diagnostics.push("Skipped measurements in a body composition history section.");
      continue;
    }
    if (skippingHistory) {
      if (!isBodyCompositionHistoryEndHeading(line)) continue;
      skippingHistory = false;
    }
    if (isEufyTileLayout) continue;
    const parseLine = /\bbmr\b/i.test(line) && lines[index + 1] ? `${line} ${lines[index + 1]}` : line;
    const candidates = parseBodyCompositionLine(parseLine);
    addBodyCompositionCandidates(rows, candidates.map((candidate) => ({ ...candidate, sourceText: line })), sourceChecksum, reportDate, diagnostics);
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
      note: "Body composition report: scanned from phone",
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
      label: "Body composition report: scanned from phone",
      importId,
      createdAt: importedAt
    },
    observations,
    observationGroups: [group],
    timeSeriesSamples: [],
    measurementAggregates: [],
    activitySessions: []
  };
}

interface BodyCompositionLineCandidate {
  label: string;
  value: number;
  unit?: string;
  confidence: BodyCompositionDraftConfidence;
  sourceText?: string;
}

function addBodyCompositionCandidates(
  rows: Map<string, BodyCompositionDraftRow>,
  candidates: BodyCompositionLineCandidate[],
  sourceChecksum: string,
  reportDate: string | undefined,
  diagnostics: string[]
): void {
  for (const candidate of candidates) {
    if (isAdministrativeMeasurementLabel(candidate.label)) {
      diagnostics.push(`Skipped administrative identifier: "${candidate.label}".`);
      continue;
    }
    const knownMeasurement = findMeasurementType(candidate.label);
    const measurementType = knownMeasurement?.category === "body" ? knownMeasurement : undefined;
    if (!measurementType) {
      diagnostics.push(`Skipped unrecognized body-composition measurement: "${candidate.label}".`);
      continue;
    }
    const measurementCode = measurementType.code;
    const displayName = measurementType.display;
    const unit = normalizeBodyCompositionUnit(candidate.unit || measurementType.canonicalUnit);
    const key = `${measurementCode}:${candidate.value}:${unit}`;
    if (rows.has(key)) continue;
    if (!isPlausibleBodyCompositionValue(measurementCode, candidate.value, unit)) {
      diagnostics.push(`Skipped implausible body-composition measurement: "${displayName}" (${candidate.value} ${unit}).`);
      continue;
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
      sourceText: candidate.sourceText ?? candidate.label,
      included: true,
      generatedCode: false
    });
  }
}

function parseEufyTileCandidates(lines: string[]): BodyCompositionLineCandidate[] {
  const eufySignalCount = lines.filter((line) => /body\s*fat\s*%.*\bwater\b|(?:\bbmr\b|\bemr\b).*\bvisceral\b|bone\s*mass.*\bmuscle\b/i.test(line)).length;
  if (eufySignalCount < 2) return [];

  const candidates: BodyCompositionLineCandidate[] = [];
  const addPair = (
    labelPattern: RegExp,
    labels: readonly [string, string],
    units: readonly [string, string],
    valuePattern?: (values: Array<{ value: number; unit?: string }>) => boolean
  ) => {
    const index = lines.findIndex((line) => labelPattern.test(line));
    if (index === -1) return;
    const valueLine = lines.slice(index + 1, index + 5).find((line) => {
      const values = readEufyTileValues(line);
      return values.length >= 2 && (!valuePattern || valuePattern(values));
    });
    if (!valueLine) return;
    const values = readEufyTileValues(valueLine);
    candidates.push(
      { label: labels[0], value: values[0].value, unit: units[0], confidence: "medium", sourceText: `${lines[index]} ${valueLine}` },
      { label: labels[1], value: values[1].value, unit: units[1], confidence: "medium", sourceText: `${lines[index]} ${valueLine}` }
    );
  };

  addPair(/(?:wei[^\s]*ht|weic?ht).*(?:\bbmi\b|\bmi\b)/i, ["weight", "bmi"], ["kg", "kg/m2"]);
  addPair(/body\s*fat\s*%.*\bwater\b/i, ["body fat percentage", "body water percentage"], ["%", "%"]);
  addPair(/(?:\bbmr\b|\bemr\b).*\bvisceral\b/i, ["bmr", "visceral fat level"], ["kcal/day", "level"]);
  addPair(/bone\s*mass.*\bmuscle\b/i, ["bone mass", "muscle mass"], ["kg", "kg"], (values) => values.slice(0, 2).every((value) => normalizeBodyCompositionUnit(value.unit ?? "") === "kg"));
  addEufyTopRowCandidates(candidates, lines);
  repairEufyBodyWaterValue(candidates);
  addEufyMassCandidates(candidates, lines);

  return candidates;
}

function readEufyTileValues(line: string): Array<{ value: number; unit?: string }> {
  // Tesseract occasionally separates the two leading digits of a decimal tile value, e.g. "3 8 . 8 kg".
  const normalizedLine = line
    .replace(/(\d)\s+(\d)(?=\s*[.,]\s*\d)/g, "$1$2")
    .replace(/(\b\d)\s+(\d{3})(?=\s*(?:kcal|cal)\b)/gi, "$1$2")
    .replace(/\s*([.,])\s*/g, "$1");
  return readMeasurementValues(normalizedLine);
}

function addEufyTopRowCandidates(candidates: BodyCompositionLineCandidate[], lines: string[]): void {
  if (candidates.some((candidate) => candidate.label === "weight")) return;
  const bodyFatIndex = lines.findIndex((line) => /body\s*fat\s*%.*\bwater\b/i.test(line));
  const topValues = lines.slice(0, Math.max(0, bodyFatIndex)).find((line) => {
    const values = readEufyTileValues(line);
    return values.length >= 2 && values[0].value >= 10 && values[0].value <= 500 && values[1].value >= 5 && values[1].value <= 90;
  });
  if (!topValues) return;
  const values = readEufyTileValues(topValues);
  candidates.push(
    { label: "weight", value: values[0].value, unit: "kg", confidence: "medium", sourceText: topValues },
    { label: "bmi", value: values[1].value, unit: "kg/m2", confidence: "medium", sourceText: topValues }
  );
}

function repairEufyBodyWaterValue(candidates: BodyCompositionLineCandidate[]): void {
  const bodyWater = candidates.find((candidate) => candidate.label === "body water percentage");
  // Eufy's green "5" is commonly read as "9"; values above 80% are not physiologically plausible.
  if (bodyWater && bodyWater.value > 80 && bodyWater.value < 100) {
    bodyWater.value = Math.round((bodyWater.value - 40) * 10) / 10;
  }
}

function addEufyMassCandidates(candidates: BodyCompositionLineCandidate[], lines: string[]): void {
  const weight = candidates.find((candidate) => candidate.label === "weight")?.value;
  const boneMassIndex = lines.findIndex((line) => /bone\s*mass.*\bmuscle\b/i.test(line));
  if (!weight || boneMassIndex === -1) return;
  const massLine = lines.slice(Math.max(0, boneMassIndex - 5), boneMassIndex).reverse().find((line) => {
    const values = readEufyTileValues(line);
    return values.some((value) => normalizeBodyCompositionUnit(value.unit ?? "") === "kg" && value.value > 0 && value.value < weight);
  });
  if (!massLine) return;
  const fatMass = readEufyTileValues(massLine)
    .filter((value) => normalizeBodyCompositionUnit(value.unit ?? "") === "kg" && value.value > 0 && value.value < weight)
    .at(-1);
  if (!fatMass) return;
  const leanBodyMass = Math.round((weight - fatMass.value) * 10) / 10;
  candidates.push(
    { label: "body fat mass", value: fatMass.value, unit: "kg", confidence: "medium", sourceText: massLine },
    { label: "lean body mass", value: leanBodyMass, unit: "kg", confidence: "low", sourceText: massLine }
  );
}

function isBodyCompositionHistoryHeading(line: string): boolean {
  return compactHeading(line).includes("bodycompositionhistory");
}

function isBodyCompositionHistoryEndHeading(line: string): boolean {
  const heading = compactHeading(line);
  return [
    "inbody",
    "inbodyscore",
    "weightcontrol",
    "obesityevaluation",
    "bodybalanceevaluation",
    "segmentalfatanalysis",
    "additionaldata",
    "impedance"
  ].some((prefix) => heading.startsWith(prefix));
}

function compactHeading(line: string): string {
  return line.toLowerCase().replace(/[^a-z]/g, "");
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
    if (candidates.some((candidate) => candidate.label.includes(label))) continue;
    const labelIndex = findBodyCompositionLabelIndex(lowerLine, label);
    if (labelIndex === -1) continue;
    const tail = normalizedLine.slice(labelIndex + label.length);
    const values = readMeasurementValues(tail || normalizedLine);
    const measurementType = findMeasurementType(label);
    const best = pickBodyCompositionValue(values, measurementType?.canonicalUnit);
    if (best) candidates.push({ label, ...best, confidence: "high" });
  }
  if (candidates.length > 0) return candidates;
  if (normalizedLine.length > 256) return [];
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
  if (["fat_mass", "lean_body_mass", "muscle_mass", "skeletal_muscle_mass", "total_body_water", "bone_mineral_content", "protein_mass"].includes(measurementCode)) {
    return value >= 0 && value <= 300 && unit !== "%";
  }
  return true;
}
