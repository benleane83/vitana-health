import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import duckdb from "duckdb";
import {
  aiCareItemsViewSql,
  aiHealthEventsViewSql,
  dailyMetricsViewSql,
  weeklyMetricsViewSql
} from "../analyticalViews.js";

const markerName = ".vitana-duckdb-poc";
const schemaVersion = 1;

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
  /**
   * A second connection reserved for reads. Writes are serialized through a mutation queue, so
   * without this a dashboard query would wait behind a multi-minute import. DuckDB gives this
   * connection the last committed snapshot, so it never observes a half-applied transaction.
   */
  readConnection: duckdb.Connection;
}

export function initializeDuckDbRoot(root: string): string {
  const resolvedRoot = resolve(root);
  mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
  for (const directory of ["databases", "extensions", "temp"]) {
    mkdirSync(resolve(resolvedRoot, directory), { recursive: true, mode: 0o700 });
  }
  writeFileSync(resolve(resolvedRoot, markerName), "Vitana encrypted DuckDB PoC\n", {
    mode: 0o600
  });
  return resolvedRoot;
}

export function assertDuckDbRoot(root: string): string {
  const resolvedRoot = resolve(root);
  const markerPath = resolve(resolvedRoot, markerName);
  if (!existsSync(markerPath) || readFileSync(markerPath, "utf8") !== "Vitana encrypted DuckDB PoC\n") {
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
    await applyAnalyticalViews(database.connection);
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
): Promise<EncryptedDuckDbDatabase> {
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
  const readConnection = database.connect();
  // Configuration is locked once the database is attached, so both connections are set up here.
  for (const target of [connection, readConnection]) {
    await exec(target, "SET TimeZone = 'UTC';");
  }
  await exec(
    connection,
    `SET allowed_directories = ['${assertDatabasePath(resolve(root, "temp"))}'];`
  );
  return { database, connection, readConnection };
}

async function attachEncrypted(
  database: EncryptedDuckDbDatabase,
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
    `ATTACH '${assertDatabasePath(databasePath)}' AS poc${options}; USE poc;`
  );
  // `USE` is per-connection, so the read connection has to be pointed at the attached database
  // before the configuration lock closes the door on further settings.
  await exec(database.readConnection, "USE poc;");
  await exec(
    database.connection,
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
  database: EncryptedDuckDbDatabase,
  attached: boolean
): Promise<void> {
  // The read connection has to let go of the attached database before it can be detached.
  await new Promise<void>((resolvePromise, reject) => {
    database.readConnection.close((error) => error ? reject(error) : resolvePromise());
  });
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

// Single forward-only baseline. The app is unreleased, so the historical v1-v14 migration
// chain was collapsed here rather than carried forward. Every timestamp column is TIMESTAMPTZ,
// genuine parent/child relationships carry foreign keys, and read-path indexes are declared up
// front. Analytical views deliberately live outside this DDL - see applyAnalyticalViews.
//
// NOTE: measurement_code is intentionally NOT a foreign key onto measurement_types. The manual
// entry flows mint synthetic codes (manual_*, body_comp_*) that never get a measurement type row.
const baselineSchemaSql = `
  CREATE TABLE IF NOT EXISTS poc_metadata (
    schema_version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL,
    description VARCHAR NOT NULL
  );
  INSERT OR IGNORE INTO poc_metadata VALUES (1, CURRENT_TIMESTAMP, 'Vitana encrypted DuckDB baseline schema');

  CREATE TABLE IF NOT EXISTS schema_objects (
    name VARCHAR PRIMARY KEY, fingerprint VARCHAR NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile (
    id VARCHAR PRIMARY KEY, display_name VARCHAR NOT NULL, sex VARCHAR, height_cm DOUBLE,
    blood_type VARCHAR, goal_summary VARCHAR, units VARCHAR NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
    custom_properties JSON, subject_kind VARCHAR DEFAULT 'adult', birth_date DATE,
    pet_species VARCHAR, pet_breed VARCHAR, pet_reproductive_status VARCHAR, pet_microchip_id VARCHAR
  );

  CREATE TABLE IF NOT EXISTS imports (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, source_kind VARCHAR NOT NULL,
    file_name VARCHAR NOT NULL, imported_at TIMESTAMPTZ NOT NULL, parser_version VARCHAR NOT NULL,
    checksum VARCHAR NOT NULL, row_count BIGINT NOT NULL, status VARCHAR NOT NULL,
    diagnostics JSON NOT NULL, raw_content VARCHAR
  );

  CREATE TABLE IF NOT EXISTS sources (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, source_kind VARCHAR NOT NULL,
    label VARCHAR NOT NULL, import_id VARCHAR REFERENCES imports(id), created_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, label VARCHAR NOT NULL,
    manufacturer VARCHAR, model VARCHAR, source_id VARCHAR REFERENCES sources(id)
  );

  CREATE TABLE IF NOT EXISTS measurement_types (
    ordinal BIGINT NOT NULL UNIQUE, code VARCHAR PRIMARY KEY, display VARCHAR NOT NULL,
    category VARCHAR NOT NULL, kind VARCHAR NOT NULL, canonical_unit VARCHAR NOT NULL,
    aliases JSON NOT NULL, aggregation VARCHAR NOT NULL, custom_properties JSON
  );

  CREATE TABLE IF NOT EXISTS observation_groups (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, label VARCHAR NOT NULL,
    source_id VARCHAR REFERENCES sources(id), import_id VARCHAR REFERENCES imports(id),
    start_at TIMESTAMPTZ, end_at TIMESTAMPTZ, collected_at TIMESTAMPTZ, metadata JSON
  );

  CREATE TABLE IF NOT EXISTS observations (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, measurement_code VARCHAR NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL, effective_start TIMESTAMPTZ, effective_end TIMESTAMPTZ,
    value DOUBLE NOT NULL, unit VARCHAR NOT NULL, source_id VARCHAR NOT NULL REFERENCES sources(id),
    observation_group_id VARCHAR REFERENCES observation_groups(id), device_id VARCHAR REFERENCES devices(id),
    note VARCHAR, source_json_present BOOLEAN NOT NULL, source_json JSON, source_unit VARCHAR
  );

  CREATE TABLE IF NOT EXISTS time_series_samples (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, measurement_code VARCHAR NOT NULL,
    start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL, value DOUBLE NOT NULL, unit VARCHAR NOT NULL,
    source_id VARCHAR NOT NULL REFERENCES sources(id), device_id VARCHAR REFERENCES devices(id),
    source_json_present BOOLEAN NOT NULL, source_json JSON, source_unit VARCHAR
  );

  CREATE TABLE IF NOT EXISTS activities (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, activity_type VARCHAR NOT NULL,
    start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ, duration_minutes DOUBLE, energy_kcal DOUBLE,
    distance_meters DOUBLE, source_id VARCHAR NOT NULL REFERENCES sources(id),
    source_json_present BOOLEAN NOT NULL, source_json JSON
  );

  CREATE TABLE IF NOT EXISTS insights (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL,
    title VARCHAR NOT NULL, body VARCHAR NOT NULL, evidence JSON NOT NULL, confidence VARCHAR NOT NULL,
    model VARCHAR NOT NULL, safety_notice VARCHAR NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL,
    event_type VARCHAR NOT NULL, detail VARCHAR NOT NULL
  );

  CREATE TABLE IF NOT EXISTS health_events (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, status VARCHAR NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL, source VARCHAR NOT NULL, provider VARCHAR, notes VARCHAR, metadata JSON
  );

  CREATE TABLE IF NOT EXISTS immunizations (
    health_event_id VARCHAR PRIMARY KEY REFERENCES health_events(id), vaccine VARCHAR NOT NULL,
    target_disease VARCHAR, dose_number INTEGER, series VARCHAR, manufacturer VARCHAR, lot_number VARCHAR,
    expires_at DATE, route VARCHAR, site VARCHAR, reaction VARCHAR
  );

  CREATE TABLE IF NOT EXISTS medication_administrations (
    health_event_id VARCHAR PRIMARY KEY REFERENCES health_events(id), medication VARCHAR NOT NULL,
    active_ingredient VARCHAR, dose DOUBLE NOT NULL, unit VARCHAR NOT NULL, route VARCHAR
  );

  CREATE TABLE IF NOT EXISTS care_items (
    ordinal BIGINT NOT NULL UNIQUE, id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, code VARCHAR,
    title VARCHAR NOT NULL, due_start TIMESTAMPTZ, reminder_at TIMESTAMPTZ, priority VARCHAR NOT NULL,
    status VARCHAR NOT NULL, schedule_provenance VARCHAR, schedule_version VARCHAR, notes VARCHAR,
    completed_health_event_id VARCHAR REFERENCES health_events(id), completed_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS personal_reference_ranges (
    measurement_code VARCHAR PRIMARY KEY, normal_low DOUBLE, normal_high DOUBLE, unit VARCHAR NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL, optimal_low DOUBLE, optimal_high DOUBLE
  );

  CREATE TABLE IF NOT EXISTS pinned_measurements (
    measurement_code VARCHAR PRIMARY KEY, pinned_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile_media (
    media_kind VARCHAR PRIMARY KEY, content_type VARCHAR NOT NULL, content BLOB NOT NULL,
    revision VARCHAR NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
    CHECK (media_kind = 'profile-photo'), CHECK (content_type = 'image/jpeg')
  );

  CREATE TABLE IF NOT EXISTS companion_migration_sessions (
    session_id VARCHAR PRIMARY KEY, pairing_id VARCHAR NOT NULL, dataset_fingerprint VARCHAR NOT NULL,
    manifest JSON NOT NULL, status VARCHAR NOT NULL, created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ, receipt JSON
  );
  CREATE UNIQUE INDEX IF NOT EXISTS companion_migration_identity_idx
    ON companion_migration_sessions(pairing_id, dataset_fingerprint);

  CREATE TABLE IF NOT EXISTS companion_migration_batches (
    session_id VARCHAR NOT NULL, batch_id VARCHAR NOT NULL, acknowledgement JSON NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL, submitted_counts JSON NOT NULL,
    PRIMARY KEY (session_id, batch_id)
  );

  CREATE TABLE IF NOT EXISTS companion_migration_aliases (
    session_id VARCHAR NOT NULL, entity_type VARCHAR NOT NULL, source_id VARCHAR NOT NULL,
    destination_id VARCHAR NOT NULL, PRIMARY KEY (session_id, entity_type, source_id)
  );

  CREATE TABLE IF NOT EXISTS companion_sync_state (
    singleton BOOLEAN PRIMARY KEY, revision BIGINT NOT NULL, next_sequence BIGINT NOT NULL,
    CHECK (singleton = TRUE)
  );
  INSERT OR IGNORE INTO companion_sync_state VALUES (TRUE, 0, 1);

  CREATE TABLE IF NOT EXISTS companion_sync_changes (
    sequence BIGINT PRIMARY KEY, revision BIGINT NOT NULL, entity_type VARCHAR NOT NULL,
    entity_id VARCHAR NOT NULL, operation VARCHAR NOT NULL, payload JSON, changed_at TIMESTAMPTZ NOT NULL,
    CHECK (operation IN ('upsert', 'tombstone'))
  );
  CREATE INDEX IF NOT EXISTS companion_sync_changes_revision_idx
    ON companion_sync_changes(revision, sequence);

  CREATE TABLE IF NOT EXISTS companion_sync_snapshots (
    snapshot_id VARCHAR PRIMARY KEY, pairing_id VARCHAR NOT NULL, revision BIGINT NOT NULL,
    high_water_sequence BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companion_sync_snapshot_entries (
    snapshot_id VARCHAR NOT NULL, entry_index BIGINT NOT NULL, entity_type VARCHAR NOT NULL,
    entity_id VARCHAR NOT NULL, payload JSON NOT NULL, PRIMARY KEY (snapshot_id, entry_index)
  );

  CREATE INDEX IF NOT EXISTS observations_code_observed_idx ON observations(measurement_code, observed_at);
  CREATE INDEX IF NOT EXISTS time_series_samples_code_end_idx ON time_series_samples(measurement_code, end_at);
  CREATE INDEX IF NOT EXISTS activities_start_idx ON activities(start_at);
  CREATE INDEX IF NOT EXISTS imports_kind_checksum_idx ON imports(source_kind, checksum);
`;

const schemaMigrations = [
  { version: 1, sql: baselineSchemaSql }
] as const;

const analyticalViewStatements = [
  { name: "v_daily_metrics", sql: dailyMetricsViewSql },
  { name: "v_weekly_metrics", sql: weeklyMetricsViewSql },
  { name: "v_ai_health_events", sql: aiHealthEventsViewSql },
  { name: "v_ai_care_items", sql: aiCareItemsViewSql }
];

/**
 * Analytical views are derived objects, so they are rebuilt from their definitions rather than
 * frozen into the schema history - changing a view definition then needs no migration. The
 * fingerprint check keeps this a no-op write-wise on every open after the first.
 */
export async function applyAnalyticalViews(connection: duckdb.Connection): Promise<void> {
  const fingerprintRows = await all(connection, "SELECT name, fingerprint FROM schema_objects;");
  const stored = new Map(fingerprintRows.map((row) => [String(row.name), String(row.fingerprint)]));
  const existingRows = await all(
    connection,
    "SELECT table_name FROM information_schema.views WHERE table_catalog = current_database();"
  );
  const existing = new Set(existingRows.map((row) => String(row.table_name)));
  const pending = analyticalViewStatements
    .map((view) => ({ ...view, fingerprint: createHash("sha256").update(view.sql).digest("hex") }))
    .filter((view) => !existing.has(view.name) || stored.get(view.name) !== view.fingerprint);
  if (pending.length === 0) {
    return;
  }
  await exec(connection, "BEGIN TRANSACTION;");
  try {
    for (const view of pending) {
      await exec(connection, `${view.sql};`);
      await run(connection, "INSERT OR REPLACE INTO schema_objects VALUES (?, ?);", view.name, view.fingerprint);
    }
    await exec(connection, "COMMIT;");
  } catch (error) {
    await exec(connection, "ROLLBACK;").catch(() => undefined);
    throw error;
  }
}
