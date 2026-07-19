interface DatabaseProbe {
  getFirstAsync(query: string): Promise<{ table_count: number } | null>;
  closeAsync(): Promise<void>;
}

export function isFileNotDatabaseError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("file is not a database");
}

export async function deleteEmptyPlaintextDatabase(
  openDatabase: () => Promise<DatabaseProbe>,
  deleteDatabase: () => Promise<void>
): Promise<boolean> {
  let database: DatabaseProbe | undefined;
  try {
    database = await openDatabase();
    const row = await database.getFirstAsync(
      "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    if ((row?.table_count ?? 0) !== 0) return false;

    await database.closeAsync();
    database = undefined;
    await deleteDatabase();
    return true;
  } catch {
    return false;
  } finally {
    await database?.closeAsync().catch(() => undefined);
  }
}