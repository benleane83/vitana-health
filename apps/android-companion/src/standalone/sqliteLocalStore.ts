import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type {
  MobileImportResult,
  MobileMigrationBatch,
  MobileMigrationManifest,
  MobileMigrationReceipt,
  Observation,
  ParsedImport,
  Profile,
  ReplicaIdentity,
  ReplicaPage,
  UpdateObservationInput
} from "@vitana/shared";
import {
  generateDatabaseKeyHex,
  openWithDatabaseKey,
  rekeyDatabase,
  type SecureKeyStore
} from "./databaseKey";
import { deleteEmptyPlaintextDatabase } from "./databaseRecovery";
import {
  assertDatabaseIntegrity,
  assertRowCountsPreserved,
  captureMigrationBackup,
  countTrackedRows,
  discardMigrationBackup,
  expoDatabaseFileStore,
  restoreMigrationBackup
} from "./databaseBackup";
import {
  LocalDatabaseError,
  type LocalDatabaseFailureReason,
  type LocalDatabaseMode
} from "./localDatabaseState";
import {
  DEFAULT_MIGRATION_BATCH_SIZE,
  LOCAL_SCHEMA_VERSION,
  MEASUREMENT_SCOPED_REPLICA_TYPES,
  emptyCounts,
  entityOutcome,
  type LocalObservationAggregate,
  type LocalObservationPage,
  type LocalDatasetSummary,
  type LocalDatasetMetadata,
  type LocalStore,
  type LocalStoreCounts,
  type ReplicaEntityFilter
} from "./localStore";
import type { HealthDataChartSeries, HealthDataChartSeriesOptions } from "@vitana/shared";
import { chartRangeCutoff } from "../chartSeries";
import { migrate, readSchemaVersion } from "./migrations";
import { prepareReplicaCache } from "./replicaCache";

const DATABASE_NAME = "standalone-health.db";
// A separate file on purpose. `standalone-health.db` holds records that exist nowhere else and are
// migrated with backups and row-count assertions; `replica.db` holds copies of data the paired PC
// still has, and is rebuilt rather than migrated. Keeping them together made every cache-shape
// change a user-data migration.
const REPLICA_DATABASE_NAME = "replica.db";
const DATABASE_KEY_NAME = "vitana.standaloneDatabaseKey.v1";
let sharedDatabase: Promise<SQLiteDatabase> | undefined;
let sharedReplicaDatabase: Promise<SQLiteDatabase> | undefined;
let databaseLeases = 0;
let databaseMode: LocalDatabaseMode = "read-write";

/** Whether the open database accepts writes, or is pinned read-only by a newer build's schema. */
export function localDatabaseMode(): LocalDatabaseMode {
  return databaseMode;
}

const secureKeyStore: SecureKeyStore = {
  get: () => SecureStore.getItemAsync(DATABASE_KEY_NAME),
  set: (value) => SecureStore.setItemAsync(DATABASE_KEY_NAME, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  }),
  remove: () => SecureStore.deleteItemAsync(DATABASE_KEY_NAME)
};

export async function openSqliteLocalStore(): Promise<SqliteLocalStore> {
  const { database, replicaDatabase } = await acquireSharedDatabase();
  return new SqliteLocalStore(database, releaseSharedDatabase, replicaDatabase);
}

async function acquireSharedDatabase(): Promise<{ database: SQLiteDatabase; replicaDatabase: SQLiteDatabase }> {
  databaseLeases += 1;
  try {
    sharedDatabase ??= openSqliteDatabase().catch((error) => {
      sharedDatabase = undefined;
      throw error;
    });
    const database = await sharedDatabase;
    sharedReplicaDatabase ??= openReplicaDatabase().catch((error) => {
      sharedReplicaDatabase = undefined;
      throw error;
    });
    const replicaDatabase = await sharedReplicaDatabase;
    return { database, replicaDatabase };
  } catch (error) {
    databaseLeases = Math.max(0, databaseLeases - 1);
    throw error;
  }
}

/**
 * Opens the cache under the same key as the durable database - it holds real health readings, just
 * borrowed ones - but with none of the migration ceremony. A cache that will not open is deleted
 * and refilled, which is why this has no recovery path of its own.
 */
async function openReplicaDatabase(): Promise<SQLiteDatabase> {
  return openWithDatabaseKey(secureKeyStore, Crypto.getRandomBytesAsync, async (hexKey) => {
    let database = await openDatabaseAsync(REPLICA_DATABASE_NAME);
    try {
      await database.execAsync(`PRAGMA key = "x'${hexKey}'";`);
      await database.getFirstAsync("PRAGMA user_version");
    } catch {
      await database.closeAsync().catch(() => undefined);
      await deleteDatabaseAsync(REPLICA_DATABASE_NAME).catch(() => undefined);
      database = await openDatabaseAsync(REPLICA_DATABASE_NAME);
      await database.execAsync(`PRAGMA key = "x'${hexKey}'";`);
    }
    await database.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA secure_delete = ON;
    `);
    await prepareReplicaCache(database);
    return database;
  }, () => false);
}

async function openSqliteDatabase(): Promise<SQLiteDatabase> {
  try {
    return await openSqliteDatabaseOnce();
  } catch (error) {
    // Recovery is attempted for any open failure rather than only for a driver message containing
    // "file is not a database". The gate that protects real data is the positive proof below - the
    // file must open unencrypted and contain zero tables - not a substring match, which would risk
    // destroying the key for a database that is merely temporarily unreadable.
    const removed = await deleteEmptyPlaintextDatabase(
      () => openDatabaseAsync(DATABASE_NAME),
      () => deleteDatabaseAsync(DATABASE_NAME)
    );
    if (!removed) throw error;

    await secureKeyStore.remove();
    return openSqliteDatabaseOnce();
  }
}

async function openSqliteDatabaseOnce(): Promise<SQLiteDatabase> {
  const fileExisted = await expoDatabaseFileStore.exists(DATABASE_NAME).catch(() => false);
  let databaseReadable = false;
  return openWithDatabaseKey(secureKeyStore, Crypto.getRandomBytesAsync, async (hexKey, created) => {
    const database = await openDatabaseAsync(DATABASE_NAME);
    let phase = "applying the encryption key";
    try {
      await database.execAsync(`PRAGMA key = "x'${hexKey}'";`);
      phase = "checking SQLCipher availability";
      const cipher = await database.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
      if (!cipher?.cipher_version) {
        throw new LocalDatabaseError(
          "sqlcipher-unavailable",
          "SQLCipher is unavailable. Reinstall the standalone test build with SQLCipher enabled."
        );
      }

      phase = "verifying the encrypted database";
      await database.getFirstAsync("PRAGMA user_version");
      databaseReadable = true;
      phase = "configuring the encrypted database";
      await database.execAsync(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA secure_delete = ON;
      `);
      phase = "migrating the encrypted database";
      databaseMode = await migrateWithBackup(database);
      return database;
    } catch (error) {
      await database.closeAsync().catch(() => undefined);
      if (error instanceof LocalDatabaseError) throw error;
      const detail = error instanceof Error ? error.message : "Unknown database error";
      throw new LocalDatabaseError(
        failureReason(databaseReadable, created, fileExisted),
        `Unable to open the encrypted standalone database safely while ${phase}: ${detail}`,
        { cause: error }
      );
    }
  }, () => !databaseReadable);
}

