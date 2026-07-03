import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import {
  checksum,
  type ActivitySession,
  type DataSource,
  type Observation,
  type ParsedImport,
  type SourceImport,
  type TimeSeriesSample
} from "@local-fitness-advisor/shared";

interface ImportOptions {
  uploadPath?: string;
}

interface NumericRecord {
  [key: string]: unknown;
}

interface ImportStats {
  uploadPath: string;
  datasetsScanned: number;
  filesScanned: number;
  filesParsed: number;
  parseFailures: number;
  rowsParsed: number;
}

export function importSamsungJsonUpload(options: ImportOptions = {}): { parsed: ParsedImport; stats: ImportStats } {
  const uploadPath = resolveUploadPath(options.uploadPath);
  const jsonRoot = resolve(uploadPath, "jsons");
  const importId = stableId("import", ["samsung-json", uploadPath, new Date().toISOString()]);
  const sourceId = stableId("source", ["samsung-json", uploadPath]);
  const diagnostics: string[] = [];
  const observations: Observation[] = [];
  const samples: TimeSeriesSample[] = [];
  const activities: ActivitySession[] = [];
  const dayStepTotals = new Map<string, number>();
  const stateHasher = createHash("sha256");

  let filesScanned = 0;
  let filesParsed = 0;
  let parseFailures = 0;
  let rowsParsed = 0;

  const datasetParsers: Array<{
    dataset: string;
    parseRow: (row: NumericRecord, fileTag: string) => void;
  }> = [
    {
      dataset: "com.samsung.shealth.tracker.heart_rate",
      parseRow: (row, fileTag) => {
        const start = toIsoDate(row.start_time);
        const end = toIsoDate(row.end_time) ?? start;
        const value = toNumber(row.heart_rate);
        if (!start || !end || value === undefined) {
          return;
        }
        const sampleId = stableId("sample", ["heart_rate", fileTag, start, end, String(value)]);
        samples.push({
          id: sampleId,
          measurementCode: "heart_rate",
          startAt: start,
          endAt: end,
          value,
          unit: "bpm",
          sourceId
        });
        observations.push({
          id: stableId("obs", ["heart_rate", fileTag, start, String(value)]),
          measurementCode: "heart_rate",
          observedAt: start,
          effectiveStart: start,
          effectiveEnd: end,
          value,
          unit: "bpm",
          sourceId
        });
      }
    },
    {
      dataset: "com.samsung.shealth.tracker.oxygen_saturation",
      parseRow: (row, fileTag) => {
        const start = toIsoDate(row.start_time);
        const end = toIsoDate(row.end_time) ?? start;
        const value = toNumber(row.spo2);
        if (!start || !end || value === undefined) {
          return;
        }
        samples.push({
          id: stableId("sample", ["oxygen_saturation", fileTag, start, end, String(value)]),
          measurementCode: "oxygen_saturation",
          startAt: start,
          endAt: end,
          value,
          unit: "%",
          sourceId
        });
        observations.push({
          id: stableId("obs", ["oxygen_saturation", fileTag, start, String(value)]),
          measurementCode: "oxygen_saturation",
          observedAt: start,
          effectiveStart: start,
          effectiveEnd: end,
          value,
          unit: "%",
          sourceId
        });
      }
    },
    {
      dataset: "com.samsung.health.hrv",
      parseRow: (row, fileTag) => {
        const start = toIsoDate(row.start_time);
        const end = toIsoDate(row.end_time) ?? start;
        if (!start || !end) {
          return;
        }
        const sdnn = toNumber(row.sdnn);
        if (sdnn !== undefined) {
          observations.push({
            id: stableId("obs", ["hrv_sdnn", fileTag, start, String(sdnn)]),
            measurementCode: "hrv_sdnn",
            observedAt: start,
            effectiveStart: start,
            effectiveEnd: end,
            value: sdnn,
            unit: "ms",
            sourceId
          });
        }
        const rmssd = toNumber(row.rmssd);
        if (rmssd !== undefined) {
          observations.push({
            id: stableId("obs", ["hrv_rmssd", fileTag, start, String(rmssd)]),
            measurementCode: "hrv_rmssd",
            observedAt: start,
            effectiveStart: start,
            effectiveEnd: end,
            value: rmssd,
            unit: "ms",
            sourceId
          });
        }
      }
    },
    {
      dataset: "com.samsung.health.movement",
      parseRow: (row, fileTag) => {
        const start = toIsoDate(row.start_time);
        const end = toIsoDate(row.end_time) ?? start;
        const value = toNumber(row.activity_level);
        if (!start || !end || value === undefined) {
          return;
        }
        observations.push({
          id: stableId("obs", ["activity_level", fileTag, start, String(value)]),
          measurementCode: "activity_level",
          observedAt: start,
          effectiveStart: start,
          effectiveEnd: end,
          value,
          unit: "score",
          sourceId
        });
      }
    },
    {
      dataset: "com.samsung.shealth.tracker.pedometer_day_summary",
      parseRow: (row, fileTag) => {
        const startMs = toNumber(row.mStartTime);
        const spanMs = toNumber(row.mTimeUnit) ?? 600000;
        const value = toNumber(row.mStepCount);
        if (startMs === undefined || value === undefined) {
          return;
        }
        const start = toIsoDate(startMs);
        const end = toIsoDate(startMs + Math.max(1, spanMs) - 1) ?? start;
        if (!start || !end) {
          return;
        }
        samples.push({
          id: stableId("sample", ["steps", fileTag, start, end, String(value)]),
          measurementCode: "steps",
          startAt: start,
          endAt: end,
          value,
          unit: "count",
          sourceId
        });

        const dayKey = start.slice(0, 10);
        dayStepTotals.set(dayKey, (dayStepTotals.get(dayKey) ?? 0) + value);
      }
    },
    {
      dataset: "com.samsung.shealth.exercise",
      parseRow: (row, fileTag) => {
        const start = toIsoDate(row.start_time);
        if (!start) {
          return;
        }
        const hr = toNumber(row.heart_rate);
        if (hr !== undefined) {
          observations.push({
            id: stableId("obs", ["heart_rate", fileTag, start, String(hr), "exercise"]),
            measurementCode: "heart_rate",
            observedAt: start,
            value: hr,
            unit: "bpm",
            sourceId
          });
        }

        const speed = toNumber(row.speed);
        if (speed !== undefined) {
          observations.push({
            id: stableId("obs", ["exercise_speed", fileTag, start, String(speed)]),
            measurementCode: "exercise_speed",
            observedAt: start,
            value: speed,
            unit: "m/s",
            sourceId
          });
        }
      }
    }
  ];

  for (const parser of datasetParsers) {
    const datasetDir = resolve(jsonRoot, parser.dataset);
    if (!existsDirectory(datasetDir)) {
      continue;
    }

    const files = listJsonFiles(datasetDir);
    for (const filePath of files) {
      filesScanned += 1;
      try {
        const raw = readFileSync(filePath, "utf8");
        const trimmed = raw.trim();
        if (trimmed.length === 0 || (trimmed !== "[]" && trimmed !== "{}" && trimmed.length < 3)) {
          continue;
        }
        const parsed = JSON.parse(trimmed) as unknown;
        const fileChecksum = checksum(raw);
        const fileTag = `${parser.dataset}:${fileChecksum}:${relativeTag(jsonRoot, filePath)}`;
        stateHasher.update(fileTag);
        filesParsed += 1;
        if (Array.isArray(parsed)) {
          for (const row of parsed) {
            if (!isObject(row)) {
              continue;
            }
            parser.parseRow(row, fileTag);
            rowsParsed += 1;
          }
        } else if (isObject(parsed)) {
          parser.parseRow(parsed, fileTag);
          rowsParsed += 1;
        }
      } catch (error) {
        parseFailures += 1;
        diagnostics.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  }

  for (const [day, value] of dayStepTotals.entries()) {
    observations.push({
      id: stableId("obs", ["steps", "daily", day]),
      measurementCode: "steps",
      observedAt: `${day}T00:00:00.000Z`,
      value,
      unit: "count",
      sourceId,
      note: "Daily step total derived from Samsung pedometer bins"
    });
  }

  const stateChecksum = `sha256-${stateHasher.digest("hex")}`;
  const sourceImport: SourceImport = {
    id: importId,
    sourceKind: "samsung-health",
    fileName: uploadPath,
    importedAt: new Date().toISOString(),
    parserVersion: "samsung-json-upload-v1",
    checksum: stateChecksum,
    rowCount: rowsParsed,
    status: parseFailures > 0 ? "needs-review" : "processed",
    diagnostics: diagnostics.slice(0, 100)
  };

  const dataSource: DataSource = {
    id: sourceId,
    sourceKind: "samsung-health",
    label: `Samsung Health JSON upload: ${uploadPath}`,
    importId,
    createdAt: sourceImport.importedAt
  };

  return {
    parsed: {
      sourceImport,
      dataSource,
      observations,
      timeSeriesSamples: samples,
      activitySessions: activities,
      labPanels: [],
      labMarkers: []
    },
    stats: {
      uploadPath,
      datasetsScanned: datasetParsers.length,
      filesScanned,
      filesParsed,
      parseFailures,
      rowsParsed
    }
  };
}

function resolveUploadPath(inputPath: string | undefined): string {
  if (inputPath) {
    const resolved = resolve(inputPath);
    if (!existsDirectory(resolved)) {
      throw new Error(`Upload path does not exist: ${resolved}`);
    }
    return resolved;
  }

  const uploadsRoot = resolve(process.cwd(), "..", "..", "data", "uploads");
  const resolvedUploadsRoot = resolveUploadsRoot(uploadsRoot);
  if (!existsDirectory(resolvedUploadsRoot)) {
    throw new Error(`Uploads folder not found: ${resolvedUploadsRoot}`);
  }
  const candidates = readdirSync(resolvedUploadsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(resolvedUploadsRoot, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (candidates.length === 0) {
    throw new Error(`No upload folders found under: ${resolvedUploadsRoot}`);
  }
  return candidates[0];
}

function listJsonFiles(root: string): string[] {
  const stack = [root];
  const files: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function stableId(prefix: string, parts: string[]): string {
  const digest = createHash("sha1").update(parts.join("|"), "utf8").digest("hex").slice(0, 18);
  return `${prefix}_${digest}`;
}

function toIsoDate(value: unknown): string | undefined {
  const number = toNumber(value);
  if (number === undefined) {
    return undefined;
  }
  const date = new Date(number);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function existsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is NumericRecord {
  return typeof value === "object" && value !== null;
}

function relativeTag(root: string, filePath: string): string {
  return filePath.slice(root.length).replaceAll("\\", "/");
}

function resolveUploadsRoot(defaultRoot: string): string {
  const candidates = [
    resolve(process.cwd(), "data", "uploads"),
    defaultRoot
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? defaultRoot;
}
