import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { createBenchmarkFixture, createEmptyBenchmarkFixture } from "./benchmarkFixture.js";
import { DuckDbPocRepository } from "../storage/duckdbPocRepository.js";

type BenchmarkEngine = "duckdb" | "json";
type BenchmarkOperation = "setup" | "cold-open" | "profile-switch" | "clean-restart" | "forced-restart" | "daily-weekly" | "latest-measurement" | "detail-query" | "import-100k" | "full-export" | "one-row-insert" | "one-row-delete" | "delete-by-type";

interface WorkerConfig {
  engine: BenchmarkEngine;
  operation: BenchmarkOperation;
  root: string;
  templatePath: string;
  workingPath: string;
  key: string;
  httpfsExtensionPath: string;
  observationCount: number;
  seed: number;
  fixtureKind?: "full" | "empty";
}

interface WorkerResult {
  engine: BenchmarkEngine;
  operation: BenchmarkOperation;
  durationMs: number;
  peakRssBytes: number;
  storageBytes: number;
  observationCount: number;
  exactCountParity: boolean;
  observationDigest?: string;
}

const configPath = process.argv[2];
if (!configPath) {
  throw new Error("DuckDB benchmark worker requires a config-file path.");
}
const config = JSON.parse(readFileSync(configPath, "utf8")) as WorkerConfig;
const result = config.engine === "duckdb" ? await runDuckDb(config) : await runJson(config);
process.stdout.write(`${JSON.stringify(result)}\n`);

async function runDuckDb(config: WorkerConfig): Promise<WorkerResult> {
  const options = { httpfsExtensionPath: config.httpfsExtensionPath };
  let durationMs: number;
  let actualObservationCount = config.observationCount;
  let observationDigest: string | undefined;
  if (config.operation === "setup") {
    const fixture = config.fixtureKind === "empty"
      ? createEmptyBenchmarkFixture(config.seed)
      : createBenchmarkFixture(config);
    const start = performance.now();
    const repository = await DuckDbPocRepository.hydrate(config.root, config.templatePath, config.key, fixture, options);
    const snapshot = await repository.snapshot();
    actualObservationCount = snapshot.observations.length;
    observationDigest = digestObservations(snapshot.observations);
    await repository.close();
    durationMs = performance.now() - start;
  } else {
    mkdirSync(dirname(config.workingPath), { recursive: true });
    copyFileSync(config.templatePath, config.workingPath);
    if (config.operation === "cold-open") {
      const start = performance.now();
      const repository = await DuckDbPocRepository.open(config.root, config.workingPath, config.key, options);
      durationMs = performance.now() - start;
      await repository.close();
    } else if (config.operation === "clean-restart") {
      const start = performance.now();
      const repository = await DuckDbPocRepository.open(config.root, config.workingPath, config.key, options);
      await repository.latestMeasurement("weight");
      await repository.close();
      durationMs = performance.now() - start;
    } else if (config.operation === "profile-switch") {
      const switchPath = `${config.workingPath}.switch`;
      copyFileSync(config.templatePath, switchPath);
      const current = await DuckDbPocRepository.open(config.root, config.workingPath, config.key, options);
      const start = performance.now();
      await current.close();
      const next = await DuckDbPocRepository.open(config.root, switchPath, config.key, options);
      await next.latestMeasurement("weight");
      await next.close();
      durationMs = performance.now() - start;
    } else if (config.operation === "forced-restart") {
      const victim = await startRestartVictim(config);
      const start = performance.now();
      await terminateVictim(victim);
      const recovered = await DuckDbPocRepository.open(config.root, config.workingPath, config.key, options);
      await recovered.latestMeasurement("weight");
      await recovered.close();
      durationMs = performance.now() - start;
    } else {
      const repository = await DuckDbPocRepository.open(config.root, config.workingPath, config.key, options);
      try {
        const importFixture = config.operation === "import-100k"
          ? createBenchmarkFixture({ observationCount: 100_000, seed: config.seed, importCount: 1 })
          : undefined;
        const start = performance.now();
        actualObservationCount = await runDuckDbOperation(repository, config.operation, importFixture) ?? actualObservationCount;
        durationMs = performance.now() - start;
        if (config.operation === "import-100k") {
          observationDigest = digestObservations((await repository.snapshot()).observations);
        }
      } finally {
        await repository.close();
      }
    }
  }
  const expectedCount = config.operation === "import-100k" ? 100_000 : config.observationCount;
  return workerResult(
    config,
    durationMs,
    storageBytes(config.operation === "setup" ? config.templatePath : config.workingPath),
    actualObservationCount,
    expectedCount,
    observationDigest
  );
}

