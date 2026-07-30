import { describe, expect, it, vi } from "vitest";
import { LazyProfileStore } from "../storage/lazyProfileStore.js";
import type { ManagedProfileRepository } from "../storage/profileRepository.js";

function fakeRepository(profileId: string, close = vi.fn(async () => undefined)) {
  const repository = {
    profileId,
    close,
    storageCounts: vi.fn(async () => ({ observations: 1 })),
    getProfile: vi.fn(async () => ({ id: profileId }))
  };
  return repository as unknown as ManagedProfileRepository & typeof repository;
}

describe("LazyProfileStore", () => {
  it("does not open the database until a caller reads from it", async () => {
    const repository = fakeRepository("self");
    const open = vi.fn(async () => repository);
    const store = new LazyProfileStore({ profileId: "self", open });

    expect(store.isOpen).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(store.repository.profileId).toBe("self");
    expect(open).not.toHaveBeenCalled();

    await expect(store.repository.storageCounts()).resolves.toEqual({ observations: 1 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(store.isOpen).toBe(true);
  });

  it("opens once for concurrent callers and reopens after eviction", async () => {
    const repository = fakeRepository("self");
    const open = vi.fn(async () => repository);
    let clock = 0;
    const store = new LazyProfileStore({ profileId: "self", open, now: () => clock });

    await Promise.all([store.repository.storageCounts(), store.repository.getProfile()]);
    expect(open).toHaveBeenCalledTimes(1);

    clock = 10_000;
    await expect(store.evictIfIdle(5_000)).resolves.toBe(true);
    expect(repository.close).toHaveBeenCalledTimes(1);
    expect(store.isOpen).toBe(false);

    await store.repository.storageCounts();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("never evicts a database a caller is still using", async () => {
    let release: (() => void) | undefined;
    const repository = fakeRepository("self");
    repository.storageCounts.mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve({ observations: 1 });
      })
    );
    const store = new LazyProfileStore({ profileId: "self", open: async () => repository, now: () => 0 });

    const pending = store.repository.storageCounts();
    await vi.waitFor(() => expect(release).toBeDefined());

    await expect(store.evictIfIdle(0)).resolves.toBe(false);
    expect(repository.close).not.toHaveBeenCalled();

    release!();
    await pending;
    await expect(store.evictIfIdle(0)).resolves.toBe(true);
  });

  it("retries the next call after a failed open instead of caching the failure", async () => {
    const repository = fakeRepository("self");
    const open = vi.fn()
      .mockRejectedValueOnce(new Error("database locked"))
      .mockResolvedValue(repository);
    const store = new LazyProfileStore({ profileId: "self", open });

    await expect(store.repository.storageCounts()).rejects.toThrow("database locked");
    expect(store.isOpen).toBe(false);
    await expect(store.repository.storageCounts()).resolves.toEqual({ observations: 1 });
  });

  it("adopts a store the caller had to open to create it", async () => {
    const repository = fakeRepository("pilot");
    const open = vi.fn(async () => repository);
    const store = new LazyProfileStore({ profileId: "pilot", open, initial: repository });

    expect(store.isOpen).toBe(true);
    await store.repository.getProfile();
    expect(open).not.toHaveBeenCalled();
  });

  it("is not mistaken for a promise when it is resolved", async () => {
    const repository = fakeRepository("self");
    const store = new LazyProfileStore({ profileId: "self", open: async () => repository });

    await expect(Promise.resolve(store.repository)).resolves.toBe(store.repository);
  });
});
