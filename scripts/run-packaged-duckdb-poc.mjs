import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const outputRoot = resolve("apps/desktop/dist-poc");
const unpackedDirectory = readdirSync(outputRoot, { withFileTypes: true })
  .find((entry) => entry.isDirectory() && entry.name.endsWith("-unpacked"));
if (!unpackedDirectory) {
  throw new Error(`No unpacked Electron PoC bundle was found beneath ${outputRoot}.`);
}

const applicationDirectory = join(outputRoot, unpackedDirectory.name);
const executable = findExecutable(applicationDirectory);
const resultDirectory = mkdtempSync(join(tmpdir(), "lfa-packaged-duckdb-result-"));
const resultPath = join(resultDirectory, "result.json");
const exitCode = await run(executable, resultPath);
if (exitCode !== 0) {
  throw new Error(`Packaged Electron PoC exited with code ${exitCode}.`);
}
if (!existsSync(resultPath)) {
  throw new Error("Packaged Electron PoC did not produce a result file.");
}

const result = JSON.parse(readFileSync(resultPath, "utf8"));
for (const gate of [
  "encrypted",
  "correctKeyRead",
  "missingKeyRejected",
  "wrongKeyRejected",
  "walCreated",
  "tempSpillCreated",
  "sensitiveValuesAbsent",
  "rejectedKeysPreservedDatabase"
]) {
  if (result[gate] !== true) {
    throw new Error(`Packaged Electron PoC failed the ${gate} gate.`);
  }
}
console.log(JSON.stringify({ executable, ...result }));

function findExecutable(directory) {
  const expectedName = process.platform === "win32"
    ? "Local Fitness Advisor DuckDB PoC.exe"
    : process.platform === "darwin"
      ? undefined
      : "local-fitness-advisor-duckdb-poc";
  if (expectedName && existsSync(join(directory, expectedName))) {
    return join(directory, expectedName);
  }
  const executable = readdirSync(directory)
    .find((entry) => process.platform === "win32" ? entry.endsWith(".exe") : !entry.includes("."));
  if (!executable) {
    throw new Error(`No packaged executable was found beneath ${directory}.`);
  }
  return join(directory, executable);
}

function run(executable, resultPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [], {
      env: {
        ...process.env,
        LFA_DUCKDB_POC_RESULT: resultPath
      },
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}