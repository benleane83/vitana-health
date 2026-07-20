const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createBackgroundServiceController, loginItemOptions } = require("./background-service.cjs");

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
    executablePath: "C:\\Local Fitness Advisor.exe",
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
  assert.deepEqual(loginItemOptions(false, "app.exe"), { openAtLogin: false, path: "app.exe", args: [] });
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
