import { defaultMeasurementTypes, healthStoreDataSchema, type HealthStoreData } from "@local-fitness-advisor/shared";

export const benchmarkObservationCounts = [10_000, 100_000, 250_000] as const;

const benchmarkCodes = ["weight", "heart_rate", "glucose", "sleep_duration", "steps", "oxygen_saturation"];
const measurementTypes: HealthStoreData["measurementTypes"] = JSON.parse(JSON.stringify(defaultMeasurementTypes));
const benchmarkMeasurementTypes = benchmarkCodes.map((code) => {
  const measurementType = measurementTypes.find((entry) => entry.code === code);
  if (!measurementType) {
    throw new Error(`Missing benchmark measurement type ${code}.`);
  }
  return measurementType;
});

const units = new Map(measurementTypes.map((entry) => [entry.code, entry.canonicalUnit]));
const baseTime = Date.parse("2025-01-01T00:00:00.000Z");

export interface BenchmarkFixtureOptions {
  observationCount: number;
  seed: number;
  importCount?: number;
}

export function createBenchmarkFixture(options: BenchmarkFixtureOptions): HealthStoreData {
  if (!Number.isInteger(options.observationCount) || options.observationCount < 1 || options.observationCount > 1_000_000) {
    throw new Error("Benchmark observationCount must be an integer from 1 through 1,000,000.");
  }
  if (!Number.isInteger(options.seed)) {
    throw new Error("Benchmark seed must be an integer.");
  }

  const random = mulberry32(options.seed);
  const importCount = options.importCount ?? Math.min(8, Math.max(1, Math.ceil(options.observationCount / 25_000)));
  if (!Number.isInteger(importCount) || importCount < 1 || importCount > 8) {
    throw new Error("Benchmark importCount must be an integer from 1 through 8.");
  }
  const sourceImports = Array.from({ length: importCount }, (_, index) => ({
    id: benchmarkId("import", index),
    sourceKind: "observation-csv" as const,
    fileName: `synthetic-${index}.csv`,
    importedAt: timestamp(index),
    parserVersion: "benchmark-v1",
    checksum: `synthetic-checksum-${options.seed}-${index}`,
    rowCount: Math.ceil(options.observationCount / importCount),
    status: "processed" as const,
    diagnostics: []
  }));
  const dataSources = sourceImports.map((entry, index) => ({
    id: benchmarkId("source", index),
    sourceKind: entry.sourceKind,
    label: `Synthetic source ${index}`,
    importId: entry.id,
    createdAt: entry.importedAt
  }));
  const devices = dataSources.slice(0, Math.min(4, dataSources.length)).map((entry, index) => ({
    id: benchmarkId("device", index),
    label: `Synthetic device ${index}`,
    manufacturer: "Benchmark",
    model: `Model-${index}`,
    sourceId: entry.id
  }));
  const observationGroups = Array.from(
    { length: Math.min(20_000, Math.max(1, Math.ceil(options.observationCount / 100))) },
    (_, index) => ({
      id: benchmarkId("group", index),
      kind: "import_batch" as const,
      label: `Synthetic batch ${index}`,
      sourceId: dataSources[index % dataSources.length].id,
      importId: sourceImports[index % sourceImports.length].id,
      startAt: timestamp(index * 100),
      endAt: timestamp(index * 100 + 99),
      metadata: { seed: options.seed, ordinal: index }
    })
  );
  const observations = Array.from({ length: options.observationCount }, (_, index) => {
    const type = benchmarkMeasurementTypes[index % benchmarkMeasurementTypes.length];
    return {
      id: benchmarkId("observation", index),
      measurementCode: type.code,
      observedAt: timestamp(index),
      value: syntheticValue(index, random),
      unit: type.canonicalUnit,
      sourceId: dataSources[index % dataSources.length].id,
      observationGroupId: observationGroups[Math.floor(index / 100) % observationGroups.length].id,
      ...(devices.length > 0 && index % 2 === 0 ? { deviceId: devices[index % devices.length].id } : {}),
      ...(index % 5 === 0 ? { sourceJson: { seed: options.seed, ordinal: index } } : {})
    };
  });
  const timeSeriesSamples = Array.from(
    { length: Math.min(10_000, Math.max(1, Math.ceil(options.observationCount / 10))) },
    (_, index) => {
      const measurementCode = index % 2 === 0 ? "steps" : "heart_rate";
      return {
        id: benchmarkId("sample", index),
        measurementCode,
        startAt: timestamp(index * 5),
        endAt: timestamp(index * 5 + 4),
        value: measurementCode === "steps" ? 20 + (index % 80) : 55 + (index % 90),
        unit: units.get(measurementCode)!,
        sourceId: dataSources[index % dataSources.length].id,
        ...(devices.length > 0 ? { deviceId: devices[index % devices.length].id } : {})
      };
    }
  );
  const activitySessions = Array.from(
    { length: Math.min(75_000, Math.max(1, Math.ceil(options.observationCount / 20))) },
    (_, index) => ({
      id: benchmarkId("activity", index),
      activityType: ["walking", "running", "cycling"][index % 3],
      startAt: timestamp(index * 30),
      endAt: timestamp(index * 30 + 29),
      durationMinutes: 30,
      energyKcal: 80 + (index % 220),
      distanceMeters: 1_000 + (index % 9_000),
      sourceId: dataSources[index % dataSources.length].id
    })
  );
  const lowVolumeCount = Math.min(100, Math.max(1, Math.ceil(options.observationCount / 5_000)));
  const insights = Array.from({ length: lowVolumeCount }, (_, index) => ({
    id: benchmarkId("insight", index),
    createdAt: timestamp(index * 1_000),
    title: `Synthetic insight ${index}`,
    body: "Deterministic benchmark evidence.",
    evidence: [observations[index % observations.length].id],
    confidence: ["low", "medium", "high"][index % 3] as "low" | "medium" | "high",
    model: "benchmark",
    safetyNotice: "Synthetic data only."
  }));
  const auditEvents = Array.from({ length: lowVolumeCount }, (_, index) => ({
    id: benchmarkId("audit", index),
    createdAt: timestamp(index * 1_000 + 1),
    eventType: "import-processed" as const,
    detail: `Synthetic import ${index} processed.`
  }));

  return healthStoreDataSchema.parse({
    schemaVersion: 2,
    profile: {
      id: "benchmark-profile",
      displayName: "Synthetic Benchmark",
      units: "metric",
      updatedAt: timestamp(0)
    },
    sourceImports,
    dataSources,
    devices,
    measurementTypes,
    observationGroups,
    observations,
    timeSeriesSamples,
    activitySessions,
    insights,
    auditEvents
  }) as HealthStoreData;
}

function benchmarkId(kind: string, index: number): string {
  return `${kind}-${index.toString().padStart(7, "0")}`;
}

function timestamp(index: number): string {
  return new Date(baseTime + index * 60_000).toISOString();
}

function syntheticValue(index: number, random: () => number): number {
  return Math.round((40 + (index % 160) + random()) * 100) / 100;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

export function createEmptyBenchmarkFixture(seed: number): HealthStoreData {
  const fixture = createBenchmarkFixture({ observationCount: 1, seed, importCount: 1 });
  return healthStoreDataSchema.parse({
    ...fixture,
    sourceImports: [],
    dataSources: [],
    devices: [],
    observationGroups: [],
    observations: [],
    timeSeriesSamples: [],
    activitySessions: [],
    insights: [],
    auditEvents: []
  }) as HealthStoreData;
}