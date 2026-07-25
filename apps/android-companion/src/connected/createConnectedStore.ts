import { MemoryLocalStore } from "../standalone/memoryLocalStore";

let store = new MemoryLocalStore();

export async function createConnectedStore() {
  return store;
}

export function resetConnectedStoreForTests(): void {
  store = new MemoryLocalStore();
}

