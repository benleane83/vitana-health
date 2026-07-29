import { readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../logger.js";

/**
 * Every atomic write in the storage layer stages its bytes in a sibling temp file and renames it
 * into place, cleaning up in a `finally`. That covers ordinary failures but not a hard kill - a
 * crash, a forced quit, or the OS terminating the process during shutdown - so temp files
 * accumulate in the data directory indefinitely. For DuckDB databases those are full-size copies,
 * so an unlucky user can silently lose gigabytes.
 *
 * Three different naming schemes are in use, so the sweep matches on the embedded PID rather than
 * on a single suffix:
 *   `<name>.tmp-<pid>-<timestamp>[-<hex>]`   (atomicWriteJson, secure-store-key)
 *   `<name>.<pid>.<hex>.tmp`                 (PairingStore.persist)
 *   `<name>.hydrating-<pid>-<hex>`           (DuckDbRepository.hydrate)
 */
const orphanPatterns: RegExp[] = [
  /\.tmp-(\d+)-\d+(?:-[0-9a-f]+)?$/,
  /\.(\d+)\.[0-9a-f]+\.tmp$/,
  /\.hydrating-(\d+)-[0-9a-f]+$/
];

/** A temp file is only safe to delete once nothing could still be writing to it. */
const minimumOrphanAgeMs = 5 * 60_000;

export interface SweepOrphanedTempFilesOptions {
  now?: number;
  /** Overridable so tests can simulate a live PID without spawning a process. */
  isProcessAlive?: (processId: number) => boolean;
}

function defaultIsProcessAlive(processId: number): boolean {
  if (processId === process.pid) return true;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user - treat that as alive.
    return (error as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

function orphanProcessId(fileName: string): number | undefined {
  for (const pattern of orphanPatterns) {
    const match = pattern.exec(fileName);
    if (match) {
      const processId = Number(match[1]);
      return Number.isSafeInteger(processId) && processId > 0 ? processId : undefined;
    }
  }
  return undefined;
}

/**
 * Deletes staged temp files left behind by processes that are no longer running.
 * Never throws: a sweep failure must not stop the app from opening its store.
 */
export function sweepOrphanedTempFiles(
  directories: string[],
  options: SweepOrphanedTempFilesOptions = {}
): number {
  const now = options.now ?? Date.now();
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  let removed = 0;

  for (const directory of new Set(directories)) {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const processId = orphanProcessId(entry);
      if (processId === undefined || isProcessAlive(processId)) continue;

      const path = resolve(directory, entry);
      try {
        if (now - statSync(path).mtimeMs < minimumOrphanAgeMs) continue;
        rmSync(path, { force: true, recursive: true });
        removed += 1;
      } catch (error) {
        log.warn(`Could not remove orphaned temp file ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (removed > 0) {
    log.info(`Removed ${removed} orphaned storage temp file(s) left by previous runs.`);
  }
  return removed;
}
