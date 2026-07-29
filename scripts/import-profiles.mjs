import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Encrypted DuckDB development is currently approved only for Windows x64.");
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDirectory = resolve(repositoryRoot, "apps", "desktop", "build", "duckdb-extensions");
const extensionPath = resolve(extensionDirectory, "httpfs.duckdb_extension");
const prepare = spawnSync(process.execPath, [
  resolve(repositoryRoot, "scripts", "prepare-duckdb-httpfs.mjs"),
  "--output",
  extensionDirectory
], { cwd: repositoryRoot, stdio: "inherit" });

if (prepare.error) throw prepare.error;
if (prepare.status !== 0) process.exit(prepare.status ?? 1);
if (!existsSync(extensionPath)) throw new Error(`DuckDB extension preparation did not create ${extensionPath}.`);

if (!process.env.VITANA_EXPORT_DIR) {
  throw new Error("Set VITANA_EXPORT_DIR to a directory produced by npm run export:profiles.");
}

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath || !existsSync(npmCliPath)) {
  throw new Error("The import command must be launched through npm.");
}

const importRun = spawnSync(process.execPath, [
  npmCliPath,
  "run",
  "import:profiles",
  "-w",
  "apps/api",
  "--",
  ...process.argv.slice(2)
], {
  cwd: repositoryRoot,
  env: { ...process.env, VITANA_DUCKDB_HTTPFS_EXTENSION: extensionPath },
  stdio: "inherit"
});

if (importRun.error) throw importRun.error;
process.exit(importRun.status ?? 1);
