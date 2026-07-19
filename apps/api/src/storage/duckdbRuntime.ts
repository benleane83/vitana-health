import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import duckdb from "duckdb";
import {
  aiCareItemsViewSql,
  aiHealthEventsViewSql,
  dailyMetricsViewSql,
  weeklyMetricsViewSql
} from "../analyticalViews.js";

const markerName = ".lfa-duckdb-poc";
const schemaVersion = 7;

export interface DuckDbOptions {
  httpfsExtensionPath?: string;
  memoryLimit?: "64MB" | "256MB";
  testHooks?: {
    beforeHydrationPromotion?: () => Promise<void>;
    beforeTransactionCommit?: () => Promise<void>;
  };
}

export interface EncryptedDuckDbDatabase {
  database: duckdb.Database;
  connection: duckdb.Connection;
}

export function initializeDuckDbRoot(root: string): string {
  const resolvedRoot = resolve(root);
  mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
  for (const directory of ["databases", "extensions", "temp"]) {
    mkdirSync(resolve(resolvedRoot, directory), { recursive: true, mode: 0o700 });
  }
  writeFileSync(resolve(resolvedRoot, markerName), "Local Fitness Advisor encrypted DuckDB PoC\n", {
    mode: 0o600
  });
  return resolvedRoot;
}

export function assertDuckDbRoot(root: string): string {
  const resolvedRoot = resolve(root);
  const markerPath = resolve(resolvedRoot, markerName);
  if (!existsSync(markerPath) || readFileSync(markerPath, "utf8") !== "Local Fitness Advisor encrypted DuckDB PoC\n") {
    throw new Error(`Refusing to use an unmarked encrypted DuckDB root: ${resolvedRoot}`);
  }
  return resolvedRoot;
}

export async function createDuckDbSchema(
  root: string,
  databasePath: string,
  key: string,
  options: DuckDbOptions = {},
  targetSchemaVersion = schemaVersion
): Promise<void> {
  const database = await openEncryptedDuckDbDatabase(root, databasePath, key, options);
  try {
    await migrateDuckDbSchema(database, targetSchemaVersion, true);
    await exec(database.connection, "CHECKPOINT;");
  } finally {
    await closeEncryptedDuckDbDatabase(database);
  }
}

export async function migrateDuckDbSchema(
  database: EncryptedDuckDbDatabase,
  targetSchemaVersion = schemaVersion,
  allowBootstrap = false
): Promise<number> {
  if (!Number.isInteger(targetSchemaVersion) || targetSchemaVersion < 1 || targetSchemaVersion > schemaVersion) {
    throw new Error(`Encrypted DuckDB schema target version ${targetSchemaVersion} is unsupported.`);
  }
  const metadataRows = await all(database.connection, `SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_catalog = current_database() AND table_name = 'poc_metadata';`);
  const hasMetadata = Number(metadataRows[0]?.count ?? 0) === 1;
  if (!hasMetadata && !allowBootstrap) {
    throw new Error("Encrypted DuckDB schema metadata is missing.");
  }
  const versionRows = hasMetadata
    ? await all(database.connection, "SELECT schema_version FROM poc_metadata ORDER BY schema_version;")
    : [];
  const versions = versionRows.map((row) => Number(row.schema_version));
  if (hasMetadata && (versions.length === 0 || versions.some((version, index) => version !== index + 1))) {
    throw new Error("Encrypted DuckDB schema metadata history is malformed.");
  }
  const currentVersion = versions.at(-1) ?? 0;
  if (currentVersion > schemaVersion) {
    throw new Error(`Encrypted DuckDB schema version ${currentVersion} is newer than supported version ${schemaVersion}.`);
  }
  if (currentVersion >= targetSchemaVersion) {
    return currentVersion;
  }

  await exec(database.connection, "BEGIN TRANSACTION;");
  try {
    for (const migration of schemaMigrations) {
      if (migration.version > currentVersion && migration.version <= targetSchemaVersion) {
        await exec(database.connection, migration.sql);
      }
    }
    await exec(database.connection, "COMMIT;");
    return targetSchemaVersion;
  } catch (error) {
    await exec(database.connection, "ROLLBACK;").catch(() => undefined);
    throw error;
  }
}

