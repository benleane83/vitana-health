import { LocalProfileRepository } from "./localRepository";
import { MemoryLocalStore } from "./memoryLocalStore";

let store = new MemoryLocalStore();

export async function createStandaloneRepository() {
  const id = globalThis.crypto?.randomUUID?.() ??
    `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return new LocalProfileRepository(store, {
    id: `mobile-${id}`,
    displayName: "My profile",
    subjectKind: "adult",
    units: "metric",
    updatedAt: new Date().toISOString()
  });
}

export async function resetStandaloneStorage(): Promise<void> {
  store = new MemoryLocalStore();
}
