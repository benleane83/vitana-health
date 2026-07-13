import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const useDuckDb = !process.argv.includes("--json");
const rollbackRequested = process.argv.includes("--rollback");

if (rollbackRequested && useDuckDb) {
  throw new Error("DuckDB rollback requires the explicit JSON development mode.");
}

if (useDuckDb && (process.platform !== "win32" || process.arch !== "x64")) {
  throw new Error("Encrypted DuckDB development is currently approved only for Windows x64.");
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDirectory = resolve(repositoryRoot, "apps", "desktop", "build", "duckdb-extensions");
const extensionPath = resolve(extensionDirectory, "httpfs.duckdb_extension");
if (useDuckDb) {
  const prepareResult = spawnSync(
    process.execPath,
    [
      resolve(repositoryRoot, "scripts", "prepare-duckdb-httpfs.mjs"),
      "--output",
      extensionDirectory
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"]
    }
  );

  if (prepareResult.error) {
    throw prepareResult.error;
  }
  if (prepareResult.status !== 0) {
    process.exit(prepareResult.status ?? 1);
  }
  if (!existsSync(extensionPath)) {
    throw new Error(`DuckDB extension preparation did not create ${extensionPath}.`);
  }
  console.log(`Encrypted DuckDB development extension verified at ${extensionPath}`);
}

if (process.argv.includes("--prepare-only")) {
  process.exit(0);
}

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath || !existsSync(npmCliPath)) {
  throw new Error("Storage development must be launched through an npm development script.");
}
const child = spawn(process.execPath, [npmCliPath, "run", "dev:services"], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    LFA_STORAGE_BACKEND: useDuckDb ? "duckdb" : "json",
    ...(useDuckDb ? { LFA_DUCKDB_HTTPFS_EXTENSION: extensionPath } : {}),
    ...(rollbackRequested ? { LFA_DUCKDB_ROLLBACK: "discard-duckdb-changes" } : {})
  },
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.once("error", (error) => {
  console.error(`Unable to start encrypted DuckDB development: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});