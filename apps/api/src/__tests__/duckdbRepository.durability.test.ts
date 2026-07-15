import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeDuckDbRoot } from "../storage/duckdbRuntime.js";
import { DuckDbRepository } from "../storage/duckdbRepository.js";
import { createDuckDbHealthStoreFixture } from "./support/duckdbFixture.js";

const httpfsExtensionPath = findPreparedExtension();
const workerPath = fileURLToPath(new URL("./support/duckdbCrashWorker.ts", import.meta.url));
const key = Buffer.alloc(32, 7).toString("base64");
let root: string;

beforeEach(() => {
  root = initializeDuckDbRoot(mkdtempSync(join(tmpdir(), "lfa-duckdb-durability-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("DuckDbRepository durability", () => {
  it.skipIf(!httpfsExtensionPath)("never promotes a database when hydration is terminated before atomic rename", async () => {
    const databasePath = join(root, "databases", "health-store-interrupted-hydration.duckdb-poc");
    const child = await runCrashWorker("hydrate", databasePath);
    expect(existsSync(databasePath)).toBe(false);

    await terminate(child);

    expect(existsSync(databasePath)).toBe(false);
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, createDuckDbHealthStoreFixture(), { httpfsExtensionPath });
    await repository.close();
    expect(existsSync(databasePath)).toBe(true);
  });

  it.skipIf(!httpfsExtensionPath)("rolls back a delete when the child process is terminated before commit", async () => {
    const databasePath = join(root, "databases", "health-store-interrupted-delete.duckdb-poc");
    const fixture = createDuckDbHealthStoreFixture();
    const repository = await DuckDbRepository.hydrate(root, databasePath, key, fixture, { httpfsExtensionPath });
    await repository.close();
    const child = await runCrashWorker("delete", databasePath);

    await terminate(child);

    const recovered = await DuckDbRepository.open(root, databasePath, key, { httpfsExtensionPath });
    try {
      expect(await recovered.snapshot()).toEqual(fixture);
    } finally {
      await recovered.close();
    }
  });
});

function runCrashWorker(mode: "hydrate" | "delete", databasePath: string): Promise<ChildProcess> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx", workerPath, mode, root, databasePath, key, httpfsExtensionPath!
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes("READY")) resolvePromise(child);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!stdout.includes("READY")) reject(new Error(`DuckDB crash worker exited before ready with code ${code}: ${stderr}`));
    });
  });
}

function terminate(child: ChildProcess): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolvePromise());
    if (!child.kill()) reject(new Error("Failed to terminate DuckDB crash worker."));
  });
}

function findPreparedExtension(): string | undefined {
  return [
    process.env.LFA_DUCKDB_HTTPFS_EXTENSION,
    resolve(process.cwd(), "apps", "desktop", "build", "duckdb-extensions", "httpfs.duckdb_extension")
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}