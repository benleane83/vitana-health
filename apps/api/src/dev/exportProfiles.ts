import { createHash } from "node:crypto";
import { connect } from "node:net";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import type duckdb from "duckdb";
import { all } from "../storage/duckdbRows.js";
import {
  closeEncryptedDuckDbDatabase,
  openEncryptedDuckDbDatabase
} from "../storage/duckdbRuntime.js";
import { deriveProfileStorageKey } from "../storage/profileKey.js";
import { resolveStoreSecurityConfig } from "../storage/profileStoreManager.js";
import { serializeRow } from "./exportSerialization.js";

/**
 * Preserves every local profile as a raw, table-by-table snapshot of the encrypted DuckDB
 * database *before* the schema is collapsed to a single v1 baseline. The output is deliberately
 * schema-shaped rather than API-shaped: it captures every table and column verbatim so the
 * companion importer can replay it into the new baseline, and the per-table row counts act as
 * the parity oracle for that replay.
 */

const EXPORT_FORMAT_VERSION = 1;

interface TableSummary {
  name: string;
  rowCount: number;
  columns: { name: string; type: string }[];
  file: string;
  sha256: string;
}

interface ProfileSummary {
  profileId: string;
  displayName?: string;
  databaseFile: string;
  schemaVersion: number;
  totalRows: number;
  tables: TableSummary[];
}

const extensionPath = process.env.VITANA_DUCKDB_HTTPFS_EXTENSION;
if (!extensionPath) {
  throw new Error("VITANA_DUCKDB_HTTPFS_EXTENSION is required. Run this command through npm run export:profiles.");
}
if (await isPortOpen(4317)) {
  throw new Error("Stop the Vitana API before exporting; port 4317 is currently in use.");
}

const dataDir = process.env.VITANA_DATA_DIR
  ? resolve(process.env.VITANA_DATA_DIR)
  : resolve(process.cwd(), "..", "..", "data");
const storageRoot = resolve(dataDir, "duckdb-storage");
// npm run swallows unknown `--flags`, so the profile filter is positional and the output
// directory comes from an environment variable.
const onlyProfiles = new Set(process.argv.slice(2).filter((value) => !value.startsWith("-")));
const outputDir = resolve(
  process.env.VITANA_EXPORT_OUT ?? resolve(dataDir, "profile-exports", timestampSlug())
);
const stagingRoot = resolve(storageRoot, `export-staging-${process.pid}-${Date.now()}`);

const manifest = readJson<{ profiles: { profileId: string; databaseFile: string }[] }>(
  resolve(dataDir, "storage-backend.json")
);
const registry = readJson<{ profiles: { id: string; displayName?: string }[] }>(
  resolve(dataDir, "profiles.json")
);
const displayNames = new Map(registry.profiles.map((entry) => [entry.id, entry.displayName]));
const { passphrase } = resolveStoreSecurityConfig();

mkdirSync(outputDir, { recursive: true, mode: 0o700 });
mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });

const summaries: ProfileSummary[] = [];
try {
  for (const entry of manifest.profiles) {
    if (onlyProfiles.size > 0 && !onlyProfiles.has(entry.profileId)) continue;
    console.log(`\nExporting ${entry.profileId} (${entry.databaseFile})...`);
    summaries.push(await exportProfile(entry.profileId, entry.databaseFile));
  }
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}

const manifestPath = resolve(outputDir, "manifest.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      dataDir,
      profiles: summaries
    },
    null,
    2
  )}\n`,
  { encoding: "utf8", mode: 0o600 }
);

console.log(`\nExport complete: ${manifestPath}`);

// The row counts are the parity oracle for the companion importer, so keep them in a
// diff-friendly file rather than only inside the machine-readable manifest.
const countsPath = resolve(outputDir, "row-counts.md");
writeFileSync(
  countsPath,
  `# Profile export row counts\n\nExported ${new Date().toISOString()} from \`${dataDir}\`.\n\n` +
    summaries
      .map((profile) =>
        `## ${profile.profileId}${profile.displayName ? ` (${profile.displayName})` : ""}\n\n` +
          `Schema v${profile.schemaVersion}, ${profile.totalRows} rows total.\n\n` +
          "| Table | Rows |\n| --- | ---: |\n" +
          profile.tables
            .filter((table) => table.rowCount > 0)
            .map((table) => `| ${table.name} | ${table.rowCount} |`)
            .join("\n")
      )
      .join("\n\n") +
    "\n",
  { encoding: "utf8", mode: 0o600 }
);
console.log(`Row counts: ${countsPath}`);

