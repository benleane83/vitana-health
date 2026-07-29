import { Directory, File, Paths } from "expo-file-system";

/**
 * Minimal file surface the migration backup needs. Kept injectable so the backup/restore decision
 * logic is unit-testable without a device filesystem, matching `databaseRecovery.ts`.
 */
export interface DatabaseFileStore {
  exists(name: string): Promise<boolean>;
  copy(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface RowCountDatabase {
  getAllAsync<T>(query: string): Promise<T[]>;
  getFirstAsync<T>(query: string): Promise<T | null>;
}

/**
 * SQLite writes the main file plus a write-ahead log and shared-memory index. A backup that copies
 * only the `.db` would restore a torn database, so all three move together.
 */
const databaseFileSuffixes = ["", "-wal", "-shm"] as const;

/** Tables whose rows must survive every migration. */
const trackedTables = [
  "profiles",
  "source_imports",
  "data_sources",
  "observation_groups",
  "observations"
] as const;

export function migrationBackupName(databaseName: string, fromVersion: number, suffix: string): string {
  return `${databaseName}${suffix}.pre-v${fromVersion}.bak`;
}

/**
 * Copies the database aside before a migration runs. Returns the suffixes that were actually
 * captured so a later restore only puts back files that existed beforehand — restoring a `-wal`
 * that never existed would resurrect stale frames.
 */
export async function captureMigrationBackup(
  files: DatabaseFileStore,
  databaseName: string,
  fromVersion: number
): Promise<string[]> {
  const captured: string[] = [];
  for (const suffix of databaseFileSuffixes) {
    const source = `${databaseName}${suffix}`;
    if (!(await files.exists(source))) continue;
    const target = migrationBackupName(databaseName, fromVersion, suffix);
    await files.remove(target).catch(() => undefined);
    await files.copy(source, target);
    captured.push(suffix);
  }
  return captured;
}

/**
 * Puts a captured backup back. Files that were not captured are removed rather than left in place,
 * because a `-wal` produced by the failed migration must not be replayed onto the restored `.db`.
 */
export async function restoreMigrationBackup(
  files: DatabaseFileStore,
  databaseName: string,
  fromVersion: number,
  captured: readonly string[]
): Promise<void> {
  for (const suffix of databaseFileSuffixes) {
    const live = `${databaseName}${suffix}`;
    const backup = migrationBackupName(databaseName, fromVersion, suffix);
    if (!captured.includes(suffix)) {
      await files.remove(live).catch(() => undefined);
      continue;
    }
    await files.remove(live).catch(() => undefined);
    await files.copy(backup, live);
  }
}

export async function discardMigrationBackup(
  files: DatabaseFileStore,
  databaseName: string,
  fromVersion: number,
  captured: readonly string[]
): Promise<void> {
  for (const suffix of captured) {
    await files.remove(migrationBackupName(databaseName, fromVersion, suffix)).catch(() => undefined);
  }
}

/**
 * Counts rows in the tracked tables that currently exist. Tables are discovered rather than assumed
 * because a database at schema 0 has none of them yet.
 */
export async function countTrackedRows(database: RowCountDatabase): Promise<Record<string, number>> {
  const present = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  );
  const names = new Set(present.map((row) => row.name));
  const counts: Record<string, number> = {};
  for (const table of trackedTables) {
    if (!names.has(table)) continue;
    const row = await database.getFirstAsync<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`);
    counts[table] = row?.total ?? 0;
  }
  return counts;
}

/**
 * A migration may add rows but must never lose any. Anything that shrinks a tracked table is a bug
 * in the migration, and is worth failing loudly for while the backup is still available.
 */
export function assertRowCountsPreserved(
  before: Record<string, number>,
  after: Record<string, number>
): void {
  for (const [table, expected] of Object.entries(before)) {
    const actual = after[table];
    if (actual === undefined) throw new Error(`Migration dropped the ${table} table.`);
    if (actual < expected) {
      throw new Error(`Migration lost rows in ${table}: ${expected} before, ${actual} after.`);
    }
  }
}

export async function assertDatabaseIntegrity(database: RowCountDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ integrity_check: string }>("PRAGMA integrity_check");
  const result = row?.integrity_check;
  if (result !== "ok") {
    throw new Error(`Integrity check failed after migrating: ${result ?? "no result"}.`);
  }
}

/** The on-device implementation, backed by the directory `expo-sqlite` stores databases in. */
export const expoDatabaseFileStore: DatabaseFileStore = {
  exists: async (name) => sqliteFile(name).exists,
  copy: async (from, to) => {
    await sqliteFile(from).copy(sqliteFile(to));
  },
  remove: async (name) => {
    const file = sqliteFile(name);
    if (file.exists) file.delete();
  }
};

function sqliteFile(name: string): File {
  return new File(new Directory(Paths.document, "SQLite"), name);
}