export async function openEncryptedDuckDbDatabase(
  root: string,
  databasePath: string,
  key: string,
  options: DuckDbOptions = {}
): Promise<EncryptedDuckDbDatabase> {
  const duckDbRoot = assertDuckDbRoot(root);
  const resolvedDatabasePath = resolve(databasePath);
  if (!isWithin(duckDbRoot, resolvedDatabasePath)) {
    throw new Error("Encrypted DuckDB databases must remain beneath the marked storage root.");
  }
  mkdirSync(dirname(resolvedDatabasePath), { recursive: true, mode: 0o700 });
  const database = await openDatabase(duckDbRoot, options);
  try {
    await attachEncrypted(database, resolvedDatabasePath, key, options.httpfsExtensionPath);
    return database;
  } catch (error) {
    await closeDatabase(database, false);
    throw error;
  }
}

export async function closeEncryptedDuckDbDatabase(database: EncryptedDuckDbDatabase): Promise<void> {
  await closeDatabase(database, true);
}

async function openDatabase(
  root: string,
  options: DuckDbOptions = {}
): Promise<{ database: duckdb.Database; connection: duckdb.Connection }> {
  const database = await new Promise<duckdb.Database>((resolvePromise, reject) => {
    const opened = new duckdb.Database(":memory:", {
      allow_community_extensions: "false",
      allow_unsigned_extensions: "false",
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
      extension_directory: resolve(root, "extensions"),
      max_temp_directory_size: "256MB",
      memory_limit: options.memoryLimit ?? "64MB",
      preserve_insertion_order: "false",
      temp_directory: resolve(root, "temp"),
      temp_file_encryption: "true",
      threads: "1"
    }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise(opened);
    });
  });
  const connection = database.connect();
  await exec(connection, "SET TimeZone = 'UTC';");
  await exec(
    connection,
    `SET allowed_directories = ['${assertDatabasePath(resolve(root, "temp"))}'];`
  );
  return { database, connection };
}

async function attachEncrypted(
  database: { connection: duckdb.Connection },
  databasePath: string,
  key?: string,
  httpfsExtensionPath?: string
): Promise<void> {
  if (httpfsExtensionPath) {
    await exec(database.connection, `LOAD '${assertDatabasePath(resolve(httpfsExtensionPath))}';`);
  }
  const options = key
    ? ` (ENCRYPTION_KEY '${assertEncryptionKey(key)}', ENCRYPTION_CIPHER 'GCM')`
    : "";
  await exec(
    database.connection,
    `ATTACH '${assertDatabasePath(databasePath)}' AS poc${options}; USE poc; ` +
      "SET enable_external_access = false; SET lock_configuration = true;"
  );
}

function assertEncryptionKey(value: string): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("DuckDB encryption keys must be base64-encoded values.");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("DuckDB encryption keys must be 256-bit values.");
  }
  return key.toString("base64");
}

