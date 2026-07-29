const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createDesktopLifecycle } = require("./desktop-lifecycle.cjs");

function makeApp() {
  const calls = [];
  return {
    calls,
    quit: () => calls.push("quit"),
    exit: (code) => calls.push(`exit:${code}`)
  };
}

function makeDiagnostics() {
  const entries = [];
  return {
    entries,
    info: (message) => entries.push(["info", message]),
    error: (message) => entries.push(["error", message])
  };
}

function makeEvent() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

/** Fires every pending timer immediately so timeout paths are testable without real delays. */
function makeClock() {
  const pending = new Map();
  let nextId = 1;
  return {
    schedule(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    clear(id) { pending.delete(id); },
    fireAll() {
      for (const callback of [...pending.values()]) callback();
      pending.clear();
    }
  };
}

function makeLifecycle(overrides = {}) {
  const app = makeApp();
  const diagnostics = makeDiagnostics();
  const clock = makeClock();
  const lifecycle = createDesktopLifecycle({
    app,
    diagnostics,
    schedule: clock.schedule,
    clearScheduled: clock.clear,
    exit: (code) => app.exit(code),
    ...overrides
  });
  return { app, diagnostics, clock, lifecycle };
}

test("before-quit defers the quit until storage has closed", async () => {
  const { app, lifecycle } = makeLifecycle();
  let resolveShutdown;
  lifecycle.setServer({ shutdown: () => new Promise((resolve) => { resolveShutdown = resolve; }) });

  const event = makeEvent();
  lifecycle.handleBeforeQuit(event);

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(app.calls, []);

  resolveShutdown();
  await new Promise(setImmediate);
  assert.deepEqual(app.calls, ["quit"]);
});

test("before-quit does not defer when there is no server to close", () => {
  const { lifecycle } = makeLifecycle();
  const event = makeEvent();

  lifecycle.handleBeforeQuit(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(lifecycle.isQuitting(), true);
});

test("a second before-quit does not start a second shutdown", async () => {
  const { app, lifecycle } = makeLifecycle();
  let shutdownCalls = 0;
  let resolveShutdown;
  lifecycle.setServer({
    shutdown: () => {
      shutdownCalls += 1;
      return new Promise((resolve) => { resolveShutdown = resolve; });
    }
  });

  lifecycle.handleBeforeQuit(makeEvent());
  const second = makeEvent();
  lifecycle.handleBeforeQuit(second);

  assert.equal(shutdownCalls, 1);
  assert.equal(second.defaultPrevented, false, "the deferred quit must be allowed to proceed");

  resolveShutdown();
  await new Promise(setImmediate);
  assert.deepEqual(app.calls, ["quit"]);
});

test("a hung shutdown times out and force-exits instead of stranding the process", async () => {
  const { app, diagnostics, clock, lifecycle } = makeLifecycle();
  lifecycle.setServer({ shutdown: () => new Promise(() => {}) });

  lifecycle.handleBeforeQuit(makeEvent());
  clock.fireAll();
  await new Promise(setImmediate);

  assert.deepEqual(app.calls, ["exit:1"]);
  assert.ok(diagnostics.entries.some(([level]) => level === "error"));
});

test("a fatal error closes storage before exiting", async () => {
  const { app, diagnostics, lifecycle } = makeLifecycle();
  let closed = false;
  lifecycle.setServer({ shutdown: async () => { closed = true; } });

  await lifecycle.handleFatalError("Uncaught exception", new Error("boom"));

  assert.equal(closed, true);
  assert.deepEqual(app.calls, ["exit:1"]);
  assert.deepEqual(diagnostics.entries[0], ["error", "Uncaught exception"]);
});

test("a fatal error still exits when closing storage fails", async () => {
  const { app, lifecycle } = makeLifecycle();
  lifecycle.setServer({ shutdown: async () => { throw new Error("checkpoint failed"); } });

  await lifecycle.handleFatalError("Unhandled rejection", new Error("boom"));

  assert.deepEqual(app.calls, ["exit:1"]);
});

test("a fatal error before the API starts does not exit", async () => {
  const { app, lifecycle } = makeLifecycle();

  await lifecycle.handleFatalError("Uncaught exception", new Error("boom"));

  assert.deepEqual(app.calls, []);
});

test("preparing for an update closes the API and then runs the post-close work", async () => {
  const { lifecycle } = makeLifecycle();
  const order = [];
  lifecycle.setServer({ shutdown: async () => order.push("shutdown") });

  await lifecycle.prepareForUpdateInstall(async () => order.push("backup"));

  assert.deepEqual(order, ["shutdown", "backup"]);
  assert.equal(lifecycle.isUpdateInstallPending(), true);
  assert.equal(lifecycle.hasServer(), false);
});

test("a failed update shutdown leaves the app runnable and skips the post-close work", async () => {
  const { lifecycle } = makeLifecycle();
  let backupRan = false;
  lifecycle.setServer({ shutdown: async () => { throw new Error("still writing"); } });

  await assert.rejects(() => lifecycle.prepareForUpdateInstall(async () => { backupRan = true; }));

  assert.equal(backupRan, false);
  assert.equal(lifecycle.isUpdateInstallPending(), false);
  assert.equal(lifecycle.isQuitting(), false);
  assert.equal(lifecycle.hasServer(), true, "a retry must still be able to close the API");
});

test("before-quit yields to an in-progress update install", () => {
  const { lifecycle } = makeLifecycle();
  lifecycle.setServer({ shutdown: () => new Promise(() => {}) });
  void lifecycle.prepareForUpdateInstall();

  const event = makeEvent();
  lifecycle.handleBeforeQuit(event);

  assert.equal(event.defaultPrevented, false);
});

test("the single-instance lock is taken before the legacy user-data directory is migrated", () => {
  // Two copies launching together would otherwise both see the legacy directory and race their
  // renames, which can leave the store split across the old and new paths.
  const mainProcess = readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const lockRequest = mainProcess.indexOf("app.requestSingleInstanceLock()");
  const migration = mainProcess.indexOf("migrateUserDataDirectory(app.getPath(\"appData\"))");

  assert.ok(lockRequest >= 0 && migration >= 0);
  assert.ok(lockRequest < migration, "requestSingleInstanceLock() must run before the migration");
  assert.match(
    mainProcess.slice(lockRequest, migration),
    /if \(hasSingleInstanceLock\) \{/,
    "the migration must be guarded by the lock result"
  );
});
