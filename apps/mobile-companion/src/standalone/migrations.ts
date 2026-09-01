import { LOCAL_SCHEMA_VERSION } from "./localStore";

export interface MigrationDatabase {
  getFirstAsync<T>(query: string): Promise<T | null>;
  execAsync(query: string): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export interface Migration {
  /** The schema version this migration produces. */
  version: number;
  sql: string;
}

export interface MigrationOutcome {
  schemaVersion: number;
  /**
   * True when the file was written by a newer build. Migrations are skipped and the caller is
   * expected to open the database read-only rather than fail.
   */
  readOnly: boolean;
  appliedVersions: number[];
}

/**
 * Applies every pending migration, one transaction per step.
 *
 * `user_version` is bumped inside the same transaction as the DDL, so a crash mid-step rolls the
 * version back together with the schema instead of leaving the file claiming a version it does not
 * have. The bump is then read back and asserted, because a silently-ignored PRAGMA would make the
 * next launch replay a migration against a schema that already has it.
 */
export async function migrate(database: MigrationDatabase): Promise<MigrationOutcome> {
  const currentVersion = await readSchemaVersion(database);
  validateSchemaVersion(currentVersion);
  if (currentVersion > LOCAL_SCHEMA_VERSION) {
    return { schemaVersion: currentVersion, readOnly: true, appliedVersions: [] };
  }

  const appliedVersions: number[] = [];
  for (const migration of migrations.filter((candidate) => candidate.version > currentVersion)) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(migration.sql);
      await database.execAsync(`PRAGMA user_version = ${migration.version};`);
    });
    const reached = await readSchemaVersion(database);
    if (reached !== migration.version) {
      throw new Error(
        `Migration to schema ${migration.version} did not take effect; the database reports ${reached}.`
      );
    }
    appliedVersions.push(migration.version);
  }

  return { schemaVersion: LOCAL_SCHEMA_VERSION, readOnly: false, appliedVersions };
}

export async function readSchemaVersion(database: MigrationDatabase): Promise<number> {
  const row = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  return row?.user_version ?? 0;
}

/**
 * Rejects versions that cannot be real. A version *above* {@link LOCAL_SCHEMA_VERSION} is real — it
 * means a newer build touched this file — so it is handled by {@link migrate} as a read-only state
 * rather than rejected here.
 */
export function validateSchemaVersion(currentVersion: number): void {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error(`Invalid database schema version ${currentVersion}.`);
  }
}

