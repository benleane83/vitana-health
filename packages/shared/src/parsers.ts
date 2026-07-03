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

export function parseSamsungHealthCsv(fileName: string, content: string, importedAt = new Date().toISOString()): ParsedImport {
  const rows = parseCsv(content);
  const importId = cryptoId("import");
  const sourceId = cryptoId("source");
  const diagnostics: string[] = [];
  const observations: Observation[] = [];
  const samples: TimeSeriesSample[] = [];
  const activities: ActivitySession[] = [];

  for (const row of rows) {
    const normalized = normalizeKeys(row);
    const metricName = normalized.type || normalized.metric || normalized.measurement || normalized.data_type || inferSamsungMetric(fileName, normalized);
    const measurementType = metricName ? findMeasurementType(metricName) : undefined;
    const value = readNumber(normalized.value ?? normalized.count ?? normalized.heart_rate ?? normalized.weight ?? normalized.duration);
    const observedAt = readDate(normalized.start_time ?? normalized.start_at ?? normalized.date_time ?? normalized.time ?? normalized.day_time ?? normalized.date);
    const endAt = readDate(normalized.end_time ?? normalized.end_at ?? normalized.end_date_time);

    if (normalized.exercise_type || normalized.activity_type || normalized.workout_type) {
      activities.push({
        id: cryptoId("activity"),
        activityType: normalized.exercise_type || normalized.activity_type || normalized.workout_type || "Workout",
        startAt: observedAt ?? importedAt,
        endAt,
        durationMinutes: readNumber(normalized.duration_min ?? normalized.duration_minutes ?? normalized.duration),
        energyKcal: readNumber(normalized.calorie ?? normalized.calories ?? normalized.energy_kcal),
        distanceMeters: readNumber(normalized.distance ?? normalized.distance_meter ?? normalized.distance_meters),
        sourceId
      });
      continue;
    }

    if (!measurementType || value === undefined || !observedAt) {
      diagnostics.push(`Skipped row with unrecognized metric or missing value/date: ${JSON.stringify(row).slice(0, 180)}`);
      continue;
    }

    if (measurementType.code === "steps" || measurementType.code === "heart_rate") {
      samples.push({
        id: cryptoId("sample"),
        measurementCode: measurementType.code,
        startAt: observedAt,
        endAt: endAt ?? observedAt,
        value,
        unit: normalized.unit || measurementType.canonicalUnit,
        sourceId
      });
    } else {
      observations.push({
        id: cryptoId("obs"),
        measurementCode: measurementType.code,
        observedAt,
        effectiveStart: observedAt,
        effectiveEnd: endAt,
        value,
        unit: normalized.unit || measurementType.canonicalUnit,
        sourceId,
        sourceJson: row
      });
    }
  }

  return {
    sourceImport: {
      id: importId,
      sourceKind: "samsung-health",
      fileName,
      importedAt,
      parserVersion: "samsung-csv-v1",
      checksum: checksum(content),
      rowCount: rows.length,
      status: diagnostics.length > rows.length / 2 ? "needs-review" : "processed",
      diagnostics: diagnostics.slice(0, 25),
      rawContent: content
    },
    dataSource: {
      id: sourceId,
      sourceKind: "samsung-health",
      label: `Samsung Health: ${fileName}`,
      importId,
      createdAt: importedAt
    },
    observations,
    timeSeriesSamples: samples,
    activitySessions: activities,
    labPanels: [],
    labMarkers: []
  };
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

function inferSamsungMetric(fileName: string, row: Record<string, string>): string | undefined {
  const name = fileName.toLowerCase();
  if (name.includes("step")) return "steps";
  if (name.includes("heart")) return "heart_rate";
  if (name.includes("weight")) return "weight";
  if (name.includes("sleep")) return "sleep_duration";
  if (row.pkg_name?.includes("step")) return "steps";
  return undefined;
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
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
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

function cryptoId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}
