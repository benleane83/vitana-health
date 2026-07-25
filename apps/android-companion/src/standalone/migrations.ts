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
  for (let version = currentVersion; version < LOCAL_SCHEMA_VERSION; version++) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(migrationSql(version));
    });
  }
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
  if (currentVersion === 0) return `
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
    PRAGMA user_version = 1;
  `;
  if (currentVersion === 1) return `
    CREATE TABLE datasets (
      dataset_id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL UNIQUE,
      dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('standalone', 'connected')),
      lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active', 'archived')),
      is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
      remote_binding_json TEXT,
      migration_fingerprint TEXT NOT NULL,
      migration_receipt_json TEXT,
      archived_at TEXT,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );
    INSERT INTO datasets (
      dataset_id, profile_id, dataset_kind, lifecycle_state, is_selected, migration_fingerprint
    )
    SELECT id, id, 'standalone', 'active',
      CASE WHEN id = (
        SELECT profiles.id
        FROM profiles
        ORDER BY
          (SELECT COUNT(*) FROM observations WHERE observations.profile_id = profiles.id) DESC,
          (SELECT COUNT(*) FROM source_imports WHERE source_imports.profile_id = profiles.id) DESC,
          profiles.updated_at ASC,
          profiles.id ASC
        LIMIT 1
      ) THEN 1 ELSE 0 END,
      'standalone:' || id
    FROM profiles;
    CREATE UNIQUE INDEX datasets_selected_idx ON datasets(is_selected) WHERE is_selected = 1;
    PRAGMA user_version = 2;
  `;
  throw new Error(`No migration path exists from schema ${currentVersion}.`);
}
