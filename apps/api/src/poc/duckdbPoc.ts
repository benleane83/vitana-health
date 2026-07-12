import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import duckdb from "duckdb";

const markerName = ".lfa-duckdb-poc";
const schemaVersion = 1;

export interface NativeEncryptionProbeResult {
  databasePath: string;
  encrypted: boolean;
  correctKeyRead: boolean;
  missingKeyRejected: boolean;
  wrongKeyRejected: boolean;
}

export function initializePocRoot(root: string): string {
  const resolvedRoot = resolve(root);
  mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
  for (const directory of ["input-copy", "databases", "temp", "keys", "results"]) {
    mkdirSync(resolve(resolvedRoot, directory), { recursive: true, mode: 0o700 });
  }
  writeFileSync(resolve(resolvedRoot, markerName), "Local Fitness Advisor encrypted DuckDB PoC\n", {
    mode: 0o600
  });
  return resolvedRoot;
}

export function assertPocRoot(root: string): string {
  const resolvedRoot = resolve(root);
  const markerPath = resolve(resolvedRoot, markerName);
  if (!existsSync(markerPath) || readFileSync(markerPath, "utf8") !== "Local Fitness Advisor encrypted DuckDB PoC\n") {
    throw new Error(`Refusing to use an unmarked DuckDB PoC root: ${resolvedRoot}`);
  }
  return resolvedRoot;
}

export async function proveNativeEncryption(root: string): Promise<NativeEncryptionProbeResult> {
  const pocRoot = assertPocRoot(root);
  const databasePath = resolve(pocRoot, "databases", `native-encryption-${randomBytes(8).toString("hex")}.duckdb-poc`);
  const key = randomBytes(32).toString("base64");
  const marker = `health-marker-${randomBytes(16).toString("hex")}`;

  const initial = await openDatabase(pocRoot);
  try {
    await attachEncrypted(initial, databasePath, key);
    await exec(initial.connection, "CREATE TABLE encryption_probe (marker VARCHAR PRIMARY KEY);");
    await run(initial.connection, "INSERT INTO encryption_probe VALUES (?);", marker);
    await exec(initial.connection, "CHECKPOINT;");
  } finally {
    await closeDatabase(initial);
  }

  const correctKeyRead = await readMarker(pocRoot, databasePath, key, marker);
  const missingKeyRejected = await attachFails(pocRoot, databasePath);
  const wrongKeyRejected = await attachFails(pocRoot, databasePath, randomBytes(32).toString("base64"));
  const databaseContents = readFileSync(databasePath);

  return {
    databasePath,
    encrypted: !databaseContents.includes(Buffer.from(marker)),
    correctKeyRead,
    missingKeyRejected,
    wrongKeyRejected
  };
}

export async function createPocSchema(root: string, databasePath: string, key: string): Promise<void> {
  const pocRoot = assertPocRoot(root);
  const resolvedDatabasePath = resolve(databasePath);
  if (!isWithin(pocRoot, resolvedDatabasePath)) {
    throw new Error("DuckDB PoC databases must remain beneath the marked PoC root.");
  }
  mkdirSync(dirname(resolvedDatabasePath), { recursive: true, mode: 0o700 });
  const database = await openDatabase(pocRoot);
  try {
    await attachEncrypted(database, resolvedDatabasePath, key);
    await exec(database.connection, schemaSql);
    await exec(database.connection, "CHECKPOINT;");
  } finally {
    await closeDatabase(database);
  }
}

async function readMarker(root: string, databasePath: string, key: string, marker: string): Promise<boolean> {
  const database = await openDatabase(root);
  try {
    await attachEncrypted(database, databasePath, key);
    const rows = await all(database.connection, "SELECT marker FROM encryption_probe;");
    return rows.length === 1 && rows[0]?.marker === marker;
  } finally {
    await closeDatabase(database);
  }
}

async function attachFails(root: string, databasePath: string, key?: string): Promise<boolean> {
  const database = await openDatabase(root);
  try {
    await attachEncrypted(database, databasePath, key);
    return false;
  } catch {
    return true;
  } finally {
    await closeDatabase(database);
  }
}

async function openDatabase(root: string): Promise<{ database: duckdb.Database; connection: duckdb.Connection }> {
  const database = await new Promise<duckdb.Database>((resolvePromise, reject) => {
    const opened = new duckdb.Database(":memory:", {
      enable_external_access: "false",
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
      temp_directory: resolve(root, "temp")
    }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise(opened);
    });
  });
  return { database, connection: database.connect() };
}

async function attachEncrypted(
  database: { connection: duckdb.Connection },
  databasePath: string,
  key?: string
): Promise<void> {
  const options = key
    ? ` (ENCRYPTION_KEY '${assertEncryptionKey(key)}', ENCRYPTION_CIPHER 'AES-GCM')`
    : "";
  await exec(database.connection, `ATTACH '${assertDatabasePath(databasePath)}' AS poc${options}; USE poc;`);
}

function assertEncryptionKey(value: string): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("DuckDB PoC encryption keys must be base64-encoded values.");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("DuckDB PoC encryption keys must be 256-bit values.");
  }
  return key.toString("base64");
}

function assertDatabasePath(value: string): string {
  if (/['\0\r\n]/.test(value)) {
    throw new Error("DuckDB PoC database paths contain unsupported characters.");
  }
  return value;
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent.length > 0 && pathFromParent !== ".." && !pathFromParent.startsWith("../") &&
    !pathFromParent.startsWith("..\\") && !isAbsolute(pathFromParent);
}

function exec(connection: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.exec(sql, (error) => error ? reject(error) : resolvePromise());
  });
}

