import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProfileListEntry } from "@vitana/shared";
import { ProfileStoreManager } from "../storage/profileStoreManager.js";

const originalDataDir = process.env.VITANA_DATA_DIR;
let dataDir: string | undefined;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.VITANA_DATA_DIR;
  else process.env.VITANA_DATA_DIR = originalDataDir;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

describe("ProfileStoreManager photo metadata", () => {
  it("never exposes or persists photo bytes in the profile registry", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "vitana-profile-registry-"));
    process.env.VITANA_DATA_DIR = dataDir;
    const manager = Reflect.construct(ProfileStoreManager, [{
      passphrase: "profile-registry-test",
      securityMode: "env-secret"
    }, 0]) as ProfileStoreManager;
    Object.assign(manager, {
      profiles: [{
        id: "self",
        displayName: "Self",
        updatedAt: "2026-07-24T10:00:00.000Z"
      } satisfies ProfileListEntry]
    });
    const storedPhoto = {
      contentType: "image/jpeg" as const,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      revision: "a".repeat(64),
      updatedAt: "2026-07-24T10:01:00.000Z"
    };

    await manager.syncProfilePhotoMetadata("self", storedPhoto);

    const expectedPhoto = {
      revision: storedPhoto.revision,
      updatedAt: storedPhoto.updatedAt
    };
    expect(manager.listProfiles()[0].profilePhoto).toEqual(expectedPhoto);
    expect(JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")))
      .toEqual({ profiles: [{ id: "self", displayName: "Self", updatedAt: "2026-07-24T10:00:00.000Z", profilePhoto: expectedPhoto }] });
  });
});
