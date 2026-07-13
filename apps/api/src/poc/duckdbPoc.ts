import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import duckdb from "duckdb";
import { dailyMetricsViewSql, weeklyMetricsViewSql } from "../analyticalViews.js";

const markerName = ".lfa-duckdb-poc";
const schemaVersion = 2;

export interface NativeEncryptionProbeResult {
  databasePath: string;
  encrypted: boolean;
  correctKeyRead: boolean;
  missingKeyRejected: boolean;
  wrongKeyRejected: boolean;
  walCreated: boolean;
  tempSpillCreated: boolean;
  sensitiveValuesAbsent: boolean;
  rejectedKeysPreservedDatabase: boolean;
}

export interface DuckDbPocOptions {
  httpfsExtensionPath?: string;
  memoryLimit?: "64MB" | "256MB";
  testHooks?: {
    beforeHydrationPromotion?: () => Promise<void>;
    beforeTransactionCommit?: () => Promise<void>;
  };
}

export interface EncryptedPocDatabase {
  database: duckdb.Database;
  connection: duckdb.Connection;
}

export function initializePocRoot(root: string): string {
  const resolvedRoot = resolve(root);
  mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
  for (const directory of ["input-copy", "databases", "extensions", "temp", "keys", "results"]) {
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

export async function proveNativeEncryption(
  root: string,
  options: DuckDbPocOptions = {}
): Promise<NativeEncryptionProbeResult> {
  const pocRoot = assertPocRoot(root);
  const databasePath = resolve(pocRoot, "databases", `native-encryption-${randomBytes(8).toString("hex")}.duckdb-poc`);
  const key = randomBytes(32).toString("base64");
  const marker = `health-marker-${randomBytes(16).toString("hex")}`;
  let walCreated = false;
  let tempSpillCreated = false;
  let sensitiveValuesAbsent = false;
  let transientArtifactPaths: string[] = [];

  const initial = await openDatabase(pocRoot);
  let initialAttached = false;
  try {
    await exec(initial.connection, "SET debug_force_external = true;");
    await attachEncrypted(initial, databasePath, key, options.httpfsExtensionPath);
    initialAttached = true;
    await exec(initial.connection, "CREATE TABLE encryption_probe (marker VARCHAR PRIMARY KEY);");
    await run(initial.connection, "INSERT INTO encryption_probe VALUES (?);", marker);
    await withOperation("forcing a DuckDB temp spill", () => exec(
      initial.connection,
      "CREATE TEMP TABLE spill_probe AS " +
        `SELECT i, '${assertProbeMarker(marker)}' AS marker ` +
        "FROM range(750000) values(i) ORDER BY hash(i);"
    ));
    const walPath = `${databasePath}.wal`;
    const tempFiles = listFiles(resolve(pocRoot, "temp"));
    walCreated = existsSync(walPath);
    tempSpillCreated = tempFiles.length > 0;
    transientArtifactPaths = [walPath, ...tempFiles];
    await exec(initial.connection, "DROP TABLE spill_probe;");
    await exec(initial.connection, "CHECKPOINT;");
  } finally {
    await withOperation("closing the initial encrypted database", () => closeDatabase(initial, initialAttached));
  }

  sensitiveValuesAbsent = sensitiveValuesAreAbsent(
    [databasePath, ...transientArtifactPaths],
    [marker, key]
  );
  const correctKeyRead = await readMarker(pocRoot, databasePath, key, marker, options.httpfsExtensionPath);
  const databaseHashBeforeRejectedKeys = hashFile(databasePath);
  const missingKeyRejected = await attachFails(pocRoot, databasePath, undefined, options.httpfsExtensionPath);
  const wrongKeyRejected = await attachFails(
    pocRoot,
    databasePath,
    randomBytes(32).toString("base64"),
    options.httpfsExtensionPath
  );
  const rejectedKeysPreservedDatabase = databaseHashBeforeRejectedKeys === hashFile(databasePath);
  const databaseContents = readFileSync(databasePath);
  sensitiveValuesAbsent = sensitiveValuesAbsent &&
    !databaseContents.includes(Buffer.from(marker)) &&
    !databaseContents.includes(Buffer.from(key));

  return {
    databasePath,
    encrypted: !databaseContents.includes(Buffer.from(marker)),
    correctKeyRead,
    missingKeyRejected,
    wrongKeyRejected,
    walCreated,
    tempSpillCreated,
    sensitiveValuesAbsent,
    rejectedKeysPreservedDatabase
  };
}

export async function createPocSchema(
  root: string,
  databasePath: string,
  key: string,
  options: DuckDbPocOptions = {},
  targetSchemaVersion = schemaVersion
): Promise<void> {
  const database = await openEncryptedPocDatabase(root, databasePath, key, options);
  try {
    await migratePocSchema(database, targetSchemaVersion, true);
    await exec(database.connection, "CHECKPOINT;");
  } finally {
    await closeEncryptedPocDatabase(database);
  }
}

export async function migratePocSchema(
  database: EncryptedPocDatabase,
  targetSchemaVersion = schemaVersion,
  allowBootstrap = false
): Promise<number> {
  if (!Number.isInteger(targetSchemaVersion) || targetSchemaVersion < 1 || targetSchemaVersion > schemaVersion) {
    throw new Error(`DuckDB PoC schema target version ${targetSchemaVersion} is unsupported.`);
  }
  const metadataRows = await all(database.connection, `SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_catalog = current_database() AND table_name = 'poc_metadata';`);
  const hasMetadata = Number(metadataRows[0]?.count ?? 0) === 1;
  if (!hasMetadata && !allowBootstrap) {
    throw new Error("DuckDB PoC schema metadata is missing.");
  }
  const versionRows = hasMetadata
    ? await all(database.connection, "SELECT schema_version FROM poc_metadata ORDER BY schema_version;")
    : [];
  const versions = versionRows.map((row) => Number(row.schema_version));
  if (hasMetadata && (versions.length === 0 || versions.some((version, index) => version !== index + 1))) {
    throw new Error("DuckDB PoC schema metadata history is malformed.");
  }
  const currentVersion = versions.at(-1) ?? 0;
  if (currentVersion > schemaVersion) {
    throw new Error(`DuckDB PoC schema version ${currentVersion} is newer than supported version ${schemaVersion}.`);
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

export async function openEncryptedPocDatabase(
  root: string,
  databasePath: string,
  key: string,
  options: DuckDbPocOptions = {}
): Promise<EncryptedPocDatabase> {
  const pocRoot = assertPocRoot(root);
  const resolvedDatabasePath = resolve(databasePath);
  if (!isWithin(pocRoot, resolvedDatabasePath)) {
    throw new Error("DuckDB PoC databases must remain beneath the marked PoC root.");
  }
  mkdirSync(dirname(resolvedDatabasePath), { recursive: true, mode: 0o700 });
  const database = await openDatabase(pocRoot, options);
  try {
    await attachEncrypted(database, resolvedDatabasePath, key, options.httpfsExtensionPath);
    return database;
  } catch (error) {
    await closeDatabase(database, false);
    throw error;
  }
}

export async function closeEncryptedPocDatabase(database: EncryptedPocDatabase): Promise<void> {
  await closeDatabase(database, true);
}

async function readMarker(
  root: string,
  databasePath: string,
  key: string,
  marker: string,
  httpfsExtensionPath?: string
): Promise<boolean> {
  const database = await openDatabase(root);
  let attached = false;
  try {
    await attachEncrypted(database, databasePath, key, httpfsExtensionPath);
    attached = true;
    const rows = await all(database.connection, "SELECT marker FROM encryption_probe;");
    return rows.length === 1 && rows[0]?.marker === marker;
  } finally {
    await closeDatabase(database, attached);
  }
}

async function attachFails(
  root: string,
  databasePath: string,
  key?: string,
  httpfsExtensionPath?: string
): Promise<boolean> {
  const database = await openDatabase(root);
  let attached = false;
  try {
    await attachEncrypted(database, databasePath, key, httpfsExtensionPath);
    attached = true;
    return false;
  } catch {
    return true;
  } finally {
    await closeDatabase(database, attached);
  }
}

async function openDatabase(
  root: string,
  options: DuckDbPocOptions = {}
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
    throw new Error("DuckDB PoC encryption keys must be base64-encoded values.");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("DuckDB PoC encryption keys must be 256-bit values.");
  }
  return key.toString("base64");
}

function assertProbeMarker(value: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(value)) {
    throw new Error("DuckDB PoC markers contain unsupported characters.");
  }
  return value;
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

function listFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root).flatMap((name) => {
    const path = resolve(root, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function sensitiveValuesAreAbsent(paths: string[], values: string[]): boolean {
  return paths.filter((path) => existsSync(path)).every((path) => {
    const contents = readFileSync(path);
    return values.every((value) => !contents.includes(Buffer.from(value)));
  });
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function withOperation<T>(description: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`DuckDB PoC failed while ${description}.`, { cause: error });
  }
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
  INSERT OR IGNORE INTO poc_metadata VALUES (${schemaVersion}, CURRENT_TIMESTAMP, 'Daily and weekly analytical views');
`;

const schemaMigrations = [
  { version: 1, sql: schemaVersion1Sql },
  { version: 2, sql: schemaVersion2Sql }
] as const;
