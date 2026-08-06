import { REPLICA_SCHEMA_VERSION } from "./localStore";
import { replicaResetSql, replicaSchemaSql } from "./migrations";

export interface ReplicaCacheDatabase {
  execAsync(query: string): Promise<void>;
  getFirstAsync<T>(query: string): Promise<T | null>;
}

/**
 * Brings the replica cache to the current shape, rebuilding it whenever the shape has changed.
 *
 * This is the payoff of keeping the cache in its own file. Every row here is a copy of something
 * the paired PC still holds, so the correct answer to "this table looks different now" is to throw
 * it away and re-sync - not to write an ALTER, back the file up, and assert that no rows were lost.
 * A version *ahead* of this build is rebuilt too: an older binary cannot read a newer cache, but it
 * can always ask the PC for a fresh one, so there is no read-only state to fall back to.
 */
export async function prepareReplicaCache(database: ReplicaCacheDatabase): Promise<{ rebuilt: boolean }> {
  const row = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const version = row?.user_version ?? 0;
  const rebuilt = version !== REPLICA_SCHEMA_VERSION;

  if (rebuilt && version !== 0) {
    await database.execAsync(replicaResetSql);
  }
  await database.execAsync(replicaSchemaSql);
  if (rebuilt) {
    await database.execAsync(`PRAGMA user_version = ${REPLICA_SCHEMA_VERSION};`);
  }
  return { rebuilt };
}
