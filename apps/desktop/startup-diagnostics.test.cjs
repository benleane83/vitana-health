const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { createStartupDiagnostics } = require("./startup-diagnostics.cjs");

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writes startup checkpoints and errors to the user-data log", () => {
  const root = mkdtempSync(path.join(tmpdir(), "vitana-startup-diagnostics-test-"));
  roots.push(root);
  const diagnostics = createStartupDiagnostics({
    userDataPath: root,
    now: () => new Date("2026-07-19T16:00:00.000Z")
  });

  diagnostics.info("Electron ready");
  diagnostics.error("Startup failed", new Error("Test failure"));

  assert.equal(existsSync(diagnostics.logPath), true);
  const log = readFileSync(diagnostics.logPath, "utf8");
  assert.match(log, /INFO Electron ready/);
  assert.match(log, /ERROR Startup failed Error: Test failure/);
});