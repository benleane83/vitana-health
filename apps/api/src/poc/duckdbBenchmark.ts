import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { cpus, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { initializePocRoot } from "./duckdbPoc.js";

type BenchmarkEngine = "duckdb" | "json";
type BenchmarkOperation = "cold-open" | "profile-switch" | "clean-restart" | "forced-restart" | "daily-weekly" | "latest-measurement" | "detail-query" | "import-100k" | "full-export" | "one-row-insert" | "one-row-delete" | "delete-by-type";

interface WorkerResult {
  engine: BenchmarkEngine;
  operation: BenchmarkOperation | "setup";
  durationMs: number;
  peakRssBytes: number;
  storageBytes: number;
  observationCount: number;
  exactCountParity: boolean;
  observationDigest?: string;
}

interface AggregateResult {
  engine: BenchmarkEngine;
  operation: BenchmarkOperation;
  medianMs: number;
  p95Ms: number;
  peakRssBytes: number;
  warmupPassed: boolean;
  successfulRuns: number;
  failedRuns: number;
}

interface WorkerFailure {
  engine: BenchmarkEngine;
  operation: BenchmarkOperation;
  run: number;
  message: string;
}

const args = parseArgs(process.argv.slice(2));
const root = initializePocRoot(mkdtempSync(join(tmpdir(), "lfa-duckdb-benchmark-")));
const extensionPath = findPreparedExtension();
if (!extensionPath) {
  throw new Error("Prepare the pinned httpfs extension before running DuckDB benchmarks.");
}
const key = randomBytes(32).toString("base64");
const workerPath = resolve(process.cwd(), "src", "poc", "duckdbBenchmarkWorker.ts");
const duckTemplate = join(root, "databases", "benchmark-template.duckdb-poc");
const jsonTemplate = join(root, "input-copy", "health-store-benchmark-profile.enc");
const duckImportTemplate = join(root, "databases", "benchmark-import-template.duckdb-poc");
const jsonImportTemplate = join(root, "input-copy", "import-template", "health-store-benchmark-profile.enc");
const operations: BenchmarkOperation[] = [
  "cold-open", "profile-switch", "clean-restart", "forced-restart", "daily-weekly", "latest-measurement", "detail-query", "import-100k", "full-export", "one-row-insert", "one-row-delete", "delete-by-type"
];

const setupResults = await Promise.all([
  invokeWorker("duckdb", "setup", 0, duckTemplate, duckTemplate),
  invokeWorker("json", "setup", 0, jsonTemplate, jsonTemplate)
]);
await Promise.all([
  invokeWorker("duckdb", "setup", -2, duckImportTemplate, duckImportTemplate, 0, "empty"),
  invokeWorker("json", "setup", -2, jsonImportTemplate, jsonImportTemplate, 0, "empty")
]);
const aggregates: AggregateResult[] = [];
const failures: WorkerFailure[] = [];
for (const engine of ["duckdb", "json"] as const) {
  for (const operation of operations) {
    const warmupPassed = await invokeWorker(engine, operation, -1, templateFor(engine, operation), workingPath(engine, operation, "warmup"))
      .then(() => true)
      .catch((error) => {
        failures.push(workerFailure(engine, operation, -1, error));
        return false;
      });
    const measured: WorkerResult[] = [];
    for (let run = 0; run < args.runs; run += 1) {
      const result = await invokeWorker(engine, operation, run, templateFor(engine, operation), workingPath(engine, operation, String(run)))
        .catch((error) => {
          failures.push(workerFailure(engine, operation, run, error));
          return undefined;
        });
      if (result) {
        measured.push(result);
      }
    }
    const durations = measured.map((entry) => entry.durationMs).sort((left, right) => left - right);
    aggregates.push({
      engine,
      operation,
      medianMs: durations.length > 0 ? percentile(durations, 0.5) : Number.NaN,
      p95Ms: durations.length > 0 ? percentile(durations, 0.95) : Number.NaN,
      peakRssBytes: measured.length > 0 ? Math.max(...measured.map((entry) => entry.peakRssBytes)) : 0,
      warmupPassed,
      successfulRuns: measured.length,
      failedRuns: args.runs - measured.length
    });
  }
}

const report = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    duckdb: "1.4.4",
    osRelease: release(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    seed: args.seed,
    observationCount: args.observationCount,
    measuredRuns: args.runs,
    warmupRuns: 1
  },
  setup: setupResults,
  aggregates,
  failures,
  gates: evaluateGates(args.observationCount, aggregates, setupResults)
};
const jsonPath = join(root, "results", "benchmark-summary.json");
const markdownPath = join(root, "results", "benchmark-summary.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
writeFileSync(markdownPath, renderMarkdown(report), { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ root, jsonPath, markdownPath, gates: report.gates }, null, 2)}\n`);

async function invokeWorker(
  engine: BenchmarkEngine,
  operation: BenchmarkOperation | "setup",
  run: number,
  templatePath: string,
  workingPath: string,
  observationCount = args.observationCount,
  fixtureKind: "full" | "empty" = "full"
): Promise<WorkerResult> {
  const configPath = join(root, "keys", `${engine}-${operation}-${run}.json`);
  writeFileSync(configPath, JSON.stringify({
    engine,
    operation,
    root,
    templatePath,
    workingPath,
    key,
    httpfsExtensionPath: extensionPath,
    observationCount,
    seed: args.seed,
    fixtureKind
  }), { mode: 0o600 });
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, configPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Benchmark worker ${engine}/${operation} failed with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout.trim()) as WorkerResult);
      } catch (error) {
        reject(new Error(`Benchmark worker ${engine}/${operation} returned invalid JSON: ${stdout}`, { cause: error }));
      }
    });
  });
}

function parseArgs(values: string[]): { observationCount: number; runs: number; seed: number } {
  const positional = values.filter((entry) => !entry.startsWith("-"));
  const value = (name: string, fallback: number, positionalIndex: number): number => {
    const index = values.indexOf(name);
    const inline = values.find((entry) => entry.startsWith(`${name}=`));
    if (inline) {
      return Number(inline.slice(name.length + 1));
    }
    return index < 0 ? Number(positional[positionalIndex] ?? fallback) : Number(values[index + 1]);
  };
  const observationCount = value("--scale", 10_000, 0);
  const runs = value("--runs", 5, 1);
  const seed = value("--seed", 45, 2);
  if (!Number.isInteger(observationCount) || observationCount < 1 || observationCount > 1_000_000) {
    throw new Error("--scale must be an integer from 1 through 1,000,000.");
  }
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
    throw new Error("--runs must be an integer from 1 through 20.");
  }
  if (!Number.isInteger(seed)) {
    throw new Error("--seed must be an integer.");
  }
  return { observationCount, runs, seed };
}

function templateFor(engine: BenchmarkEngine, operation?: BenchmarkOperation): string {
  if (operation === "import-100k") {
    return engine === "duckdb" ? duckImportTemplate : jsonImportTemplate;
  }
  return engine === "duckdb" ? duckTemplate : jsonTemplate;
}

function workingPath(engine: BenchmarkEngine, operation: BenchmarkOperation, run: string): string {
  return engine === "duckdb"
    ? join(root, "databases", `${operation}-${run}.duckdb-poc`)
    : join(root, "temp", `${operation}-${run}`, "health-store-benchmark-profile.enc");
}

function percentile(sorted: number[], percentileValue: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function workerFailure(engine: BenchmarkEngine, operation: BenchmarkOperation, run: number, error: unknown): WorkerFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    engine,
    operation,
    run,
    message: message.replaceAll(root, "<benchmark-root>").replaceAll(process.cwd(), "<workspace>")
  };
}

function evaluateGates(observationCount: number, aggregates: AggregateResult[], setup: WorkerResult[]) {
  if (observationCount !== 250_000) {
    return { blocking: false, reason: "Performance gates are blocking only at 250,000 observations." };
  }
  const duck = (operation: BenchmarkOperation) => aggregates.find((entry) => entry.engine === "duckdb" && entry.operation === operation)!;
  const reliable = (operation: BenchmarkOperation) => {
    const aggregate = duck(operation);
    return aggregate.warmupPassed && aggregate.successfulRuns === args.runs && aggregate.failedRuns === 0;
  };
  const duckBytes = setup.find((entry) => entry.engine === "duckdb")!.storageBytes;
  const baselineBytes = setup.find((entry) => entry.engine === "json")!.storageBytes;
  const setupDigests = setup.map((entry) => entry.observationDigest);
  return {
    blocking: true,
    observationParity: setup.every((entry) => entry.exactCountParity) && setupDigests[0] === setupDigests[1],
    coldOpen: reliable("cold-open") && duck("cold-open").p95Ms < 500,
    routineReads: ["profile-switch", "clean-restart", "forced-restart", "daily-weekly", "latest-measurement", "detail-query"].every(
      (operation) => reliable(operation as BenchmarkOperation) && duck(operation as BenchmarkOperation).p95Ms < 500
    ),
    import100k: reliable("import-100k") && duck("import-100k").p95Ms < 10_000,
    fullExport: reliable("full-export") && duck("full-export").p95Ms < 10_000,
    oneRowInsert: reliable("one-row-insert") && duck("one-row-insert").p95Ms < 250,
    oneRowDelete: reliable("one-row-delete") && duck("one-row-delete").p95Ms < 250,
    peakRss: Math.max(
      setup.find((entry) => entry.engine === "duckdb")!.peakRssBytes,
      ...aggregates.filter((entry) => entry.engine === "duckdb").map((entry) => entry.peakRssBytes)
    ) < 512 * 1024 * 1024,
    footprint: duckBytes <= baselineBytes
  };
}

function renderMarkdown(reportValue: {
  environment: { seed: number; observationCount: number; measuredRuns: number };
  aggregates: AggregateResult[];
  gates: unknown;
}): string {
  const rows = reportValue.aggregates.map((entry) =>
    `| ${entry.engine} | ${entry.operation} | ${entry.medianMs.toFixed(2)} | ${entry.p95Ms.toFixed(2)} | ${(entry.peakRssBytes / 1_048_576).toFixed(1)} | ${entry.successfulRuns}/${entry.successfulRuns + entry.failedRuns} |`
  ).join("\n");
  return `# Encrypted DuckDB Benchmark Summary\n\n` +
    `Synthetic seed: ${reportValue.environment.seed}; observations: ${reportValue.environment.observationCount}; measured runs: ${reportValue.environment.measuredRuns}.\n\n` +
    `| Engine | Operation | Median ms | p95 ms | Peak RSS MiB | Successful runs |\n| --- | --- | ---: | ---: | ---: | ---: |\n${rows}\n\n` +
    `## Gates\n\n\`\`\`json\n${JSON.stringify(reportValue.gates, null, 2)}\n\`\`\`\n`;
}

function findPreparedExtension(): string | undefined {
  return [
    process.env.LFA_DUCKDB_HTTPFS_EXTENSION,
    resolve(process.cwd(), "apps", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension"),
    resolve(process.cwd(), "..", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension")
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}