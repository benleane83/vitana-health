import type { Observation, ObservationGroup, UnitSystem } from "./types.js";
import { findMeasurementType, getPreferredUnit } from "./measurementRegistry.js";
import {
  checksum,
  fallbackMeasurementCode,
  normalizeKeys,
  parseCsv,
  readDate,
  readNumber,
  stableId
} from "./parserPrimitives.js";
import type {
  ManualLabEntryPayload,
  ManualObservationPayload,
  ParsedImport
} from "./parserTypes.js";

type DiagnosticSeverity = "info" | "error";

interface ImportDiagnostic {
  message: string;
  severity: DiagnosticSeverity;
}

function importStatus(diagnostics: readonly ImportDiagnostic[]): "processed" | "needs-review" {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "needs-review" : "processed";
}

function diagnosticMessages(diagnostics: readonly ImportDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.message);
}

export function parseBloodTestCsv(fileName: string, content: string, importedAt = new Date().toISOString(), units: UnitSystem = "metric"): ParsedImport {
  const rows = parseCsv(content);
  const sourceChecksum = checksum(content);
  const importId = stableId("import", ["blood-test-csv", fileName, sourceChecksum]);
  const sourceId = stableId("source", ["blood-test-csv", fileName, sourceChecksum]);
  const groupId = stableId("group", ["lab_panel", sourceChecksum]);
  const diagnostics: ImportDiagnostic[] = [];
  const collectedAt = readDate(rows[0]?.collectedAt ?? rows[0]?.collected_at ?? rows[0]?.date) ?? importedAt;
  const group: ObservationGroup = {
    id: groupId,
    kind: "lab_panel",
    label: rows[0]?.panelName ?? rows[0]?.panel_name ?? "Lab test panel",
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
      diagnostics.push({ severity: "error", message: `Skipped lab row with unrecognized marker or missing value: ${JSON.stringify(row).slice(0, 180)}` });
      continue;
    }
    const unit = normalized.unit || getPreferredUnit(measurementType, units);
    if (!normalized.unit) diagnostics.push({ severity: "info", message: `Used canonical unit for lab row with no unit: ${measurementType.display}.` });
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
      status: importStatus(diagnostics),
      diagnostics: diagnosticMessages(diagnostics).slice(0, 25),
      rawContent: content
    },
    dataSource: { id: sourceId, sourceKind: "blood-test-csv", label: `Lab test CSV: ${fileName}`, importId, createdAt: importedAt },
    observations,
    observationGroups: [group],
    timeSeriesSamples: [],
    measurementAggregates: [],
    activitySessions: []
  };
}

export function parseObservationCsv(fileName: string, content: string, importedAt = new Date().toISOString(), units: UnitSystem = "metric"): ParsedImport {
  const rows = parseCsv(content);
  const sourceChecksum = checksum(content);
  const importId = stableId("import", ["observation-csv", fileName, sourceChecksum]);
  const sourceId = stableId("source", ["observation-csv", fileName, sourceChecksum]);
  const diagnostics: ImportDiagnostic[] = [];
  const first = normalizeKeys(rows[0] ?? {});
  const observedAt = readDate(first.observed_at ?? first.collected_at ?? first.date) ?? importedAt;
  const label = first.label || first.panel_name || "Observation CSV";
  const sourceName = first.source_name?.trim();
  const groupId = stableId("group", ["observation-csv", sourceChecksum]);
  const group: ObservationGroup = {
    id: groupId,
    kind: "custom",
    label,
    sourceId,
    importId,
    collectedAt: observedAt,
    metadata: sourceName ? { sourceName } : {}
  };
  const observations: Observation[] = [];

  for (const row of rows) {
    const normalized = normalizeKeys(row);
    const name = normalized.measurement ?? normalized.measurement_name ?? normalized.marker ?? normalized.name ?? "";
    const code = normalized.measurement_code ?? normalized.marker_code;
    const measurementType = (code ? findMeasurementType(code) : undefined) ?? findMeasurementType(name);
    const value = readNumber(normalized.value ?? normalized.result);
    if (value === undefined || (!name && !code)) {
      diagnostics.push({ severity: "error", message: `Skipped observation row with missing measurement or value: ${JSON.stringify(row).slice(0, 180)}` });
      continue;
    }
    const measurementCode = measurementType?.code ?? code ?? fallbackMeasurementCode(name);
    if (!measurementType) diagnostics.push({ severity: "info", message: `Used generated code for "${name || code}".` });
    const unit = normalized.unit || (measurementType ? getPreferredUnit(measurementType, units) : "unknown");
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
      id: importId,
      sourceKind: "observation-csv",
      fileName,
      importedAt,
      parserVersion: "observation-csv-v1",
      checksum: sourceChecksum,
      rowCount: rows.length,
      status: importStatus(diagnostics),
      diagnostics: diagnosticMessages(diagnostics).slice(0, 25),
      rawContent: content
    },
    dataSource: { id: sourceId, sourceKind: "observation-csv", label: `Observation CSV: ${fileName}`, importId, createdAt: importedAt },
    observations,
    observationGroups: [group],
    timeSeriesSamples: [],
    measurementAggregates: [],
    activitySessions: []
  };
}

