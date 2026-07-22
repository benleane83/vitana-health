import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("desktop update server is strict and serves updater asset headers", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "vitana-updates-"));
  writeFileSync(path.join(root, "latest.yml"), "version: 1.2.3\n");
  writeFileSync(path.join(root, "Vitana.exe.blockmap"), "map");
  writeFileSync(path.join(root, "Vitana.exe"), "exe");
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [
    path.resolve("scripts/serve-desktop-updates.mjs"),
    "--lan", "--root", root, "--port", String(port)
  ], { stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("127.0.0.1")) resolve();
    });
    child.once("exit", (code) => reject(new Error(`Update server exited with ${code}`)));
  });

  const metadata = await fetch(`http://127.0.0.1:${port}/latest.yml`);
  assert.equal(metadata.status, 200);
  assert.match(metadata.headers.get("content-type"), /application\/yaml/);
  assert.equal(metadata.headers.get("cache-control"), "no-store");

  const blockmap = await fetch(`http://127.0.0.1:${port}/Vitana.exe.blockmap`);
  assert.equal(blockmap.headers.get("content-type"), "application/octet-stream");
  assert.match(blockmap.headers.get("cache-control"), /immutable/);
  assert.match((await fetch(`http://127.0.0.1:${port}/Vitana.exe`)).headers.get("content-type"), /portable-executable/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/missing`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/%E0%A4%A`)).status, 400);
});

test("desktop update server requires explicit LAN mode", async () => {
  const child = spawn(process.execPath, [path.resolve("scripts/serve-desktop-updates.mjs")]);
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 1);
});
