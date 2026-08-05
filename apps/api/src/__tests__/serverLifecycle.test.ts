import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const closeAll = vi.fn(async () => undefined);
let exposureListener: ((required: boolean) => void) | undefined;

vi.mock("../storage/profileStoreManager.js", () => ({
  hasDuckDbActivationManifest: () => true,
  ProfileStoreManager: {
    open: vi.fn(async () => ({
      closeAll,
      listProfiles: () => [{ id: "self", displayName: "Self" }],
      getActiveProfileId: () => "self",
      getStorageBackend: () => "duckdb"
    }))
  }
}));
vi.mock("../createApp.js", () => ({ createApp: () => (_req: unknown, _res: unknown) => undefined }));
vi.mock("../security.js", () => ({ configureRuntimeSecurity: async () => ({ publicKeyHash: "hash" }) }));
vi.mock("../pairing.js", () => ({ PairingStore: class {
  requiresLanExposure() { return false; }
  setLanExposureListener(listener: (required: boolean) => void) {
    exposureListener = listener;
    listener(false);
  }
  flushPendingWrites() {}
} }));

const originalEnv = { ...process.env };

describe("startServer failure handling", () => {
  beforeEach(() => {
    closeAll.mockClear();
    exposureListener = undefined;
    process.env.HOST = "127.0.0.1";
    process.env.VITANA_DUCKDB_HTTPFS_EXTENSION = "httpfs.duckdb_extension";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("closes health storage when the port is already taken", async () => {
    // Anything that fails after ProfileStoreManager.open() must still release the DuckDB handles;
    // otherwise the encrypted store stays locked and the next launch cannot open it either.
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    process.env.PORT = String((blocker.address() as AddressInfo).port);

    const { startServer } = await import("../server.js");
    try {
      await expect(startServer()).rejects.toThrow(/EADDRINUSE/);
      expect(closeAll).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("rebinds the same port while pairing requires LAN access", async () => {
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    process.env.PORT = String((reservation.address() as AddressInfo).port);
    await new Promise<void>((resolve) => reservation.close(() => resolve()));

    const { startServer } = await import("../server.js");
    const server = await startServer({ dynamicLanExposure: true });
    try {
      expect(server.currentHost()).toBe("127.0.0.1");
      exposureListener?.(true);
      await vi.waitFor(() => expect(server.currentHost()).toBe("0.0.0.0"));
      exposureListener?.(false);
      await vi.waitFor(() => expect(server.currentHost()).toBe("127.0.0.1"));
    } finally {
      await server.shutdown();
    }
  });
});