function run(connection: duckdb.Connection, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    connection.run(sql, ...params, (error) => error ? reject(error) : resolvePromise());
  });
}

function all(connection: duckdb.Connection, sql: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolvePromise, reject) => {
    connection.all(sql, (error, rows) => error ? reject(error) : resolvePromise((rows ?? []) as Array<Record<string, unknown>>));
  });
}

async function closeDatabase(database: { database: duckdb.Database; connection: duckdb.Connection }): Promise<void> {
  await new Promise<void>((resolvePromise) => database.connection.close(() => resolvePromise()));
  await new Promise<void>((resolvePromise) => database.database.close(() => resolvePromise()));
}

const schemaSql = `
  CREATE TABLE IF NOT EXISTS poc_metadata (
    schema_version INTEGER PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL,
    description VARCHAR NOT NULL
  );
  INSERT OR IGNORE INTO poc_metadata VALUES (${schemaVersion}, CURRENT_TIMESTAMP, 'Initial encrypted DuckDB PoC schema');
  CREATE TABLE IF NOT EXISTS profile (
    id VARCHAR PRIMARY KEY, display_name VARCHAR NOT NULL, birth_year INTEGER, sex VARCHAR, height_cm DOUBLE,
    blood_type VARCHAR, goal_summary VARCHAR, units VARCHAR NOT NULL, updated_at TIMESTAMP NOT NULL, custom_properties JSON
  );
  CREATE TABLE IF NOT EXISTS imports (
    id VARCHAR PRIMARY KEY, source_kind VARCHAR NOT NULL, file_name VARCHAR NOT NULL, imported_at TIMESTAMP NOT NULL,
    parser_version VARCHAR NOT NULL, checksum VARCHAR NOT NULL, row_count BIGINT NOT NULL, status VARCHAR NOT NULL,
    diagnostics JSON NOT NULL, raw_content VARCHAR
  );
  CREATE TABLE IF NOT EXISTS sources (
    id VARCHAR PRIMARY KEY, source_kind VARCHAR NOT NULL, label VARCHAR NOT NULL, import_id VARCHAR, created_at TIMESTAMP NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR PRIMARY KEY, label VARCHAR NOT NULL, manufacturer VARCHAR, model VARCHAR, source_id VARCHAR
  );
  CREATE TABLE IF NOT EXISTS measurement_types (
    code VARCHAR PRIMARY KEY, display VARCHAR NOT NULL, category VARCHAR NOT NULL, kind VARCHAR NOT NULL,
    canonical_unit VARCHAR NOT NULL, aliases JSON NOT NULL, aggregation VARCHAR NOT NULL, custom_properties JSON
  );
  CREATE TABLE IF NOT EXISTS observation_groups (
    id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, label VARCHAR NOT NULL, source_id VARCHAR, import_id VARCHAR,
    start_at TIMESTAMP, end_at TIMESTAMP, collected_at TIMESTAMP, metadata JSON
  );
  CREATE TABLE IF NOT EXISTS observations (
    id VARCHAR PRIMARY KEY, measurement_code VARCHAR NOT NULL, observed_at TIMESTAMP NOT NULL, effective_start TIMESTAMP,
    effective_end TIMESTAMP, value DOUBLE NOT NULL, unit VARCHAR NOT NULL, source_id VARCHAR NOT NULL,
    observation_group_id VARCHAR, device_id VARCHAR, note VARCHAR, source_json JSON
  );
  CREATE TABLE IF NOT EXISTS time_series_samples (
    id VARCHAR PRIMARY KEY, measurement_code VARCHAR NOT NULL, start_at TIMESTAMP NOT NULL, end_at TIMESTAMP NOT NULL,
    value DOUBLE NOT NULL, unit VARCHAR NOT NULL, source_id VARCHAR NOT NULL, device_id VARCHAR, source_json JSON
  );
  CREATE TABLE IF NOT EXISTS activities (
    id VARCHAR PRIMARY KEY, activity_type VARCHAR NOT NULL, start_at TIMESTAMP NOT NULL, end_at TIMESTAMP,
    duration_minutes DOUBLE, energy_kcal DOUBLE, distance_meters DOUBLE, source_id VARCHAR NOT NULL, source_json JSON
  );
  CREATE TABLE IF NOT EXISTS insights (
    id VARCHAR PRIMARY KEY, created_at TIMESTAMP NOT NULL, title VARCHAR NOT NULL, body VARCHAR NOT NULL,
    evidence JSON NOT NULL, confidence VARCHAR NOT NULL, model VARCHAR NOT NULL, safety_notice VARCHAR NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR PRIMARY KEY, created_at TIMESTAMP NOT NULL, event_type VARCHAR NOT NULL, detail VARCHAR NOT NULL
  );
  CREATE TABLE IF NOT EXISTS medication_events (
    id VARCHAR PRIMARY KEY, occurred_at TIMESTAMP NOT NULL, medication_name VARCHAR NOT NULL, dose DOUBLE, unit VARCHAR, custom_properties JSON
  );
  CREATE TABLE IF NOT EXISTS symptom_events (
    id VARCHAR PRIMARY KEY, occurred_at TIMESTAMP NOT NULL, symptom_code VARCHAR NOT NULL, severity INTEGER, custom_properties JSON
  );
  CREATE TABLE IF NOT EXISTS stress_events (
    id VARCHAR PRIMARY KEY, occurred_at TIMESTAMP NOT NULL, score INTEGER, source VARCHAR, custom_properties JSON
  );
`;
