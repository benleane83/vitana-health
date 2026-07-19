import * as Crypto from "expo-crypto";
import { LocalProfileRepository } from "./localRepository";
import { openSqliteLocalStore, resetSqliteLocalStorage } from "./sqliteLocalStore";

export async function createStandaloneRepository() {
  const store = await openSqliteLocalStore();
  return new LocalProfileRepository(store, {
    id: `mobile-${Crypto.randomUUID()}`,
    displayName: "My profile",
    subjectKind: "adult",
    units: "metric",
    updatedAt: new Date().toISOString()
  });
}

export const resetStandaloneStorage = resetSqliteLocalStorage;