async function runDuckDbOperation(
  repository: DuckDbPocRepository,
  operation: Exclude<BenchmarkOperation, "setup" | "cold-open">,
  importFixture?: ReturnType<typeof createBenchmarkFixture>
): Promise<number | undefined> {
  if (operation === "daily-weekly") {
    await repository.dailyMetrics();
    await repository.weeklyMetrics();
    return undefined;
  }
  if (operation === "full-export") {
    await repository.snapshot();
    return undefined;
  }
  if (operation === "latest-measurement") {
    await repository.latestMeasurement("weight");
    return undefined;
  }
  if (operation === "detail-query") {
    await repository.measurementDetails("weight");
    return undefined;
  }
  if (operation === "import-100k") {
    const sourceImport = importFixture!.sourceImports[0];
    const dataSource = importFixture!.dataSources[0];
    return repository.importObservationRecords({ sourceImport, dataSource, observations: importFixture!.observations });
  }
  if (operation === "one-row-insert") {
    await repository.insertObservationRecord(singleRowImport().observations[0]);
    return undefined;
  }
  if (operation === "one-row-delete") {
    await repository.deleteObservationRecord("observation-0000000");
    return undefined;
  }
  await repository.deleteObservationRecordsByMeasurementCode("weight");
  return undefined;
}

async function runJson(config: WorkerConfig): Promise<WorkerResult> {
  const dataDirectory = config.operation === "setup" ? dirname(config.templatePath) : dirname(config.workingPath);
  mkdirSync(dataDirectory, { recursive: true });
  process.env.LFA_DATA_DIR = dataDirectory;
  process.env.LFA_SECRET = config.key;
  const { HealthStore } = await import("../store.js");
  const { rebuildWarehouseFromStore, runWarehouseQuery } = await import("../warehouse.js");
  let durationMs: number;
  let actualObservationCount = config.observationCount;
  let observationDigest: string | undefined;

  if (config.operation === "setup") {
    const fixture = config.fixtureKind === "empty"
      ? createEmptyBenchmarkFixture(config.seed)
      : createBenchmarkFixture(config);
    const start = performance.now();
    const store = new HealthStore({ profileId: "benchmark-profile", passphrase: config.key, securityMode: "env-secret" });
    store.replaceProfile(fixture.profile);
    for (const sourceImport of fixture.sourceImports) {
      const source = fixture.dataSources.find((entry) => entry.importId === sourceImport.id)!;
      store.mergeImport({
        sourceImport,
        dataSource: source,
        observations: fixture.observations.filter((entry) => entry.sourceId === source.id),
        observationGroups: fixture.observationGroups.filter((entry) => entry.sourceId === source.id),
        timeSeriesSamples: fixture.timeSeriesSamples.filter((entry) => entry.sourceId === source.id),
        activitySessions: fixture.activitySessions.filter((entry) => entry.sourceId === source.id)
      });
    }
    for (const insight of fixture.insights) {
      store.addInsight(insight);
    }
    await rebuildWarehouseFromStore(store.snapshot({ includeRaw: true }));
    durationMs = performance.now() - start;
    actualObservationCount = store.snapshot().observations.length;
    observationDigest = digestObservations(store.snapshot().observations);
  } else {
    copyFileSync(config.templatePath, config.workingPath);
    if (existsSync(`${config.templatePath}.bak`)) {
      copyFileSync(`${config.templatePath}.bak`, `${config.workingPath}.bak`);
    }
    if (config.operation === "cold-open") {
      const start = performance.now();
      new HealthStore({ profileId: "benchmark-profile", passphrase: config.key, securityMode: "env-secret" });
      durationMs = performance.now() - start;
    } else if (config.operation === "clean-restart") {
      const start = performance.now();
      const store = new HealthStore({ profileId: "benchmark-profile", passphrase: config.key, securityMode: "env-secret" });
      store.listDetailEntries("weight")[0];
      durationMs = performance.now() - start;
    } else if (config.operation === "profile-switch") {
      const switchPath = join(dataDirectory, "health-store-benchmark-switch.enc");
      copyFileSync(config.templatePath, switchPath);
      new HealthStore({ profileId: "benchmark-profile", passphrase: config.key, securityMode: "env-secret" });
      const start = performance.now();
      const next = new HealthStore({ profileId: "benchmark-switch", passphrase: config.key, securityMode: "env-secret" });
      next.listDetailEntries("weight")[0];
      durationMs = performance.now() - start;
    } else if (config.operation === "forced-restart") {
      const victim = await startRestartVictim(config);
      const start = performance.now();
      await terminateVictim(victim);
      const recovered = new HealthStore({ profileId: "benchmark-profile", passphrase: config.key, securityMode: "env-secret" });
      recovered.listDetailEntries("weight")[0];
      durationMs = performance.now() - start;
    } else {
      const store = new HealthStore({ profileId: "benchmark-profile", passphrase: config.key, securityMode: "env-secret" });
      const importFixture = config.operation === "import-100k"
        ? createBenchmarkFixture({ observationCount: 100_000, seed: config.seed, importCount: 1 })
        : undefined;
      const start = performance.now();
      if (config.operation === "daily-weekly") {
        await rebuildWarehouseFromStore(store.snapshot());
        await runWarehouseQuery("SELECT * FROM v_daily_metrics");
        await runWarehouseQuery("SELECT * FROM v_weekly_metrics");
      } else if (config.operation === "latest-measurement") {
        store.listDetailEntries("weight")[0];
      } else if (config.operation === "detail-query") {
        store.listDetailEntries("weight");
      } else if (config.operation === "import-100k") {
        store.mergeImport({
          sourceImport: importFixture!.sourceImports[0],
          dataSource: importFixture!.dataSources[0],
          observations: importFixture!.observations,
          observationGroups: importFixture!.observationGroups,
          timeSeriesSamples: importFixture!.timeSeriesSamples,
          activitySessions: importFixture!.activitySessions
        });
        actualObservationCount = store.snapshot().observations.length;
        durationMs = performance.now() - start;
        observationDigest = digestObservations(store.snapshot().observations);
      } else if (config.operation === "full-export") {
        store.exportData();
      } else if (config.operation === "one-row-insert") {
        store.mergeImport(singleRowImport());
      } else if (config.operation === "one-row-delete") {
        store.deleteObservation("observation-0000000");
      } else {
        store.deleteObservationsByMeasurementCode("weight");
      }
      durationMs ??= performance.now() - start;
    }
  }
  const expectedCount = config.operation === "import-100k" ? 100_000 : config.observationCount;
  return workerResult(config, durationMs, directoryBytes(dataDirectory), actualObservationCount, expectedCount, observationDigest);
}

