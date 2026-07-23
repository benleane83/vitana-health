import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { assertDesktopUpdaterInstalled, createLanBuilderConfig } from "./package-desktop-lan.mjs";

const script = path.resolve("scripts/package-desktop-lan.mjs");

function run(env) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      VITANA_LAN_UPDATE_URL: "http://192.168.1.10:8082/",
      VITANA_LAN_UPDATE_VERSION: "1.0.1",
      ...env
    }
  });
}

test("LAN packaging rejects public or credentialed feed URLs", () => {
  const publicFeed = run({ VITANA_LAN_UPDATE_URL: "http://updates.example.com/" });
  assert.equal(publicFeed.status, 1);
  assert.match(publicFeed.stderr, /private\/loopback/);

  const credentialed = run({ VITANA_LAN_UPDATE_URL: "http://" + "user:password@" + "192.168.1.10/" });
  assert.equal(credentialed.status, 1);
  assert.match(credentialed.stderr, /no credentials/);
});

test("LAN packaging requires a valid version and signing inputs before building", () => {
  const version = run({ VITANA_LAN_UPDATE_VERSION: "latest" });
  assert.equal(version.status, 1);
  assert.match(version.stderr, /SemVer/);

  const signing = run({});
  assert.equal(signing.status, 1);
  assert.match(signing.stderr, /CSC_LINK and CSC_KEY_PASSWORD/);
});

test("LAN packaging detects a missing updater dependency before creating an installer", () => {
  assert.throws(
    () => assertDesktopUpdaterInstalled(() => { throw new Error("not found"); }),
    /electron-updater is missing.*npm install --workspace @vitana\/desktop --include=prod/
  );
});

test("LAN packaging uses a generic publisher array without changing desktop build settings", () => {
  const config = createLanBuilderConfig(new URL("http://192.168.1.10:8082/"), "1.0.1-lan.1");

  assert.deepEqual(config.publish, [{ provider: "generic", url: "http://192.168.1.10:8082/" }]);
  assert.equal(config.extraMetadata.version, "1.0.1-lan.1");
  assert.equal(config.extraMetadata.vitanaUpdateChannel, "lan");
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.equal(config.nsis.perMachine, true);
});
