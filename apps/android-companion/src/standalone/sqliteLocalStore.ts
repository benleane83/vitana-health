import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type {
  MobileImportResult,
  Observation,
  ParsedImport,
  Profile,
  UpdateObservationInput
} from "@local-fitness-advisor/shared";
import { openWithDatabaseKey, type SecureKeyStore } from "./databaseKey";
import { deleteEmptyPlaintextDatabase, isFileNotDatabaseError } from "./databaseRecovery";
import {
  LOCAL_SCHEMA_VERSION,
  emptyCounts,
  entityOutcome,
  type LocalObservationAggregate,
  type LocalObservationPage,
  type LocalStore,
  type LocalStoreCounts
} from "./localStore";
import { migrate } from "./migrations";

const DATABASE_NAME = "standalone-health.db";
const DATABASE_KEY_NAME = "local-fitness-advisor.standaloneDatabaseKey.v1";

const secureKeyStore: SecureKeyStore = {
  get: () => SecureStore.getItemAsync(DATABASE_KEY_NAME),
  set: (value) => SecureStore.setItemAsync(DATABASE_KEY_NAME, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  }),
  remove: () => SecureStore.deleteItemAsync(DATABASE_KEY_NAME)
};

export async function openSqliteLocalStore(): Promise<SqliteLocalStore> {
  try {
    return await openSqliteLocalStoreOnce();
  } catch (error) {
    if (!isFileNotDatabaseError(error)) throw error;
    const removed = await deleteEmptyPlaintextDatabase(
      () => openDatabaseAsync(DATABASE_NAME),
      () => deleteDatabaseAsync(DATABASE_NAME)
    );
    if (!removed) throw error;

    await secureKeyStore.remove();
    return openSqliteLocalStoreOnce();
  }
}

async function openSqliteLocalStoreOnce(): Promise<SqliteLocalStore> {
  let databaseReadable = false;
  return openWithDatabaseKey(secureKeyStore, Crypto.getRandomBytesAsync, async (hexKey) => {
    const database = await openDatabaseAsync(DATABASE_NAME);
    let phase = "applying the encryption key";
    try {
      await database.execAsync(`PRAGMA key = "x'${hexKey}'";`);
      phase = "checking SQLCipher availability";
      const cipher = await database.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
      if (!cipher?.cipher_version) {
        throw new Error("SQLCipher is unavailable. Reinstall the standalone test build with SQLCipher enabled.");
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
      await migrate(database);
      return new SqliteLocalStore(database);
    } catch (error) {
      await database.closeAsync().catch(() => undefined);
      const detail = error instanceof Error ? error.message : "Unknown database error";
      throw new Error(`Unable to open the encrypted standalone database safely while ${phase}: ${detail}`);
    }
  }, () => !databaseReadable);
}

export async function resetSqliteLocalStorage(): Promise<void> {
  await deleteDatabaseAsync(DATABASE_NAME);
  await secureKeyStore.remove();
}

export class SqliteLocalStore implements LocalStore {
  private profileId?: string;

  constructor(private readonly database: SQLiteDatabase) {}

  async initialize(defaultProfile: Profile): Promise<void> {
    await this.database.runAsync(
      "INSERT OR IGNORE INTO profiles (id, profile_json, updated_at) VALUES (?, ?, ?)",
      defaultProfile.id,
      JSON.stringify(defaultProfile),
      defaultProfile.updatedAt
    );
    this.profileId = defaultProfile.id;
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

  async recentObservations(limit: number) {
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
      SELECT id, measurement_code AS measurementCode, observed_at AS observedAt, value, unit,
        source_id AS sourceId, observation_group_id AS observationGroupId, device_id AS deviceId,
        note, source_json AS sourceJson
      FROM observations
      WHERE profile_id = ?
      ORDER BY observed_at DESC, id DESC
      LIMIT ?
    `, this.requireProfileId(), limit).then((rows) => rows.map((row) => ({
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
      SELECT measurement_code AS measurementCode, COUNT(*) AS count, MAX(observed_at) AS lastMeasuredAt
      FROM observations
      WHERE profile_id = ?
      GROUP BY measurement_code
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

  async updateObservation(id: string, input: UpdateObservationInput): Promise<Observation | undefined> {
    const existing = await this.observationById(id);
    if (!existing) return undefined;
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
    if (result.changes !== 1) return undefined;
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
    const existing = await this.observationById(id);
    if (!existing) return undefined;
    const result = await this.database.runAsync(
      "DELETE FROM observations WHERE profile_id = ? AND id = ?",
      this.requireProfileId(),
      id
    );
    return result.changes === 1 ? existing : undefined;
  }

  close(): Promise<void> {
    return this.database.closeAsync();
  }

  async reset(): Promise<void> {
    await this.database.closeAsync();
    await resetSqliteLocalStorage();
    this.profileId = undefined;
  }

  private requireProfileId(): string {
    if (!this.profileId) throw new Error("The local profile has not been initialized.");
    return this.profileId;
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