export function buildManualLabEntryImport(payload: ManualLabEntryPayload, importedAt = new Date().toISOString(), units: UnitSystem = "metric"): ParsedImport {
  return buildManualObservationImport({
    observedAt: payload.collectedAt,
    label: payload.panelName,
    sourceName: payload.labName,
    observations: payload.markers.map(({ markerName, markerCode, value, unit }) => ({ measurementName: markerName, measurementCode: markerCode, value, unit }))
  }, importedAt, "lab_panel", units);
}

export function buildManualObservationImport(
  payload: ManualObservationPayload,
  importedAt = new Date().toISOString(),
  groupKind: ObservationGroup["kind"] = "custom",
  units: UnitSystem = "metric"
): ParsedImport {
  const diagnostics: ImportDiagnostic[] = [];
  const panelName = payload.label.trim() || "Manual observations";
  const collectedAt = readDate(payload.observedAt) ?? importedAt;
  const serializedPayload = JSON.stringify({ collectedAt, panelName, sourceName: payload.sourceName?.trim(), observations: payload.observations });
  const sourceChecksum = checksum(serializedPayload);
  const importId = stableId("import", ["manual-entry", sourceChecksum]);
  const sourceId = stableId("source", ["manual-entry", sourceChecksum]);
  const groupId = stableId("group", ["lab_panel", sourceChecksum]);
  const sourceName = payload.sourceName?.trim();
  const group: ObservationGroup = {
    id: groupId,
    kind: groupKind,
    label: panelName,
    sourceId,
    importId,
    collectedAt,
    metadata: sourceName ? { sourceName } : {}
  };
  const observations: Observation[] = [];

  for (const row of payload.observations) {
    const markerName = row.measurementName?.trim();
    const markerCode = row.measurementCode?.trim();
    const measurementType = markerCode
      ? findMeasurementType(markerCode) ?? (markerName ? findMeasurementType(markerName) : undefined)
      : markerName ? findMeasurementType(markerName) : undefined;
    const value = row.value;
    if (!Number.isFinite(value)) {
      diagnostics.push({ severity: "error", message: `Skipped manual observation with invalid value: ${JSON.stringify(row).slice(0, 180)}` });
      continue;
    }
    if (!measurementType && !markerName && !markerCode) {
      diagnostics.push({ severity: "error", message: `Skipped manual observation with no name or code: ${JSON.stringify(row).slice(0, 180)}` });
      continue;
    }
    const displayName = markerName || measurementType?.display || markerCode || "Manual marker";
    const measurementCode = measurementType?.code || markerCode || fallbackMeasurementCode(displayName);
    const unit = row.unit?.trim() || (measurementType ? getPreferredUnit(measurementType, units) : "unknown");
    const note = row.note?.trim() || "Manual import";
    observations.push({
      id: stableId("obs", ["manual-entry", sourceChecksum, measurementCode, String(value), unit, note]),
      measurementCode,
      observedAt: collectedAt,
      value,
      unit,
      sourceId,
      observationGroupId: groupId,
      note,
      sourceJson: {
        ...(row.measurementName !== undefined ? { measurementName: row.measurementName } : {}),
        ...(row.measurementCode !== undefined ? { measurementCode: row.measurementCode } : {}),
        value: row.value,
        ...(row.unit !== undefined ? { unit: row.unit } : {}),
        ...(row.note !== undefined ? { note: row.note } : {})
      }
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
      status: importStatus(diagnostics),
      diagnostics: diagnosticMessages(diagnostics).slice(0, 25),
      rawContent: serializedPayload
    },
    dataSource: { id: sourceId, sourceKind: "manual-entry", label: `Manual observations: ${panelName}`, importId, createdAt: importedAt },
    observations,
    observationGroups: [group],
    timeSeriesSamples: [],
    measurementAggregates: [],
    activitySessions: []
  };
}