/**
 * A freshly minted key against a database file that already existed means the key was lost, not
 * that the data is damaged - the ciphertext is intact but no longer openable.
 */
function failureReason(
  databaseReadable: boolean,
  keyWasGenerated: boolean,
  fileExisted: boolean
): LocalDatabaseFailureReason {
  if (databaseReadable) return "migration-failed";
  if (keyWasGenerated && fileExisted) return "key-missing";
  return "data-unreadable";
}

/**
 * Runs pending migrations with the pre-migration file copied aside, so a migration that corrupts
 * the database or loses rows can be rolled back instead of leaving unrecoverable health data.
 */
async function migrateWithBackup(database: SQLiteDatabase): Promise<LocalDatabaseMode> {
  const fromVersion = await readSchemaVersion(database);
  if (fromVersion >= LOCAL_SCHEMA_VERSION) {
    const outcome = await migrate(database);
    if (!outcome.readOnly) return "read-write";
    // A newer build wrote this file. Refuse writes at the engine level rather than trusting every
    // call site to check a flag, and let the user keep reading what is already there.
    await database.execAsync("PRAGMA query_only = ON;");
    return "read-only";
  }

  const countsBefore = await countTrackedRows(database);
  await database.execAsync("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => undefined);
  const captured = await captureMigrationBackup(expoDatabaseFileStore, DATABASE_NAME, fromVersion);
  try {
    await migrate(database);
    await assertDatabaseIntegrity(database);
    assertRowCountsPreserved(countsBefore, await countTrackedRows(database));
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    await restoreMigrationBackup(expoDatabaseFileStore, DATABASE_NAME, fromVersion, captured);
    throw error;
  }
  await discardMigrationBackup(expoDatabaseFileStore, DATABASE_NAME, fromVersion, captured);
  return "read-write";
}

/**
 * Re-encrypts the standalone database under a freshly generated key.
 *
 * The new key is only persisted once `PRAGMA rekey` has succeeded and the database has been read
 * back under it, so a failure part-way leaves the old key in SecureStore matching the old
 * ciphertext.
 */
export async function rekeySqliteLocalStorage(
  newKeyHex?: string
): Promise<void> {
  if (databaseLeases > 0) {
    throw new Error("Close active local data operations before rotating the encryption key.");
  }

  const currentKey = await secureKeyStore.get();
  if (currentKey === null) throw new LocalDatabaseError("key-missing", "There is no key to rotate.");
  const replacement = newKeyHex ?? (await generateDatabaseKeyHex(Crypto.getRandomBytesAsync));

  const database = await openDatabaseAsync(DATABASE_NAME);
  try {
    await rekeyDatabase(database, currentKey, replacement);
  } finally {
    await database.closeAsync().catch(() => undefined);
  }
  // The cache shares the key but is not worth rotating: dropping it costs one re-sync, and it means
  // a half-finished rotation can never leave a file no key opens.
  await deleteDatabaseAsync(REPLICA_DATABASE_NAME).catch(() => undefined);
  await secureKeyStore.set(replacement);
}


async function releaseSharedDatabase(): Promise<void> {
  databaseLeases = Math.max(0, databaseLeases - 1);
  if (databaseLeases !== 0) return;
  if (sharedReplicaDatabase) {
    const replica = await sharedReplicaDatabase;
    sharedReplicaDatabase = undefined;
    await replica.closeAsync().catch(() => undefined);
  }
  if (!sharedDatabase) return;
  const database = await sharedDatabase;
  sharedDatabase = undefined;
  await database.closeAsync();
}

export async function resetSqliteLocalStorage(): Promise<void> {
  if (databaseLeases > 0) {
    throw new Error("Close active local data operations before resetting encrypted storage.");
  }
  await deleteDatabaseAsync(DATABASE_NAME);
  await deleteDatabaseAsync(REPLICA_DATABASE_NAME).catch(() => undefined);
  await secureKeyStore.remove();
  databaseMode = "read-write";
}

export class SqliteLocalStore implements LocalStore {
  private profileId?: string;
  private closed = false;

  constructor(
    private readonly database: SQLiteDatabase,
    private readonly release: () => Promise<void> = () => database.closeAsync(),
    /** Defaults to the durable handle so existing single-database tests keep working. */
    private readonly replicaDatabase: SQLiteDatabase = database
  ) {}

  async initialize(defaultProfile: Profile): Promise<void> {
    const existing = await this.database.getFirstAsync<{ profile_id: string }>(
      "SELECT profile_id FROM datasets WHERE is_selected = 1 LIMIT 1"
    );
    if (existing) {
      this.profileId = existing.profile_id;
      return;
    }
    const datasets = await this.listDatasets();
    if (datasets.length > 0) {
      throw new Error("Choose a local dataset before using Standalone mode.");
    }
    await this.database.withTransactionAsync(async () => {
      await this.database.runAsync(
        "INSERT INTO profiles (id, profile_json, updated_at) VALUES (?, ?, ?)",
        defaultProfile.id,
        JSON.stringify(defaultProfile),
        defaultProfile.updatedAt
      );
      await this.database.runAsync(
        `INSERT INTO datasets
         (dataset_id, profile_id, dataset_kind, lifecycle_state, is_selected, migration_fingerprint)
         VALUES (?, ?, 'standalone', 'active', 1, ?)`,
        defaultProfile.id,
        defaultProfile.id,
        `standalone:${defaultProfile.id}`
      );
    });
    this.profileId = defaultProfile.id;
  }

  async createDataset(profile: Profile): Promise<void> {
    await this.database.withTransactionAsync(async () => {
      await this.database.runAsync("UPDATE datasets SET is_selected = 0 WHERE is_selected = 1");
      await this.database.runAsync(
        "INSERT INTO profiles (id, profile_json, updated_at) VALUES (?, ?, ?)",
        profile.id,
        JSON.stringify(profile),
        profile.updatedAt
      );
      await this.database.runAsync(
        `INSERT INTO datasets
         (dataset_id, profile_id, dataset_kind, lifecycle_state, is_selected, migration_fingerprint)
         VALUES (?, ?, 'standalone', 'active', 1, ?)`,
        profile.id,
        profile.id,
        `standalone:${profile.id}`
      );
    });
    this.profileId = profile.id;
  }

  async deleteSelectedDataset(): Promise<void> {
    const profileId = this.requireProfileId();
    await this.database.withTransactionAsync(async () => {
      await this.database.runAsync("DELETE FROM observations WHERE profile_id = ?", profileId);
      await this.database.runAsync("DELETE FROM observation_groups WHERE profile_id = ?", profileId);
      await this.database.runAsync("DELETE FROM data_sources WHERE profile_id = ?", profileId);
      await this.database.runAsync("DELETE FROM source_imports WHERE profile_id = ?", profileId);
      await this.database.runAsync("DELETE FROM datasets WHERE profile_id = ?", profileId);
      await this.database.runAsync("DELETE FROM profiles WHERE id = ?", profileId);
    });
    this.profileId = undefined;
  }

  async listDatasets(): Promise<LocalDatasetSummary[]> {
    const rows = await this.database.getAllAsync<{
      dataset_id: string;
      profile_id: string;
      profile_json: string;
      dataset_kind: LocalDatasetSummary["kind"];
      lifecycle_state: LocalDatasetSummary["lifecycleState"];
      is_selected: number;
    }>(`
      SELECT d.dataset_id, d.profile_id, p.profile_json, d.dataset_kind, d.lifecycle_state, d.is_selected
      FROM datasets d
      JOIN profiles p ON p.id = d.profile_id
      ORDER BY p.updated_at DESC, d.dataset_id
    `);
    return rows.map((row) => ({
      datasetId: row.dataset_id,
      profileId: row.profile_id,
      displayName: (JSON.parse(row.profile_json) as Profile).displayName,
      kind: row.dataset_kind,
      lifecycleState: row.lifecycle_state,
      selected: row.is_selected === 1
    }));
  }

  async selectDataset(datasetId: string): Promise<void> {
    const dataset = await this.database.getFirstAsync<{ profile_id: string }>(
      "SELECT profile_id FROM datasets WHERE dataset_id = ?",
      datasetId
    );
    if (!dataset) throw new Error("The selected local dataset is unavailable.");
    await this.database.withTransactionAsync(async () => {
      await this.database.runAsync("UPDATE datasets SET is_selected = 0 WHERE is_selected = 1");
      await this.database.runAsync("UPDATE datasets SET is_selected = 1 WHERE dataset_id = ?", datasetId);
    });
    this.profileId = dataset.profile_id;
  }

  async datasetMetadata(): Promise<LocalDatasetMetadata> {
    const row = await this.database.getFirstAsync<{
      dataset_id: string;
      profile_id: string;
      dataset_kind: "standalone" | "connected";
      lifecycle_state: "active" | "archived";
      remote_binding_json: string | null;
      migration_fingerprint: string;
      migration_receipt_json: string | null;
      archived_at: string | null;
    }>("SELECT * FROM datasets WHERE profile_id = ?", this.requireProfileId());
    if (!row) throw new Error("The selected local dataset is unavailable.");
    return {
      datasetId: row.dataset_id,
      profileId: row.profile_id,
      kind: row.dataset_kind,
      lifecycleState: row.lifecycle_state,
      remoteBinding: row.remote_binding_json ? JSON.parse(row.remote_binding_json) : undefined,
      migrationFingerprint: row.migration_fingerprint,
      migrationReceipt: row.migration_receipt_json ? JSON.parse(row.migration_receipt_json) : undefined,
      archivedAt: row.archived_at ?? undefined
    };
  }

  async getProfile(): Promise<Profile> {
    const row = await this.database.getFirstAsync<{ profile_json: string }>(
      "SELECT profile_json FROM profiles WHERE id = ?",
      this.requireProfileId()
    );
    if (!row) throw new Error("The local profile has not been initialized.");
    return JSON.parse(row.profile_json) as Profile;
  }

  async counts(): Promise<LocalStoreCounts> {
    const row = await this.database.getFirstAsync<{
      imports: number;
      observations: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM source_imports WHERE profile_id = ?) AS imports,
        (SELECT COUNT(*) FROM observations WHERE profile_id = ?) AS observations
    `, this.requireProfileId(), this.requireProfileId());
    return {
      ...emptyCounts(),
      imports: row?.imports ?? 0,
      observations: row?.observations ?? 0
    };
  }

  async mergeImport(imported: ParsedImport): Promise<MobileImportResult> {
    await this.assertWritable();
    const accepted = {
      sourceImports: 0,
      dataSources: 0,
      observationGroups: 0,
      observations: 0
    };
    const profileId = this.requireProfileId();
    await this.database.withTransactionAsync(async () => {
      const transaction = this.database;
      const sourceImport = imported.sourceImport;
      accepted.sourceImports += (await transaction.runAsync(
        `INSERT OR IGNORE INTO source_imports
          (profile_id, id, source_kind, file_name, imported_at, parser_version, checksum, row_count, status, diagnostics_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        profileId,
        sourceImport.id,
        sourceImport.sourceKind,
        sourceImport.fileName,
        sourceImport.importedAt,
        sourceImport.parserVersion,
        sourceImport.checksum,
        sourceImport.rowCount,
        sourceImport.status,
        JSON.stringify(sourceImport.diagnostics)
      )).changes;
      const source = imported.dataSource;
      accepted.dataSources += (await transaction.runAsync(
        `INSERT OR IGNORE INTO data_sources
          (profile_id, id, source_kind, label, import_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        profileId,
        source.id,
        source.sourceKind,
        source.label,
        source.importId ?? null,
        source.createdAt
      )).changes;
      for (const group of imported.observationGroups) {
        accepted.observationGroups += (await transaction.runAsync(
          `INSERT OR IGNORE INTO observation_groups
            (profile_id, id, kind, label, source_id, import_id, start_at, end_at, collected_at, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          profileId,
          group.id,
          group.kind,
          group.label,
          group.sourceId ?? null,
          group.importId ?? null,
          group.startAt ?? null,
          group.endAt ?? null,
          group.collectedAt ?? null,
          JSON.stringify(group.metadata ?? {})
        )).changes;
      }

      for (const observation of imported.observations) {
        accepted.observations += (await transaction.runAsync(
          `INSERT OR IGNORE INTO observations
            (profile_id, id, measurement_code, observed_at, effective_start, effective_end, value, unit, source_id,
             observation_group_id, device_id, note, source_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          profileId,
          observation.id,
          observation.measurementCode,
          observation.observedAt,
          observation.effectiveStart ?? null,
          observation.effectiveEnd ?? null,
          observation.value,
          observation.unit,
          observation.sourceId,
          observation.observationGroupId ?? null,
          observation.deviceId ?? null,
          observation.note ?? null,
          observation.sourceJson === undefined ? null : JSON.stringify(observation.sourceJson)
        )).changes;
      }
      if (Object.values(accepted).some((count) => count > 0)) {
        await this.rotateMigrationFingerprint();
      }
    });
    return {
      importId: imported.sourceImport.id,
      outcome: {
        sourceImports: entityOutcome(1, accepted.sourceImports),
        dataSources: entityOutcome(1, accepted.dataSources),
        observationGroups: entityOutcome(imported.observationGroups.length, accepted.observationGroups),
        observations: entityOutcome(imported.observations.length, accepted.observations),
        timeSeriesSamples: entityOutcome(imported.timeSeriesSamples.length, 0),
        activitySessions: entityOutcome(imported.activitySessions.length, 0)
      }
    };
  }

  async migrationManifest(): Promise<MobileMigrationManifest> {
    const [dataset, counts] = await Promise.all([this.datasetMetadata(), this.migrationEntityCounts()]);
    return {
      protocolVersion: 1,
      datasetId: dataset.datasetId,
      datasetFingerprint: dataset.migrationFingerprint,
      sourceProfileId: dataset.profileId,
      counts
    };
  }

  /**
   * Yields batches as they are read. The previous version selected all four tables in full before
   * slicing them, so `batchSize` bounded the upload but not the memory — on exactly the datasets
   * (the largest ones) where that mattered most.
   */
  async *streamMigrationBatches(sessionId: string, batchSize = DEFAULT_MIGRATION_BATCH_SIZE): AsyncGenerator<MobileMigrationBatch> {
    const size = Math.min(Math.max(Math.trunc(batchSize), 1), 500);
    const profileId = this.requireProfileId();
    const emptyBatch = (kind: string, index: number): MobileMigrationBatch => ({
      protocolVersion: 1,
      sessionId,
      batchId: `${kind}-${String(index).padStart(6, "0")}`,
      sourceImports: [],
      dataSources: [],
      observationGroups: [],
      observations: []
    });
    const database = this.database;
    async function* pages<T>(sql: string): AsyncGenerator<T[]> {
      for (let offset = 0; ; offset += size) {
        const rows = await database.getAllAsync<T>(`${sql} LIMIT ? OFFSET ?`, profileId, size, offset);
        if (rows.length === 0) return;
        yield rows;
        if (rows.length < size) return;
      }
    }

    let index = 0;
    for await (const rows of pages<SourceImportRow>(
      `SELECT id, source_kind AS sourceKind, file_name AS fileName, imported_at AS importedAt,
        parser_version AS parserVersion, checksum, row_count AS rowCount, status, diagnostics_json AS diagnostics
       FROM source_imports WHERE profile_id = ? ORDER BY id`
    )) {
      yield {
        ...emptyBatch("source-imports", index++),
        sourceImports: rows.map((row) => ({ ...row, diagnostics: JSON.parse(row.diagnostics) as string[] }))
      };
    }

    index = 0;
    for await (const rows of pages<DataSourceRow>(
      `SELECT id, source_kind AS sourceKind, label, import_id AS importId, created_at AS createdAt
       FROM data_sources WHERE profile_id = ? ORDER BY id`
    )) {
      yield { ...emptyBatch("data-sources", index++), dataSources: rows.map((row) => withUndefinedNulls(row)) };
    }

    index = 0;
    for await (const rows of pages<ObservationGroupRow>(
      `SELECT id, kind, label, source_id AS sourceId, import_id AS importId, start_at AS startAt,
        end_at AS endAt, collected_at AS collectedAt, metadata_json AS metadata
       FROM observation_groups WHERE profile_id = ? ORDER BY id`
    )) {
      yield {
        ...emptyBatch("observation-groups", index++),
        observationGroups: rows.map((row) => withUndefinedNulls({
          ...row,
          metadata: JSON.parse(row.metadata) as Record<string, unknown>
        }))
      };
    }

    index = 0;
    for await (const rows of pages<ObservationRow>(
      `SELECT id, measurement_code AS measurementCode, observed_at AS observedAt,
        effective_start AS effectiveStart, effective_end AS effectiveEnd, value, unit, source_id AS sourceId,
        observation_group_id AS observationGroupId, device_id AS deviceId, note, source_json AS sourceJson
       FROM observations WHERE profile_id = ? ORDER BY id`
    )) {
      yield {
        ...emptyBatch("observations", index++),
        observations: rows.map((row) => withUndefinedNulls({
          ...row,
          sourceJson: row.sourceJson ? (JSON.parse(row.sourceJson) as unknown) : undefined
        }))
      };
    }
  }

  async archiveAfterMigration(receipt: MobileMigrationReceipt, serverUrl: string): Promise<void> {
    const dataset = await this.datasetMetadata();
    if (dataset.migrationFingerprint !== receipt.datasetFingerprint) {
      throw new Error("Standalone data changed during migration. The updated dataset was not archived.");
    }
    const archivedAt = new Date().toISOString();
    await this.database.runAsync(
      `UPDATE datasets SET lifecycle_state = 'archived', remote_binding_json = ?,
       migration_receipt_json = ?, archived_at = ? WHERE profile_id = ? AND lifecycle_state = 'active'`,
      JSON.stringify({ serverUrl, profileId: receipt.destinationProfileId, pairingId: receipt.pairingId }),
      JSON.stringify(receipt),
      archivedAt,
      this.requireProfileId()
    );
  }

  async latestObservationsByCode() {
    return this.database.getAllAsync<{
      id: string;
      measurementCode: string;
      observedAt: string;
      value: number;
      unit: string;
      sourceId: string;
      observationGroupId: string | null;
      deviceId: string | null;
      note: string | null;
      sourceJson: string | null;
    }>(`
      SELECT id, measurementCode, observedAt, value, unit, sourceId, observationGroupId, deviceId,
        note, sourceJson
      FROM (
        SELECT id, measurement_code AS measurementCode, observed_at AS observedAt, value, unit,
          source_id AS sourceId, observation_group_id AS observationGroupId, device_id AS deviceId,
          note, source_json AS sourceJson,
          ROW_NUMBER() OVER (
            PARTITION BY measurement_code
            ORDER BY observed_at DESC, id DESC
          ) AS measurementRank
        FROM observations
        WHERE profile_id = ?
      )
      WHERE measurementRank = 1
      ORDER BY observedAt DESC, id DESC
    `, this.requireProfileId()).then((rows) => rows.map((row) => ({
      id: row.id,
      measurementCode: row.measurementCode,
      observedAt: row.observedAt,
      value: row.value,
      unit: row.unit,
      sourceId: row.sourceId,
      observationGroupId: row.observationGroupId ?? undefined,
      deviceId: row.deviceId ?? undefined,
      note: row.note ?? undefined,
      sourceJson: row.sourceJson ? JSON.parse(row.sourceJson) : undefined
    })));
  }

  async observationAggregates(): Promise<LocalObservationAggregate[]> {
    return this.database.getAllAsync<LocalObservationAggregate>(`
      SELECT observations.measurement_code AS measurementCode, COUNT(*) AS count,
        MAX(observations.observed_at) AS lastMeasuredAt, MIN(observation_groups.kind) AS groupKind
      FROM observations
      LEFT JOIN observation_groups
        ON observation_groups.profile_id = observations.profile_id
        AND observation_groups.id = observations.observation_group_id
      WHERE observations.profile_id = ?
      GROUP BY observations.measurement_code
    `, this.requireProfileId());
  }

  async observationsByCode(measurementCode: string, limit: number, offset: number): Promise<LocalObservationPage> {
    const totalRow = await this.database.getFirstAsync<{ total: number }>(
      "SELECT COUNT(*) AS total FROM observations WHERE profile_id = ? AND measurement_code = ?",
      this.requireProfileId(),
      measurementCode
    );
    const rows = await this.database.getAllAsync<{
      id: string;
      observedAt: string;
      value: number;
      unit: string;
      sourceId: string;
      observationGroupId: string | null;
      deviceId: string | null;
      note: string | null;
      sourceJson: string | null;
      sourceKind: LocalObservationPage["records"][number]["sourceKind"] | null;
      sourceLabel: string | null;
      importFileName: string | null;
      importedAt: string | null;
      groupId: string | null;
      groupKind: string | null;
      groupLabel: string | null;
      groupCollectedAt: string | null;
    }>(`
      SELECT o.id, o.observed_at AS observedAt, o.value, o.unit, o.source_id AS sourceId,
        o.observation_group_id AS observationGroupId, o.device_id AS deviceId, o.note,
        o.source_json AS sourceJson, ds.source_kind AS sourceKind, ds.label AS sourceLabel,
        si.file_name AS importFileName, si.imported_at AS importedAt,
        og.id AS groupId, og.kind AS groupKind, og.label AS groupLabel, og.collected_at AS groupCollectedAt
      FROM observations o
      LEFT JOIN data_sources ds ON ds.profile_id = o.profile_id AND ds.id = o.source_id
      LEFT JOIN source_imports si ON si.profile_id = ds.profile_id AND si.id = ds.import_id
      LEFT JOIN observation_groups og ON og.profile_id = o.profile_id AND og.id = o.observation_group_id
      WHERE o.profile_id = ? AND o.measurement_code = ?
      ORDER BY o.observed_at DESC, o.id DESC
      LIMIT ? OFFSET ?
    `, this.requireProfileId(), measurementCode, limit, offset);
    return {
      total: totalRow?.total ?? 0,
      records: rows.map((row) => ({
        id: row.id,
        measurementCode,
        observedAt: row.observedAt,
        value: row.value,
        unit: row.unit,
        sourceId: row.sourceId,
        observationGroupId: row.observationGroupId ?? undefined,
        deviceId: row.deviceId ?? undefined,
        note: row.note ?? undefined,
        sourceJson: row.sourceJson ? JSON.parse(row.sourceJson) : undefined,
        sourceKind: row.sourceKind ?? undefined,
        sourceLabel: row.sourceLabel ?? undefined,
        importFileName: row.importFileName ?? undefined,
        importedAt: row.importedAt ?? undefined,
        group: row.groupId && row.groupKind && row.groupLabel ? {
          id: row.groupId,
          kind: row.groupKind,
          label: row.groupLabel,
          collectedAt: row.groupCollectedAt ?? undefined
        } : undefined
      }))
    };
  }

  async observationChartSeries(
    measurementCode: string,
    aggregation: HealthDataChartSeries["aggregation"],
    options: HealthDataChartSeriesOptions
  ): Promise<HealthDataChartSeries> {
    const profileId = this.requireProfileId();
    const cutoff = chartRangeCutoff(options.range);
    const rangeSql = cutoff ? " AND observed_at >= ?" : "";
    const parameters = cutoff ? [profileId, measurementCode, cutoff] : [profileId, measurementCode];
    if (options.mode === "raw" || (aggregation !== "sum" && aggregation !== "average")) {
      const totalRow = await this.database.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) AS total FROM observations
         WHERE profile_id = ? AND measurement_code = ?${rangeSql}`,
        ...parameters
      );
      const rows = await this.database.getAllAsync<{
        timestamp: string;
        value: number;
        unit: string;
      }>(
        `SELECT observed_at AS timestamp, value, unit FROM observations
         WHERE profile_id = ? AND measurement_code = ?${rangeSql}
         ORDER BY observed_at DESC, id DESC LIMIT 501`,
        ...parameters
      );
      const totalPoints = totalRow?.total ?? 0;
      return {
        generatedAt: new Date().toISOString(),
        measurementCode,
        range: options.range,
        requestedMode: options.mode,
        granularity: "raw",
        aggregation,
        points: rows.slice(0, 500).reverse().map((point) => ({ ...point, count: 1 })),
        totalPoints,
        truncated: totalPoints > 500
      };
    }

    const aggregate = aggregation === "sum" ? "SUM(value)" : "AVG(value)";
    const loadBuckets = (bucket: "daily" | "weekly") => {
      const timestamp = bucket === "daily"
        ? "strftime('%Y-%m-%dT00:00:00.000Z', observed_at)"
        : "strftime('%Y-%m-%dT00:00:00.000Z', date(observed_at, '-' || ((CAST(strftime('%w', observed_at) AS INTEGER) + 6) % 7) || ' days'))";
      return this.database.getAllAsync<HealthDataChartSeries["points"][number]>(
        `SELECT ${timestamp} AS timestamp, ${aggregate} AS value, MIN(unit) AS unit,
           COUNT(*) AS count, MIN(value) AS minValue, MAX(value) AS maxValue
         FROM observations
         WHERE profile_id = ? AND measurement_code = ?${rangeSql}
         GROUP BY ${timestamp} ORDER BY timestamp`,
        ...parameters
      );
    };
    const dailyPoints = await loadBuckets("daily");
    const granularity = options.range === "all" && dailyPoints.length > 366 ? "weekly" : "daily";
    const points = granularity === "weekly" ? await loadBuckets("weekly") : dailyPoints;
    return {
      generatedAt: new Date().toISOString(),
      measurementCode,
      range: options.range,
      requestedMode: options.mode,
      granularity,
      aggregation,
      points,
      totalPoints: points.length,
      truncated: false
    };
  }

  async updateObservation(id: string, input: UpdateObservationInput): Promise<Observation | undefined> {
    await this.assertWritable();
    const existing = await this.observationById(id);
    if (!existing) return undefined;
    let changed = false;
    await this.database.withTransactionAsync(async () => {
      const result = await this.database.runAsync(
        `UPDATE observations
         SET measurement_code = ?, observed_at = ?, value = ?, unit = ?, note = ?
         WHERE profile_id = ? AND id = ?`,
        input.measurementCode,
        input.observedAt,
        input.value,
        input.unit,
        input.note ?? null,
        this.requireProfileId(),
        id
      );
      changed = result.changes === 1;
      if (changed) await this.rotateMigrationFingerprint();
    });
    if (!changed) return undefined;
    return {
      ...existing,
      measurementCode: input.measurementCode,
      observedAt: input.observedAt,
      value: input.value,
      unit: input.unit,
      note: input.note
    };
  }

  async deleteObservation(id: string): Promise<Observation | undefined> {
    await this.assertWritable();
    const existing = await this.observationById(id);
    if (!existing) return undefined;
    let changed = false;
    await this.database.withTransactionAsync(async () => {
      const result = await this.database.runAsync(
        "DELETE FROM observations WHERE profile_id = ? AND id = ?",
        this.requireProfileId(),
        id
      );
      changed = result.changes === 1;
      if (changed) await this.rotateMigrationFingerprint();
    });
    return changed ? existing : undefined;
  }

  async replicaMetadata(identity: ReplicaIdentity) {
    const row = await this.replicaDatabase.getFirstAsync<{
      server_instance_id: string;
      profile_id: string;
      pairing_id: string;
      cursor_sequence: number;
      revision: number;
      initial_snapshot_completed: number;
      cached_at: string | null;
      applied_at: string | null;
      snapshot_cursor: string | null;
    }>(
      `SELECT server_instance_id, profile_id, pairing_id, cursor_sequence, revision,
        initial_snapshot_completed, cached_at, applied_at, snapshot_cursor
       FROM connected_replicas WHERE replica_id = ?`,
      replicaId(identity)
    );
    return row ? {
      serverInstanceId: row.server_instance_id,
      profileId: row.profile_id,
      pairingId: row.pairing_id,
      cursorSequence: row.cursor_sequence,
      revision: row.revision,
      initialSnapshotCompleted: row.initial_snapshot_completed === 1,
      cachedAt: row.cached_at ?? undefined,
      appliedAt: row.applied_at ?? undefined,
      snapshotCursor: row.snapshot_cursor ?? undefined
    } : undefined;
  }

  async applyReplicaPage(page: ReplicaPage): Promise<void> {
    const identity = replicaIdentity(page);
    const id = replicaId(identity);
    const appliedAt = new Date().toISOString();
    await this.replicaDatabase.withTransactionAsync(async () => {
      await this.replicaDatabase.runAsync(
        `INSERT OR IGNORE INTO connected_replicas
         (replica_id, server_instance_id, profile_id, pairing_id)
         VALUES (?, ?, ?, ?)`,
        id,
        identity.serverInstanceId,
        identity.profileId,
        identity.pairingId
      );
      const metadata = await this.replicaMetadata(identity);
      if (!metadata) throw new Error("The connected replica identity could not be initialized.");
      if (page.kind === "delta" && !metadata.initialSnapshotCompleted) {
        throw new Error("Complete the first connected snapshot before applying deltas.");
      }
      await this.writeReplicaChanges(id, page.changes);
      const cursorSequence = page.kind === "snapshot"
        ? (page.complete ? page.highWaterMark.sequence : metadata.cursorSequence)
        : (page.complete
            ? page.highWaterMark.sequence
            : Math.max(metadata.cursorSequence, ...page.changes.map((change) => change.sequence)));
      const initialSnapshotCompleted = metadata.initialSnapshotCompleted ||
        (page.kind === "snapshot" && page.complete);
      await this.replicaDatabase.runAsync(
        `UPDATE connected_replicas SET cursor_sequence = ?, revision = ?,
         initial_snapshot_completed = ?, cached_at = ?, applied_at = ?, snapshot_cursor = ?
         WHERE replica_id = ?`,
        cursorSequence,
        Math.max(metadata.revision, page.highWaterMark.revision),
        initialSnapshotCompleted ? 1 : 0,
        page.cachedAt,
        appliedAt,
        resumableSnapshotCursor(page, metadata.snapshotCursor, initialSnapshotCompleted),
        id
      );
    });
  }

  /**
   * Applies one page of replica changes. No read-before-write is needed: the revision guards live
   * in the statements themselves, which halves the number of round trips per page.
   */
  private async writeReplicaChanges(id: string, changes: ReplicaPage["changes"]): Promise<void> {
    if (changes.length === 0) return;
    const upsert = await this.replicaDatabase.prepareAsync(
      `INSERT INTO connected_replica_entities
       (replica_id, entity_type, entity_id, payload_json, revision)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (replica_id, entity_type, entity_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         revision = excluded.revision
       WHERE excluded.revision >= connected_replica_entities.revision`
    );
    const tombstone = await this.replicaDatabase.prepareAsync(
      `DELETE FROM connected_replica_entities
       WHERE replica_id = ? AND entity_type = ? AND entity_id = ? AND revision <= ?`
    );
    try {
      for (const change of changes) {
        if (change.operation === "tombstone") {
          await tombstone.executeAsync(id, change.entityType, change.entityId, change.revision);
          continue;
        }
        if (change.payload === undefined) throw new Error("Replica upsert payload is missing.");
        await upsert.executeAsync(
          id,
          change.entityType,
          change.entityId,
          JSON.stringify(change.payload),
          change.revision
        );
      }
    } finally {
      await tombstone.finalizeAsync().catch(() => undefined);
      await upsert.finalizeAsync().catch(() => undefined);
    }
  }

  async replicaEntities(identity: ReplicaIdentity, filter: ReplicaEntityFilter = {}) {
    const metadata = await this.replicaMetadata(identity);
    if (!metadata?.initialSnapshotCompleted) {
      throw new Error("Connected data is unavailable offline until the first snapshot completes.");
    }
    const conditions = ["replica_id = ?"];
    const params: Array<string | number> = [replicaId(identity)];
    if (filter.entityTypes) {
      conditions.push(`entity_type IN (${filter.entityTypes.map(() => "?").join(", ")})`);
      params.push(...filter.entityTypes);
    }
    if (filter.measurementCode !== undefined) {
      // Applied in SQL so the rows for other measurements are never JSON-parsed into JS at all.
      const scoped = MEASUREMENT_SCOPED_REPLICA_TYPES;
      conditions.push(
        `(entity_type NOT IN (${scoped.map(() => "?").join(", ")})
          OR json_extract(payload_json, '$.measurementCode') = ?)`
      );
      params.push(...scoped, filter.measurementCode);
    }
    const rows = await this.replicaDatabase.getAllAsync<{ entity_type: string; payload_json: string }>(
      `SELECT entity_type, payload_json FROM connected_replica_entities
       WHERE ${conditions.join(" AND ")} ORDER BY entity_type, entity_id`,
      ...params
    );
    return rows.map((row) => ({
      entityType: row.entity_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>
    }));
  }

  async deleteReplica(identity: ReplicaIdentity): Promise<void> {
    const id = replicaId(identity);
    // Deleted explicitly rather than through the foreign-key cascade: this is the "forget my synced
    // health data" path, and orphaned entity rows would be unreachable health data.
    await this.replicaDatabase.withTransactionAsync(async () => {
      await this.replicaDatabase.runAsync("DELETE FROM connected_replica_entities WHERE replica_id = ?", id);
      await this.replicaDatabase.runAsync("DELETE FROM connected_replicas WHERE replica_id = ?", id);
    });
  }

  async promoteReplica(staging: ReplicaIdentity, target: ReplicaIdentity): Promise<void> {
    const stagingId = replicaId(staging);
    const targetId = replicaId(target);
    if (stagingId === targetId) return;
    // Ordered so no entity row is ever parentless: seed the new parent, move the children, then drop
    // the old parent.
    await this.replicaDatabase.withTransactionAsync(async () => {
      await this.replicaDatabase.runAsync("DELETE FROM connected_replica_entities WHERE replica_id = ?", targetId);
      await this.replicaDatabase.runAsync("DELETE FROM connected_replicas WHERE replica_id = ?", targetId);
      await this.replicaDatabase.runAsync(
        `INSERT INTO connected_replicas
         (replica_id, server_instance_id, profile_id, pairing_id, cursor_sequence, revision,
          initial_snapshot_completed, cached_at, applied_at, snapshot_cursor)
         SELECT ?, ?, ?, ?, cursor_sequence, revision, initial_snapshot_completed, cached_at,
           applied_at, snapshot_cursor
         FROM connected_replicas WHERE replica_id = ?`,
        targetId,
        target.serverInstanceId,
        target.profileId,
        target.pairingId,
        stagingId
      );
      await this.replicaDatabase.runAsync(
        "UPDATE connected_replica_entities SET replica_id = ? WHERE replica_id = ?",
        targetId,
        stagingId
      );
      await this.replicaDatabase.runAsync("DELETE FROM connected_replicas WHERE replica_id = ?", stagingId);
    });
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    return this.release();
  }

  async reset(): Promise<void> {
    // Release this store's lease instead of closing the shared handle behind the accounting's back.
    // Closing directly left `databaseLeases` above zero, so `resetSqliteLocalStorage` refused to run
    // and the module kept caching a handle to a database that was already closed.
    await this.close();
    await resetSqliteLocalStorage();
    this.profileId = undefined;
  }

  private requireProfileId(): string {
    if (!this.profileId) throw new Error("The local profile has not been initialized.");
    return this.profileId;
  }

  private async migrationEntityCounts(): Promise<MobileMigrationManifest["counts"]> {
    const row = await this.database.getFirstAsync<MobileMigrationManifest["counts"]>(`
      SELECT
        (SELECT COUNT(*) FROM source_imports WHERE profile_id = ?) AS sourceImports,
        (SELECT COUNT(*) FROM data_sources WHERE profile_id = ?) AS dataSources,
        (SELECT COUNT(*) FROM observation_groups WHERE profile_id = ?) AS observationGroups,
        (SELECT COUNT(*) FROM observations WHERE profile_id = ?) AS observations
    `, this.requireProfileId(), this.requireProfileId(), this.requireProfileId(), this.requireProfileId());
    return row ?? { sourceImports: 0, dataSources: 0, observationGroups: 0, observations: 0 };
  }

  private async assertWritable(): Promise<void> {
    if ((await this.datasetMetadata()).lifecycleState !== "active") {
      throw new Error("This migrated Standalone dataset is a read-only archive.");
    }
  }

  private async rotateMigrationFingerprint(): Promise<void> {
    await this.database.runAsync(
      `UPDATE datasets
       SET migration_fingerprint = 'standalone:' || lower(hex(randomblob(16)))
       WHERE profile_id = ?`,
      this.requireProfileId()
    );
  }

  private async observationById(id: string): Promise<Observation | undefined> {
    const row = await this.database.getFirstAsync<{
      id: string;
      measurementCode: string;
      observedAt: string;
      value: number;
      unit: string;
      sourceId: string;
      observationGroupId: string | null;
      deviceId: string | null;
      note: string | null;
      sourceJson: string | null;
    }>(`
      SELECT id, measurement_code AS measurementCode, observed_at AS observedAt, value, unit,
        source_id AS sourceId, observation_group_id AS observationGroupId, device_id AS deviceId,
        note, source_json AS sourceJson
      FROM observations
      WHERE profile_id = ? AND id = ?
    `, this.requireProfileId(), id);
    if (!row) return undefined;
    return {
      ...row,
      observationGroupId: row.observationGroupId ?? undefined,
      deviceId: row.deviceId ?? undefined,
      note: row.note ?? undefined,
      sourceJson: row.sourceJson ? JSON.parse(row.sourceJson) : undefined
    };
  }

}

function replicaIdentity(page: ReplicaPage): ReplicaIdentity {
  return {
    serverInstanceId: page.serverInstanceId,
    profileId: page.profileId,
    pairingId: page.pairingId
  };
}

function replicaId(identity: ReplicaIdentity): string {
  return `${identity.serverInstanceId}:${identity.profileId}:${identity.pairingId}`;
}

/**
 * Keeps the resume point for an interrupted first snapshot so a failed page does not force the
 * whole dataset to be downloaded again. Cleared once the snapshot completes.
 */
function resumableSnapshotCursor(
  page: ReplicaPage,
  current: string | undefined,
  initialSnapshotCompleted: boolean
): string | null {
  if (initialSnapshotCompleted) return null;
  if (page.kind === "snapshot") return page.nextCursor ?? null;
  return current ?? null;
}

/**
 * Row shapes for the migration export. These mirror the `AS` aliases in the queries below and the
 * element schemas in `mobileMigrationBatchSchema`: a renamed column or a dropped alias becomes a
 * compile error here instead of a field that silently arrives as `undefined` on the desktop.
 */
type SourceImportRow = {
  id: string;
  sourceKind: MobileMigrationBatch["sourceImports"][number]["sourceKind"];
  fileName: string;
  importedAt: string;
  parserVersion: string;
  checksum: string;
  rowCount: number;
  status: MobileMigrationBatch["sourceImports"][number]["status"];
  diagnostics: string;
}

type DataSourceRow = {
  id: string;
  sourceKind: MobileMigrationBatch["dataSources"][number]["sourceKind"];
  label: string;
  importId: string | null;
  createdAt: string;
}

type ObservationGroupRow = {
  id: string;
  kind: MobileMigrationBatch["observationGroups"][number]["kind"];
  label: string;
  sourceId: string | null;
  importId: string | null;
  startAt: string | null;
  endAt: string | null;
  collectedAt: string | null;
  metadata: string;
}

type ObservationRow = {
  id: string;
  measurementCode: string;
  observedAt: string;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  value: number;
  unit: string;
  sourceId: string;
  observationGroupId: string | null;
  deviceId: string | null;
  note: string | null;
  sourceJson: string | null;
}

/** Strips SQLite `NULL`s so optional fields are absent rather than explicitly null. */
type NullsToUndefined<T> = { [K in keyof T]: null extends T[K] ? Exclude<T[K], null> | undefined : T[K] };

function withUndefinedNulls<T extends Record<string, unknown>>(value: T): NullsToUndefined<T> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry ?? undefined])) as NullsToUndefined<T>;
}
