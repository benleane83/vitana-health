import { connect } from "node:net";
import { createReadStream, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type duckdb from "duckdb";
import { canonicalizeMeasurement } from "@vitana/shared";
import { all, exec, run } from "../storage/duckdbRows.js";
import {
  closeEncryptedDuckDbDatabase,
  createDuckDbSchema,
  openEncryptedDuckDbDatabase
} from "../storage/duckdbRuntime.js";
import { deriveProfileStorageKey } from "../storage/profileKey.js";
import { resolveStoreSecurityConfig } from "../storage/profileStoreManager.js";
import { reviveRow } from "./exportSerialization.js";

/**
 * Replays a `npm run export:profiles` capture into freshly created v1 baseline databases. This
 * exists because the historical v1-v14 migration chain was collapsed into a single baseline, so
 * existing local databases can no longer be opened in place. It is a developer tool for the
 * author's own test profiles, not an end-user migration.
 *
 * Companion sync state is deliberately not replayed: snapshots and change logs are derived,
 * device-scoped, and regenerate on the next sync.
 */

/**
 * DuckDB buffers an entire transaction before committing, and the runtime locks the database to a
 * modest memory limit, so a large table is replayed as a series of bounded commits. The staged
 * database is only promoted once the whole profile lands, so partial commits are never observable.
 */
const commitBatchSize = 20_000;

/** Rebuilt by the schema itself, so replaying them would fight the baseline. */
const skippedTables = new Set([
  "poc_metadata",
  "schema_objects",
  "companion_sync_state",
  "companion_sync_changes",
  "companion_sync_snapshots",
  "companion_sync_snapshot_entries"
]);

/** Parents must land before children now that the baseline declares foreign keys. */
const tableOrder = [
  "profile",
  "profile_media",
  "imports",
  "sources",
  "devices",
  "measurement_types",
  "personal_reference_ranges",
  "pinned_measurements",
  "observation_groups",
  "observations",
  "time_series_samples",
  "activities",
  "health_events",
  "immunizations",
  "medication_administrations",
  "medications",
  "care_items",
  "insights",
  "audit_events",
  "companion_migration_sessions",
  "companion_migration_batches",
  "companion_migration_aliases",
  "health_connect_sync_sessions",
  "health_connect_sync_batches"
];

interface ExportManifest {
  formatVersion: number;
  exportedAt: string;
  profiles: {
    profileId: string;
    databaseFile: string;
    schemaVersion: number;
    totalRows: number;
    tables: { name: string; rowCount: number; columns: { name: string }[]; file: string }[];
  }[];
}

const extensionPath = process.env.VITANA_DUCKDB_HTTPFS_EXTENSION;
if (!extensionPath) {
  throw new Error("VITANA_DUCKDB_HTTPFS_EXTENSION is required. Run this command through npm run import:profiles.");
}
if (await isPortOpen(4317)) {
  throw new Error("Stop the Vitana API before importing; port 4317 is currently in use.");
}

const exportDir = process.env.VITANA_EXPORT_DIR ? resolve(process.env.VITANA_EXPORT_DIR) : undefined;
if (!exportDir) {
  throw new Error("Set VITANA_EXPORT_DIR to a directory produced by npm run export:profiles.");
}
const dataDir = process.env.VITANA_DATA_DIR
  ? resolve(process.env.VITANA_DATA_DIR)
  : resolve(process.cwd(), "..", "..", "data");
const storageRoot = resolve(dataDir, "duckdb-storage");
const onlyProfiles = new Set(process.argv.slice(2).filter((value) => !value.startsWith("-")));

const manifest = JSON.parse(readFileSync(resolve(exportDir, "manifest.json"), "utf8")) as ExportManifest;
const { passphrase } = resolveStoreSecurityConfig();

const results: { profileId: string; imported: Record<string, number>; expected: Record<string, number> }[] = [];
for (const profile of manifest.profiles) {
  if (onlyProfiles.size > 0 && !onlyProfiles.has(profile.profileId)) continue;
  console.log(`\nImporting ${profile.profileId} (${profile.databaseFile})...`);
  results.push(await importProfile(profile));
}

let mismatches = 0;
console.log("\nParity against the export oracle:");
for (const result of results) {
  console.log(`\n=== ${result.profileId} ===`);
  for (const table of Object.keys(result.expected).sort()) {
    const expected = result.expected[table]!;
    const imported = result.imported[table] ?? 0;
    const status = skippedTables.has(table) ? "skipped" : imported === expected ? "ok" : "MISMATCH";
    if (status === "MISMATCH") mismatches += 1;
    console.log(`  ${table.padEnd(38)} ${String(imported).padStart(9)} / ${String(expected).padStart(9)}  ${status}`);
  }
}
if (mismatches > 0) {
  throw new Error(`${mismatches} table(s) did not match the exported row counts.`);
}
console.log("\nImport complete; all retained tables match the export.");

async function importProfile(profile: ExportManifest["profiles"][number]) {
  const targetPath = resolve(storageRoot, "databases", profile.databaseFile);
  const stagedPath = `${targetPath}.importing-${process.pid}`;
  rmSync(stagedPath, { force: true });
  rmSync(`${stagedPath}.wal`, { force: true });

  const key = deriveProfileStorageKey(passphrase, profile.profileId, "duckdb-v1");
  await createDuckDbSchema(storageRoot, stagedPath, key, { httpfsExtensionPath: extensionPath });
  const database = await openEncryptedDuckDbDatabase(storageRoot, stagedPath, key, {
    httpfsExtensionPath: extensionPath
  });

  const imported: Record<string, number> = {};
  const expected: Record<string, number> = {};
  try {
    const byName = new Map(profile.tables.map((table) => [table.name, table]));
    for (const table of profile.tables) {
      expected[table.name] = table.rowCount;
    }
    // The schema seeds a few rows (measurement types, sync state) that the export also captured,
    // so every replayed table is cleared first to keep the counts an exact comparison.
    await exec(database.connection, "BEGIN TRANSACTION;");
    for (const name of [...tableOrder].reverse()) {
      if (byName.has(name)) await run(database.connection, `DELETE FROM ${name};`);
    }
    await exec(database.connection, "COMMIT;");
    for (const name of tableOrder) {
      const table = byName.get(name);
      if (!table) continue;
      imported[name] = await replayTable(database.connection, name, resolve(exportDir!, table.file));
      console.log(`  ${name.padEnd(38)} ${String(imported[name]).padStart(9)}`);
    }
    await exec(database.connection, "CHECKPOINT;");
  } catch (error) {
    await exec(database.connection, "ROLLBACK;").catch(() => undefined);
    await closeEncryptedDuckDbDatabase(database).catch(() => undefined);
    rmSync(stagedPath, { force: true });
    rmSync(`${stagedPath}.wal`, { force: true });
    throw error;
  }
  await closeEncryptedDuckDbDatabase(database);

  // Only replace the live database once the whole replay committed cleanly.
  if (existsSync(targetPath)) {
    renameSync(targetPath, `${targetPath}.pre-baseline-${Date.now()}`);
  }
  rmSync(`${targetPath}.wal`, { force: true });
  renameSync(stagedPath, targetPath);
  rmSync(`${stagedPath}.wal`, { force: true });

  for (const name of Object.keys(expected)) {
    if (skippedTables.has(name)) imported[name] = expected[name]!;
  }
  return { profileId: profile.profileId, imported, expected };
}

async function replayTable(connection: duckdb.Connection, table: string, file: string): Promise<number> {
  if (skippedTables.has(table) || !existsSync(file)) return 0;
  const columns = await tableColumns(connection, table);
  // The duckdb node binding crashes the process when a BLOB parameter is more than a few bytes, so
  // binary columns travel as base64 text and are decoded by DuckDB - the same trick the write path
  // in duckdbCommands already uses.
  const placeholders = columns.map((column) => (column.isBlob ? "from_base64(?)" : "?")).join(", ");
  const names = columns.map((column) => column.name);
  const sql = `INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders});`;
  // Measurement rows predate canonicalization, so they are normalised on the way in rather than
  // left as a mix of units the aggregation views cannot sum.
  const canonicalizes = table === "observations" || table === "time_series_samples";

  let count = 0;
  let rejected = 0;
  let pending = 0;
  const reader = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  await exec(connection, "BEGIN TRANSACTION;");
  for await (const line of reader) {
    if (line.trim().length === 0) continue;
    const row = reviveRow(JSON.parse(line) as Record<string, unknown>);
    if (canonicalizes) {
      const canonical = canonicalizeMeasurement(
        String(row.measurement_code),
        Number(row.value),
        String(row.unit)
      );
      if (canonical.rejected) {
        rejected += 1;
        continue;
      }
      row.value = canonical.value;
      row.unit = canonical.unit;
      row.source_unit = canonical.sourceUnit ?? null;
    }
    await run(connection, sql, ...columns.map((column) => bindValue(row[column.name], column.isBlob)));
    count += 1;
    pending += 1;
    if (pending >= commitBatchSize) {
      await exec(connection, "COMMIT;");
      await exec(connection, "BEGIN TRANSACTION;");
      pending = 0;
    }
  }
  await exec(connection, "COMMIT;");
  if (rejected > 0) {
    console.log(`  ${table.padEnd(38)} ${String(rejected).padStart(9)} rejected (unconvertible unit)`);
  }
  // Rejections are a deliberate, reported loss rather than a replay failure, so they still count
  // towards parity with the export.
  return count + rejected;
}

interface ReplayColumn {
  name: string;
  isBlob: boolean;
}

function bindValue(value: unknown, isBlob: boolean): unknown {
  if (value === undefined || value === null) return null;
  if (isBlob && Buffer.isBuffer(value)) return value.toString("base64");
  // The binding treats a zero BigInt as an absent parameter, and every BIGINT the app writes is an
  // ordinal or a row count well inside the safe integer range anyway.
  if (typeof value === "bigint") return Number(value);
  return value;
}

async function tableColumns(connection: duckdb.Connection, table: string): Promise<ReplayColumn[]> {
  const rows = await all(
    connection,
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_catalog = current_database() AND table_schema = 'main' AND table_name = '${table}'
     ORDER BY ordinal_position;`
  );
  return rows.map((row) => ({
    name: String(row.column_name),
    isBlob: String(row.data_type).toUpperCase() === "BLOB"
  }));
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolvePromise(false);
    });
  });
}
