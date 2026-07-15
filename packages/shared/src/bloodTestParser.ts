import { defaultMeasurementTypes } from "./registry.js";
import { findMeasurementType } from "./measurementRegistry.js";
import { buildManualObservationImport } from "./observationImportParsers.js";
import {
  checksum,
  escapeRegExp,
  fallbackMeasurementCode,
  looksLikeDateOnly,
  normalizeStructuredDate,
  readDateFromFileName,
  readNumber,
  readReportDate,
  stableId,
  toDisplayName
} from "./parserPrimitives.js";
import type {
  BloodTestDraft,
  BloodTestDraftCommitPayload,
  BodyCompositionDraftRow,
  ParsedImport
} from "./parserTypes.js";

export function parseBloodTestScanText(fileName: string, sourceText: string, importedAt = new Date().toISOString()): BloodTestDraft {
  const normalizedText = sourceText.replace(/\r/g, "").trim();
  const sourceChecksum = checksum(normalizedText || fileName);
  const diagnostics: string[] = [];
  const reportDate = readBloodTestReportDate(normalizedText) ?? readReportDate(normalizedText) ?? readDateFromFileName(fileName);
  const rows = new Map<string, BodyCompositionDraftRow>();
  for (const line of normalizedText.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const knownCandidate = parseKnownBloodTestLine(line);
    if (knownCandidate) {
      const { measurementType, value, unit } = knownCandidate;
      const key = `${measurementType.code}:${value}:${unit}`;
      if (!rows.has(key)) {
        rows.set(key, {
          id: stableId("draft", [sourceChecksum, measurementType.code, String(value), unit]),
          label: measurementType.display,
          measurementCode: measurementType.code,
          displayName: measurementType.display,
          value,
          unit,
          observedAt: reportDate,
          confidence: "high",
          sourceText: line,
          included: true,
          generatedCode: false
        });
      }
      continue;
    }
    if (containsCalendarDate(line)) continue;
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
      label,
      measurementCode,
      displayName: measurementType?.display ?? toDisplayName(label),
      value,
      unit,
      observedAt: reportDate,
      confidence: measurementType ? "high" : "low",
      sourceText: line,
      included: !generatedCode,
      generatedCode
    });
  }
  if (!normalizedText) diagnostics.push("No text was extracted from the report.");
  if (!reportDate) diagnostics.push("No report date was detected; confirm the date before saving.");
  if (rows.size === 0 && normalizedText) diagnostics.push("No blood-test measurements were detected in the extracted text.");
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

export function buildBloodTestImportFromDraft(payload: BloodTestDraftCommitPayload, importedAt = new Date().toISOString()): ParsedImport {
  const imported = buildManualObservationImport({
    observedAt: payload.reportDate ?? importedAt,
    label: "Lab",
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

function parseKnownBloodTestLine(line: string): {
  measurementType: (typeof defaultMeasurementTypes)[number];
  value: number;
  unit: string;
} | undefined {
  const normalizedLine = line.replace(/\s+/g, " ").trim();
  const candidates = defaultMeasurementTypes
    .filter((type) => type.category === "lab")
    .flatMap((measurementType) => [measurementType.display, ...measurementType.aliases].map((label) => ({ label, measurementType })))
    .sort((left, right) => right.label.length - left.label.length);

  for (const candidate of candidates) {
    const markerPattern = candidate.label.split(/\s+/).map(escapeRegExp).join("\\s+");
    const marker = normalizedLine.match(new RegExp(`(^|[^a-z0-9])(${markerPattern})(?=$|[^a-z0-9])`, "i"));
    if (marker?.index === undefined) continue;
    const markerEnd = marker.index + marker[0].length;
    const tail = normalizedLine.slice(markerEnd).replace(/^\s*(?:\([^)]*\)\s*)?[:\-=]?\s*/, "");
    const result = tail.match(/^(-?\d+(?:[.,]\d+)?)\s*([A-Za-zµμ%][A-Za-z0-9µμ%./^*-]*)?/);
    const value = readNumber(result?.[1]);
    if (value === undefined) continue;
    return { measurementType: candidate.measurementType, value, unit: normalizeBloodTestUnit(result?.[2], candidate.measurementType.canonicalUnit) };
  }
  return undefined;
}

function normalizeBloodTestUnit(unit: string | undefined, canonicalUnit: string): string {
  if (!unit) return canonicalUnit;
  const normalized = unit.toLowerCase().replace("μ", "µ");
  const normalizedCanonical = canonicalUnit.toLowerCase().replace("μ", "µ");
  if (normalized === normalizedCanonical || (normalized.startsWith("u") && `µ${normalized.slice(1)}` === normalizedCanonical)) return canonicalUnit;
  return unit;
}

function containsCalendarDate(value: string): boolean {
  return /\b\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}\b/.test(value);
}

function readBloodTestReportDate(text: string): string | undefined {
  const match = text.match(/(?:collection|collected|receiving|authorised|authorized|report)\s+date\s*[:\-]?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i);
  if (!match) return undefined;
  const structured = normalizeStructuredDate(
    Number.parseInt(match[3], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[1], 10),
    Number.parseInt(match[4] ?? "0", 10),
    Number.parseInt(match[5] ?? "0", 10),
    Number.parseInt(match[6] ?? "0", 10)
  );
  if (!structured) return undefined;
  return new Date(Date.UTC(structured.year, structured.month - 1, structured.day, structured.hour, structured.minute, structured.second)).toISOString();
}
