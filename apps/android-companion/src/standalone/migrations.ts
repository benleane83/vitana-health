import { LOCAL_SCHEMA_VERSION } from "./localStore";

export interface MigrationDatabase {
  getFirstAsync<T>(query: string): Promise<T | null>;
  execAsync(query: string): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export async function migrate(database: MigrationDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = row?.user_version ?? 0;
  validateSchemaVersion(currentVersion);
  if (currentVersion === LOCAL_SCHEMA_VERSION) return;
  await database.withTransactionAsync(async () => {
    await database.execAsync(migrationSql(currentVersion));
  });
}

export function validateSchemaVersion(currentVersion: number): void {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error(`Invalid database schema version ${currentVersion}.`);
  }
  if (currentVersion > LOCAL_SCHEMA_VERSION) {
    throw new Error(`Database schema ${currentVersion} is newer than supported schema ${LOCAL_SCHEMA_VERSION}.`);
  }
}

export function migrationSql(currentVersion: number): string {
  validateSchemaVersion(currentVersion);
  if (currentVersion !== 0) throw new Error(`No migration path exists from schema ${currentVersion}.`);
  return `
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY NOT NULL,
      profile_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE source_imports (
      profile_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      checksum TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      PRIMARY KEY (profile_id, id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );
    CREATE TABLE data_sources (
      profile_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      label TEXT NOT NULL,
      import_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id),
      FOREIGN KEY (profile_id, import_id) REFERENCES source_imports(profile_id, id)
    );
    CREATE TABLE observation_groups (
      profile_id TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      source_id TEXT,
      import_id TEXT,
      start_at TEXT,
      end_at TEXT,
      collected_at TEXT,
      metadata_json TEXT NOT NULL,
      PRIMARY KEY (profile_id, id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id),
      FOREIGN KEY (profile_id, source_id) REFERENCES data_sources(profile_id, id),
      FOREIGN KEY (profile_id, import_id) REFERENCES source_imports(profile_id, id)
    );
    CREATE TABLE observations (
      profile_id TEXT NOT NULL,
      id TEXT NOT NULL,
      measurement_code TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      effective_start TEXT,
      effective_end TEXT,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      source_id TEXT NOT NULL,
      observation_group_id TEXT,
      device_id TEXT,
      note TEXT,
      source_json TEXT,
      PRIMARY KEY (profile_id, id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id),
      FOREIGN KEY (profile_id, source_id) REFERENCES data_sources(profile_id, id),
      FOREIGN KEY (profile_id, observation_group_id) REFERENCES observation_groups(profile_id, id)
    );
    CREATE INDEX observations_measurement_time_idx
      ON observations(profile_id, measurement_code, observed_at DESC);
    CREATE INDEX observations_source_idx ON observations(profile_id, source_id);
    CREATE INDEX observations_group_idx ON observations(profile_id, observation_group_id);
    CREATE INDEX data_sources_import_idx ON data_sources(profile_id, import_id);
    CREATE INDEX observation_groups_import_idx ON observation_groups(profile_id, import_id);
    PRAGMA user_version = ${LOCAL_SCHEMA_VERSION};
  `;
}