export function migrationSql(currentVersion: number): string {
  validateSchemaVersion(currentVersion);
  const migration = migrations.find((candidate) => candidate.version === currentVersion + 1);
  if (!migration) throw new Error(`No migration path exists from schema ${currentVersion}.`);
  return migration.sql;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
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
  `
  },
  {
    version: 2,
    sql: `
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
      CASE WHEN (SELECT COUNT(*) FROM profiles) = 1 THEN 1 ELSE 0 END,
      'standalone:' || id
    FROM profiles;
    CREATE UNIQUE INDEX datasets_selected_idx ON datasets(is_selected) WHERE is_selected = 1;
  `
  },
  {
    version: 3,
    sql: `
    CREATE TABLE connected_replicas (
      replica_id TEXT PRIMARY KEY NOT NULL,
      server_instance_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      pairing_id TEXT NOT NULL,
      cursor_sequence INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      initial_snapshot_completed INTEGER NOT NULL DEFAULT 0 CHECK (initial_snapshot_completed IN (0, 1)),
      cached_at TEXT,
      UNIQUE (server_instance_id, profile_id, pairing_id)
    );
    CREATE TABLE connected_replica_entities (
      replica_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      PRIMARY KEY (replica_id, entity_type, entity_id),
      FOREIGN KEY (replica_id) REFERENCES connected_replicas(replica_id) ON DELETE CASCADE
    );
    CREATE INDEX connected_replica_entities_type_idx
      ON connected_replica_entities(replica_id, entity_type);
  `
  },
  {
    version: 4,
    sql: `
    ALTER TABLE connected_replicas ADD COLUMN applied_at TEXT;
    ALTER TABLE connected_replicas ADD COLUMN snapshot_cursor TEXT;
    UPDATE connected_replicas SET applied_at = cached_at WHERE applied_at IS NULL;
    DROP INDEX IF EXISTS connected_replica_entities_type_idx;
  `
  },
  {
    version: 5,
    sql: `
    DROP TABLE IF EXISTS connected_replica_entities;
    DROP TABLE IF EXISTS connected_replicas;
  `
  },
  {
    version: 6,
    sql: `
    CREATE TABLE health_events (
      profile_id TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (profile_id, id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );
    CREATE INDEX health_events_filter_idx
      ON health_events(profile_id, kind, status, occurred_at DESC);
    CREATE TABLE care_items (
      profile_id TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_start TEXT,
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (profile_id, id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );
    CREATE INDEX care_items_filter_idx
      ON care_items(profile_id, status, kind, priority, due_start);
  `
  },
  {
    version: 7,
    sql: `
    UPDATE care_items
      SET status = 'cancelled',
          payload_json = json_set(payload_json, '$.status', 'cancelled')
      WHERE status = 'skipped';
  `
  },
  {
  version: 8,
  sql: `
  CREATE TABLE medications (
    profile_id TEXT NOT NULL,
    id TEXT NOT NULL,
    status TEXT NOT NULL,
    start_date TEXT NOT NULL,
    name TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  );
  CREATE INDEX medications_filter_idx
    ON medications(profile_id, status, start_date DESC, id);
  `
  },
  {
  version: 9,
  sql: `
  CREATE TABLE medications_v9 (
    profile_id TEXT NOT NULL,
    id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    name TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  );
  INSERT INTO medications_v9 (profile_id, id, start_date, name, payload_json)
    SELECT profile_id, id, start_date, name,
      json_remove(payload_json, '$.route', '$.schedule', '$.prescriber', '$.reason', '$.status')
    FROM medications;
  DROP TABLE medications;
  ALTER TABLE medications_v9 RENAME TO medications;
  CREATE INDEX medications_filter_idx
    ON medications(profile_id, start_date DESC, id);
  `
  },
  {
  version: 10,
  sql: `
  CREATE TABLE medications_v10 (
    profile_id TEXT NOT NULL,
    id TEXT NOT NULL,
    start_date TEXT,
    name TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  );
  INSERT INTO medications_v10 (profile_id, id, start_date, name, payload_json)
    SELECT profile_id, id, start_date, name, payload_json
    FROM medications;
  DROP TABLE medications;
  ALTER TABLE medications_v10 RENAME TO medications;
  CREATE INDEX medications_filter_idx
    ON medications(profile_id, start_date DESC, id);
  `
  },
  {
  version: 11,
  sql: `
  ALTER TABLE profiles ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE profiles ADD COLUMN setup_status TEXT NOT NULL DEFAULT 'complete';
  ALTER TABLE profiles ADD COLUMN subject_kind TEXT NOT NULL DEFAULT 'adult';
  ALTER TABLE profiles ADD COLUMN birth_date TEXT;
  ALTER TABLE profiles ADD COLUMN sex TEXT;
  ALTER TABLE profiles ADD COLUMN height_cm REAL;
  ALTER TABLE profiles ADD COLUMN blood_type TEXT;
  ALTER TABLE profiles ADD COLUMN goal_summary TEXT;
  ALTER TABLE profiles ADD COLUMN cloud_ai_consent_json TEXT;
  ALTER TABLE profiles ADD COLUMN pet_json TEXT;
  ALTER TABLE profiles ADD COLUMN units TEXT NOT NULL DEFAULT 'metric';

  UPDATE profiles
  SET
    display_name = COALESCE(json_extract(profile_json, '$.displayName'), ''),
    setup_status = COALESCE(json_extract(profile_json, '$.setupStatus'), 'complete'),
    subject_kind = COALESCE(json_extract(profile_json, '$.subjectKind'), 'adult'),
    birth_date = json_extract(profile_json, '$.birthDate'),
    sex = json_extract(profile_json, '$.sex'),
    height_cm = json_extract(profile_json, '$.heightCm'),
    blood_type = json_extract(profile_json, '$.bloodType'),
    goal_summary = json_extract(profile_json, '$.goalSummary'),
    cloud_ai_consent_json = json_extract(profile_json, '$.cloudAiConsent'),
    pet_json = json_extract(profile_json, '$.pet'),
    units = COALESCE(json_extract(profile_json, '$.units'), 'metric');

  CREATE INDEX profiles_subject_kind_idx ON profiles(subject_kind);
  `
  }
];

/**
 * The replica cache schema, stated in full rather than as a chain of ALTERs.
 *
 * Migrations 3 and 4 above are the reason this exists: both were pure cache-shape changes, but
 * because the cache shared a file with the user's own records they had to go through the durable
 * migration machinery - file backups, row-count assertions, rollback - to change a table whose
 * every row could have been re-fetched from the PC in seconds. Here a shape change is a version
 * bump and a `DROP`.
 */
export const replicaSchemaSql = `
  CREATE TABLE IF NOT EXISTS connected_replicas (
    replica_id TEXT PRIMARY KEY NOT NULL,
    server_instance_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    pairing_id TEXT NOT NULL,
    cursor_sequence INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    initial_snapshot_completed INTEGER NOT NULL DEFAULT 0 CHECK (initial_snapshot_completed IN (0, 1)),
    cached_at TEXT,
    applied_at TEXT,
    snapshot_cursor TEXT,
    UNIQUE (server_instance_id, profile_id, pairing_id)
  );
  CREATE TABLE IF NOT EXISTS connected_replica_entities (
    replica_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (replica_id, entity_type, entity_id),
    FOREIGN KEY (replica_id) REFERENCES connected_replicas(replica_id) ON DELETE CASCADE
  );
`;

/** Discards the cache wholesale. Safe by construction: the PC is the source of truth for all of it. */
export const replicaResetSql = `
  DROP TABLE IF EXISTS connected_replica_entities;
  DROP TABLE IF EXISTS connected_replicas;
`;