function singleRowImport() {
  return {
    sourceImport: {
      id: "benchmark-insert-import",
      sourceKind: "manual-entry" as const,
      fileName: "synthetic-insert.json",
      importedAt: "2026-01-01T00:00:00.000Z",
      parserVersion: "benchmark-v1",
      checksum: "benchmark-insert-checksum",
      rowCount: 1,
      status: "processed" as const,
      diagnostics: []
    },
    dataSource: {
      id: "benchmark-insert-source",
      sourceKind: "manual-entry" as const,
      label: "Synthetic insert source",
      importId: "benchmark-insert-import",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    observations: [{
      id: "benchmark-insert-observation",
      measurementCode: "weight",
      observedAt: "2026-01-01T00:00:00.000Z",
      value: 75,
      unit: "kg",
      sourceId: "benchmark-insert-source"
    }],
    observationGroups: [],
    timeSeriesSamples: [],
    activitySessions: []
  };
}

function workerResult(
  config: WorkerConfig,
  durationMs: number,
  bytes: number,
  actualObservationCount: number,
  expectedObservationCount: number,
  observationDigest?: string
): WorkerResult {
  const resourcePeak = process.resourceUsage().maxRSS * 1_024;
  return {
    engine: config.engine,
    operation: config.operation,
    durationMs: Math.round(durationMs * 100) / 100,
    peakRssBytes: Math.max(process.memoryUsage().rss, resourcePeak),
    storageBytes: bytes,
    observationCount: actualObservationCount,
    exactCountParity: actualObservationCount === expectedObservationCount,
    ...(observationDigest ? { observationDigest } : {})
  };
}

function digestObservations(observations: readonly unknown[]): string {
  const ordered = [...observations].sort((left, right) => observationId(left).localeCompare(observationId(right)));
  return createHash("sha256").update(canonicalJson(ordered)).digest("hex");
}

function observationId(value: unknown): string {
  return value && typeof value === "object" && "id" in value ? String(value.id) : "";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function storageBytes(path: string): number {
  const directory = dirname(path);
  const prefix = path.slice(directory.length + 1);
  return readdirSync(directory)
    .filter((entry) => entry.startsWith(prefix))
    .reduce((total, entry) => total + statSync(join(directory, entry)).size, 0);
}

function directoryBytes(path: string): number {
  return readdirSync(path).reduce((total, entry) => {
    const child = join(path, entry);
    return total + (statSync(child).isDirectory() ? directoryBytes(child) : statSync(child).size);
  }, 0);
}

function startRestartVictim(config: WorkerConfig): Promise<ReturnType<typeof spawn>> {
  return new Promise((resolvePromise, reject) => {
    const victimPath = join(process.cwd(), "src", "poc", "benchmarkRestartVictim.ts");
    const child = spawn(process.execPath, ["--import", "tsx", victimPath, process.argv[2]], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes("READY")) {
        resolvePromise(child);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!stdout.includes("READY")) {
        reject(new Error(`Benchmark restart victim exited before ready with code ${code}: ${stderr}`));
      }
    });
  });
}

function terminateVictim(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolvePromise());
    if (!child.kill()) {
      reject(new Error("Failed to terminate benchmark restart victim."));
    }
  });
}