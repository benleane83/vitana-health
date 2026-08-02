const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createBackgroundServiceController, legacyExecutablePath, loginItemOptions } = require("./background-service.cjs");

function fixture(initial = { version: 1, backgroundServiceEnabled: false, closeNotificationShown: false }) {
  let state = { ...initial };
  const loginCalls = [];
  const trays = [];
  let notifications = 0;
  const settingsStore = {
    read: () => ({ ...state }),
    write: (next) => (state = { ...next })
  };
  const controller = createBackgroundServiceController({
    app: { setLoginItemSettings: (options) => loginCalls.push(options) },
    settingsStore,
    executablePath: "C:\\Vitana Health.exe",
    createTray: (handlers) => {
      const tray = { handlers, destroyed: false, destroy() { this.destroyed = true; } };
      trays.push(tray);
      return tray;
    },
    showNotification: () => notifications++,
    onOpen() {},
    onQuit() {}
  });
  return { controller, settingsStore, loginCalls, trays, state: () => state, notifications: () => notifications };
}

test("login registration uses the explicit background argument", () => {
  assert.deepEqual(loginItemOptions(true, "app.exe"), { openAtLogin: true, path: "app.exe", args: ["--background"] });
  assert.deepEqual(loginItemOptions(false, "app.exe"), { openAtLogin: false, path: "app.exe", args: ["--background"] });
});

test("legacy login registration resolves beside the current executable", () => {
  assert.equal(
    legacyExecutablePath("C:\\Program Files\\Vitana Health\\Vitana Health.exe"),
    "C:\\Program Files\\Vitana Health\\Local Fitness Advisor.exe"
  );
});

test("unsupported desktop sessions report disabled and reject enablement", () => {
  const value = fixture();
  const controller = createBackgroundServiceController({
    app: {},
    settingsStore: value.settingsStore,
    startupRegistration: { setEnabled() {} },
    supported: false,
    platform: "linux",
    createTray: () => ({ destroy() {} }),
    showNotification() {},
    onOpen() {},
    onQuit() {}
  });
  assert.deepEqual(controller.getSettings(), { supported: false, backgroundServiceEnabled: false });
  assert.throws(() => controller.updateSettings({ backgroundServiceEnabled: true }), /unavailable/);
});

test("Linux uses the injected startup adapter without Windows legacy cleanup", () => {
  const enabled = [];
  const value = fixture({ version: 1, backgroundServiceEnabled: true, closeNotificationShown: false });
  const controller = createBackgroundServiceController({
    app: { setLoginItemSettings() { throw new Error("Windows API must not be called"); } },
    settingsStore: value.settingsStore,
    startupRegistration: { setEnabled: (next) => enabled.push(next) },
    platform: "linux",
    createTray: () => ({ destroy() {} }),
    showNotification() {},
    onOpen() {},
    onQuit() {}
  });
  controller.reconcileStartup();
  assert.deepEqual(enabled, [true]);
});

test("a failed tray probe disables background support and removes startup registration", () => {
  const enabled = [];
  const value = fixture({ version: 1, backgroundServiceEnabled: true, closeNotificationShown: false });
  const controller = createBackgroundServiceController({
    app: {},
    settingsStore: value.settingsStore,
    startupRegistration: { setEnabled: (next) => enabled.push(next) },
    platform: "linux",
    createTray: () => { throw new Error("tray unavailable"); },
    showNotification() {},
    onOpen() {},
    onQuit() {}
  });
  assert.deepEqual(controller.reconcileStartup(), { supported: false, backgroundServiceEnabled: false });
  assert.deepEqual(enabled, [true, false]);
});

test("enable and disable transitions update registration and tray immediately", () => {
  const value = fixture();
  assert.equal(value.controller.updateSettings({ backgroundServiceEnabled: true }).backgroundServiceEnabled, true);
  assert.deepEqual(value.loginCalls.at(-1).args, ["--background"]);
  assert.equal(value.trays.length, 1);
  value.controller.updateSettings({ backgroundServiceEnabled: false });
  assert.equal(value.loginCalls.at(-1).openAtLogin, false);
  assert.equal(value.trays[0].destroyed, true);
});

test("failed registration rolls persistence and registration back", () => {
  let state = { version: 1, backgroundServiceEnabled: false, closeNotificationShown: false };
  const calls = [];
  const controller = createBackgroundServiceController({
    app: { setLoginItemSettings(options) { calls.push(options); if (options.openAtLogin) throw new Error("denied"); } },
    settingsStore: { read: () => ({ ...state }), write: (next) => (state = { ...next }) },
    createTray: () => ({ destroy() {} }),
    showNotification() {},
    executablePath: "app.exe",
    onOpen() {},
    onQuit() {}
  });
  assert.throws(() => controller.updateSettings({ backgroundServiceEnabled: true }), /denied/);
  assert.equal(state.backgroundServiceEnabled, false);
  assert.equal(calls.at(-1).openAtLogin, false);
});

test("first enabled close keeps the service alive and notifies once", () => {
  const value = fixture({ version: 1, backgroundServiceEnabled: true, closeNotificationShown: false });
  assert.equal(value.controller.handleLastWindowClosed(), true);
  assert.equal(value.controller.handleLastWindowClosed(), true);
  assert.equal(value.notifications(), 1);
  assert.equal(value.state().closeNotificationShown, true);
  assert.equal(value.trays.length, 1);
});

test("disabled close exits and explicit tray handlers are preserved", () => {
  const value = fixture();
  assert.equal(value.controller.handleLastWindowClosed(), false);
  value.controller.updateSettings({ backgroundServiceEnabled: true });
  assert.equal(typeof value.trays[0].handlers.onOpen, "function");
  assert.equal(typeof value.trays[0].handlers.onQuit, "function");
});
