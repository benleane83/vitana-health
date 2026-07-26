import { connect } from "node:net";
import { resolve } from "node:path";
import { ProfileStoreManager } from "../storage/profileStoreManager.js";
import { RestoreJournal } from "../storage/restoreJournal.js";
import {
  TEST_PROFILE_ID,
  TEST_PROFILE_NAME,
  createTestProfileFixture
} from "./testProfileFixture.js";

const replace = process.argv.includes("--replace");
const extensionPath = process.env.VITANA_DUCKDB_HTTPFS_EXTENSION;

if (!extensionPath) {
  throw new Error("VITANA_DUCKDB_HTTPFS_EXTENSION is required. Run this command through npm run seed:test-profile.");
}
if (await isPortOpen(4317)) {
  throw new Error("Stop the Vitana API before seeding; port 4317 is currently in use.");
}

const dataDir = process.env.VITANA_DATA_DIR
  ? resolve(process.env.VITANA_DATA_DIR)
  : resolve(process.cwd(), "..", "..", "data");
const manager = await ProfileStoreManager.open({
  storageBackend: "duckdb",
  duckdb: { httpfsExtensionPath: extensionPath }
});

try {
  const existing = manager.listProfiles().find((profile) => profile.id === TEST_PROFILE_ID);
  if (existing && !replace) {
    throw new Error(`${TEST_PROFILE_NAME} already exists. Re-run with --replace to replace only this reserved test profile.`);
  }

  const activeProfileId = manager.getActiveProfileId();
  const fixture = createTestProfileFixture();
  const journal = new RestoreJournal(dataDir, `seed-test-profile-${Date.now()}`);
  const result = await manager.restoreProfiles([{
    sourceProfileId: TEST_PROFILE_ID,
    decision: "replace",
    displayName: TEST_PROFILE_NAME,
    data: fixture
  }], journal);
  const profileId = result[0]?.newProfileId ?? result[0]?.profileId ?? TEST_PROFILE_ID;
  const counts = await manager.getStore(profileId).storageCounts();

  if (manager.getActiveProfileId() !== activeProfileId) {
    throw new Error("Seeding unexpectedly changed the active profile.");
  }
  console.log(JSON.stringify({ profileId, displayName: TEST_PROFILE_NAME, activeProfileId, counts }, null, 2));
} finally {
  await manager.closeAll();
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(300);
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.once("error", () => resolvePort(false));
  });
}