async function exportProfile(profileId: string, databaseFile: string): Promise<ProfileSummary> {
  const livePath = resolve(storageRoot, "databases", databaseFile);
  if (!existsSync(livePath)) {
    throw new Error(`Profile database ${livePath} is missing.`);
  }

  // Copy the live database (and its write-ahead log) so the export can never mutate real data.
  // The copy must stay beneath the marked storage root for the runtime to attach it.
  const stagedPath = resolve(stagingRoot, databaseFile);
  console.log("  copying database...");
  copyFileSync(livePath, stagedPath);
  if (existsSync(`${livePath}.wal`)) {
    copyFileSync(`${livePath}.wal`, `${stagedPath}.wal`);
  }

  console.log("  attaching...");
  const key = deriveProfileStorageKey(passphrase, profileId, "duckdb-v1");
  const database = await openEncryptedDuckDbDatabase(storageRoot, stagedPath, key, {
    httpfsExtensionPath: extensionPath
  });
  try {
    console.log("  attached");
    const profileDir = resolve(outputDir, profileId);
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });

    const versionRows = await all(database.connection, "SELECT schema_version FROM poc_metadata ORDER BY schema_version;");
    const detectedVersion = Number(versionRows.at(-1)?.schema_version ?? 0);
    console.log(`  schema v${detectedVersion}`);
    if (detectedVersion === 0) {
      throw new Error(`Profile ${profileId} has no schema metadata; refusing to export an unreadable database.`);
    }

    const tableRows = await all(
      database.connection,
      `SELECT table_name FROM information_schema.tables
       WHERE table_catalog = current_database() AND table_schema = 'main' AND table_type = 'BASE TABLE'
       ORDER BY table_name;`
    );

    const tables: TableSummary[] = [];
    for (const row of tableRows) {
      const tableName = String(row.table_name);
      const summary = await exportTable(database.connection, tableName, profileId, profileDir);
      console.log(`  ${tableName.padEnd(36)} ${String(summary.rowCount).padStart(9)}`);
      tables.push(summary);
    }

    return {
      profileId,
      ...(displayNames.get(profileId) ? { displayName: displayNames.get(profileId) } : {}),
      databaseFile,
      schemaVersion: detectedVersion,
      totalRows: tables.reduce((total, table) => total + table.rowCount, 0),
      tables
    };
  } finally {
    await closeEncryptedDuckDbDatabase(database);
  }
}

async function exportTable(
  connection: duckdb.Connection,
  tableName: string,
  profileId: string,
  profileDir: string
): Promise<TableSummary> {
  const columnRows = await all(
    connection,
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_catalog = current_database() AND table_schema = 'main' AND table_name = '${escapeLiteral(tableName)}'
     ORDER BY ordinal_position;`
  );
  const columns = columnRows.map((row) => ({ name: String(row.column_name), type: String(row.data_type) }));

  const relativePath = `${profileId}/${tableName}.ndjson`;
  const filePath = resolve(profileDir, `${tableName}.ndjson`);
  const stream = createWriteStream(filePath, { encoding: "utf8", mode: 0o600 });
  const digest = createHash("sha256");

  let rowCount = 0;
  let buffered: string[] = [];
  const flush = async (): Promise<void> => {
    if (buffered.length === 0) return;
    const chunk = buffered.join("");
    buffered = [];
    digest.update(chunk, "utf8");
    if (!stream.write(chunk)) {
      await new Promise<void>((resolvePromise) => stream.once("drain", resolvePromise));
    }
  };

  for await (const row of connection.stream(`SELECT * FROM "${escapeIdentifier(tableName)}";`)) {
    rowCount += 1;
    buffered.push(`${JSON.stringify(serializeRow(row as Record<string, unknown>))}\n`);
    if (buffered.length >= 500) await flush();
  }
  await flush();
  await new Promise<void>((resolvePromise, reject) => {
    stream.once("error", reject);
    stream.end(resolvePromise);
  });

  return { name: tableName, rowCount, columns, file: relativePath, sha256: digest.digest("hex") };
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`Expected ${path} to exist. Run the app once before exporting.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function escapeIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Refusing to export table with an unexpected name: ${value}`);
  }
  return value;
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}


function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