function assertDatabasePath(value: string): string {
  if (/['\0\r\n]/.test(value)) {
    throw new Error("DuckDB database paths contain unsupported characters.");
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

async function closeDatabase(
  database: { database: duckdb.Database; connection: duckdb.Connection },
  attached: boolean
): Promise<void> {
  if (attached) {
    await exec(database.connection, "USE memory; DETACH poc;");
  }
  await new Promise<void>((resolvePromise, reject) => {
    database.connection.close((error) => error ? reject(error) : resolvePromise());
  });
  await new Promise<void>((resolvePromise, reject) => {
    database.database.close((error) => error ? reject(error) : resolvePromise());
  });
}

const schemaVersion1Sql = `
  CREATE TABLE IF NOT EXISTS poc_metadata (
    schema_version INTEGER PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL,
    description VARCHAR NOT NULL
  );
  INSERT OR IGNORE INTO poc_metadata VALUES (1, CURRENT_TIMESTAMP, 'Initial encrypted DuckDB PoC schema');
  CREATE TABLE IF NOT EXISTS profile (
    id VARCHAR PRIMARY KEY, display_name VARCHAR NOT NULL, birth_year INTEGER, sex VARCHAR, height_cm DOUBLE,
    blood_type VARCHAR, goal_summary VARCHAR, units VARCHAR NOT NULL, updated_at TIMESTAMP NOT NULL, custom_properties JSON
  );
  CREATE TABLE IF NOT EXISTS imports (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, source_kind VARCHAR NOT NULL, file_name VARCHAR NOT NULL, imported_at TIMESTAMP NOT NULL,
    parser_version VARCHAR NOT NULL, checksum VARCHAR NOT NULL, row_count BIGINT NOT NULL, status VARCHAR NOT NULL,
    diagnostics JSON NOT NULL, raw_content VARCHAR
  );
  CREATE TABLE IF NOT EXISTS sources (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, source_kind VARCHAR NOT NULL, label VARCHAR NOT NULL, import_id VARCHAR, created_at TIMESTAMP NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, label VARCHAR NOT NULL, manufacturer VARCHAR, model VARCHAR, source_id VARCHAR
  );
  CREATE TABLE IF NOT EXISTS measurement_types (
    ordinal BIGINT NOT NULL UNIQUE, code VARCHAR PRIMARY KEY, display VARCHAR NOT NULL, category VARCHAR NOT NULL, kind VARCHAR NOT NULL,
    canonical_unit VARCHAR NOT NULL, aliases JSON NOT NULL, aggregation VARCHAR NOT NULL, custom_properties JSON
  );
  CREATE TABLE IF NOT EXISTS observation_groups (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, label VARCHAR NOT NULL, source_id VARCHAR, import_id VARCHAR,
    start_at TIMESTAMP, end_at TIMESTAMP, collected_at TIMESTAMP, metadata JSON
  );
  CREATE TABLE IF NOT EXISTS observations (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, measurement_code VARCHAR NOT NULL, observed_at TIMESTAMP NOT NULL, effective_start TIMESTAMP,
    effective_end TIMESTAMP, value DOUBLE NOT NULL, unit VARCHAR NOT NULL, source_id VARCHAR NOT NULL,
    observation_group_id VARCHAR, device_id VARCHAR, note VARCHAR, source_json_present BOOLEAN NOT NULL, source_json JSON
  );
  CREATE TABLE IF NOT EXISTS time_series_samples (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, measurement_code VARCHAR NOT NULL, start_at TIMESTAMP NOT NULL, end_at TIMESTAMP NOT NULL,
    value DOUBLE NOT NULL, unit VARCHAR NOT NULL, source_id VARCHAR NOT NULL, device_id VARCHAR, source_json_present BOOLEAN NOT NULL, source_json JSON
  );
  CREATE TABLE IF NOT EXISTS activities (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, activity_type VARCHAR NOT NULL, start_at TIMESTAMP NOT NULL, end_at TIMESTAMP,
    duration_minutes DOUBLE, energy_kcal DOUBLE, distance_meters DOUBLE, source_id VARCHAR NOT NULL, source_json_present BOOLEAN NOT NULL, source_json JSON
  );
  CREATE TABLE IF NOT EXISTS insights (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, created_at TIMESTAMP NOT NULL, title VARCHAR NOT NULL, body VARCHAR NOT NULL,
    evidence JSON NOT NULL, confidence VARCHAR NOT NULL, model VARCHAR NOT NULL, safety_notice VARCHAR NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, created_at TIMESTAMP NOT NULL, event_type VARCHAR NOT NULL, detail VARCHAR NOT NULL
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

const schemaVersion2Sql = `
  ${dailyMetricsViewSql};
  ${weeklyMetricsViewSql};
  INSERT OR IGNORE INTO poc_metadata VALUES (2, CURRENT_TIMESTAMP, 'Daily and weekly analytical views');
`;

const schemaVersion3Sql = `
  ALTER TABLE profile ADD COLUMN IF NOT EXISTS subject_kind VARCHAR DEFAULT 'adult';
  ALTER TABLE profile ADD COLUMN IF NOT EXISTS birth_date DATE;
  ALTER TABLE profile ADD COLUMN IF NOT EXISTS pet_species VARCHAR;
  ALTER TABLE profile ADD COLUMN IF NOT EXISTS pet_breed VARCHAR;
  ALTER TABLE profile ADD COLUMN IF NOT EXISTS pet_reproductive_status VARCHAR;
  ALTER TABLE profile ADD COLUMN IF NOT EXISTS pet_microchip_id VARCHAR;
  CREATE TABLE IF NOT EXISTS health_events (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, status VARCHAR NOT NULL,
    occurred_at TIMESTAMP NOT NULL, occurred_end TIMESTAMP, source VARCHAR NOT NULL, provider VARCHAR, notes VARCHAR, metadata JSON
  );
  CREATE TABLE IF NOT EXISTS immunizations (
    health_event_id VARCHAR PRIMARY KEY, vaccine VARCHAR NOT NULL, target_disease VARCHAR, dose_number INTEGER, series VARCHAR,
    manufacturer VARCHAR, lot_number VARCHAR, expires_at DATE, route VARCHAR, site VARCHAR, reaction VARCHAR
  );
  CREATE TABLE IF NOT EXISTS medication_administrations (
    health_event_id VARCHAR PRIMARY KEY, medication VARCHAR NOT NULL, active_ingredient VARCHAR, dose DOUBLE NOT NULL, unit VARCHAR NOT NULL, route VARCHAR
  );
  CREATE TABLE IF NOT EXISTS care_items (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, code VARCHAR, title VARCHAR NOT NULL,
    due_start TIMESTAMP, due_end TIMESTAMP, reminder_at TIMESTAMP, priority VARCHAR NOT NULL, status VARCHAR NOT NULL,
    schedule_provenance VARCHAR, schedule_version VARCHAR, notes VARCHAR, originating_health_event_id VARCHAR,
    completed_health_event_id VARCHAR, completed_at TIMESTAMP
  );
  DROP TABLE IF EXISTS medication_events;
  DROP TABLE IF EXISTS symptom_events;
  DROP TABLE IF EXISTS stress_events;
  INSERT OR IGNORE INTO poc_metadata VALUES (3, CURRENT_TIMESTAMP, 'Profile identity, health events, and care items');
`;

const schemaVersion4Sql = `
  ALTER TABLE profile DROP COLUMN IF EXISTS birth_year;
  INSERT OR IGNORE INTO poc_metadata VALUES (4, CURRENT_TIMESTAMP, 'Remove legacy profile birth year');
`;

const schemaVersion5Sql = `
  UPDATE observations
  SET value = value / 100
  WHERE measurement_code = 'oxygen_saturation'
    AND unit = '%'
    AND source_id IN (SELECT id FROM sources WHERE source_kind = 'health-connect');
  UPDATE time_series_samples
  SET value = value / 1000
  WHERE measurement_code IN ('active_energy_burned', 'total_calories_burned')
    AND unit = 'kcal'
    AND source_id IN (SELECT id FROM sources WHERE source_kind = 'health-connect');
  INSERT OR IGNORE INTO poc_metadata VALUES (5, CURRENT_TIMESTAMP, 'Correct Health Connect percentage and calorie scales');
`;

const schemaVersion6Sql = `
  ${aiHealthEventsViewSql};
  ${aiCareItemsViewSql};
  INSERT OR IGNORE INTO poc_metadata VALUES (6, CURRENT_TIMESTAMP, 'AI query views for health events and care items');
`;

const schemaVersion7Sql = `
  CREATE TABLE IF NOT EXISTS personal_reference_ranges (
    measurement_code VARCHAR PRIMARY KEY,
    low DOUBLE,
    high DOUBLE,
    unit VARCHAR NOT NULL,
    updated_at TIMESTAMP NOT NULL
  );
  INSERT OR IGNORE INTO poc_metadata VALUES (7, CURRENT_TIMESTAMP, 'Profile-owned personal reference ranges');
`;

const schemaMigrations = [
  { version: 1, sql: schemaVersion1Sql },
  { version: 2, sql: schemaVersion2Sql },
  { version: 3, sql: schemaVersion3Sql },
  { version: 4, sql: schemaVersion4Sql },
  { version: 5, sql: schemaVersion5Sql },
  { version: 6, sql: schemaVersion6Sql },
  { version: 7, sql: schemaVersion7Sql }
] as const;
