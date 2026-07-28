import * as Crypto from "expo-crypto";
import { LocalProfileRepository } from "./localRepository";
import { openSqliteLocalStore, resetSqliteLocalStorage } from "./sqliteLocalStore";

export async function createStandaloneRepository() {
  const store = await openSqliteLocalStore();
  return new LocalProfileRepository(store, createStandaloneProfile());
}

export function createStandaloneProfile() {
  return {
    id: `mobile-${Crypto.randomUUID()}`,
    displayName: "My profile",
    subjectKind: "adult" as const,
    units: "metric" as const,
    updatedAt: new Date().toISOString()
  };
}

export const resetStandaloneStorage = resetSqliteLocalStorage;
