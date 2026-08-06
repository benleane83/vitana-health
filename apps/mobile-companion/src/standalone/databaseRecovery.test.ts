import { describe, expect, it, vi } from "vitest";
import { deleteEmptyPlaintextDatabase } from "./databaseRecovery";

describe("standalone database recovery", () => {
  it("deletes a demonstrably empty plaintext database", async () => {
    const close = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);

    await expect(deleteEmptyPlaintextDatabase(async () => ({
      getFirstAsync: async () => ({ table_count: 0 }),
      closeAsync: close
    }), remove)).resolves.toBe(true);

    expect(close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("retains a populated plaintext database", async () => {
    const close = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);

    await expect(deleteEmptyPlaintextDatabase(async () => ({
      getFirstAsync: async () => ({ table_count: 1 }),
      closeAsync: close
    }), remove)).resolves.toBe(false);

    expect(close).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it("retains a database that cannot be proven to be empty plaintext", async () => {
    const close = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);

    await expect(deleteEmptyPlaintextDatabase(async () => ({
      getFirstAsync: async () => { throw new Error("file is not a database"); },
      closeAsync: close
    }), remove)).resolves.toBe(false);

    expect(close).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });
});