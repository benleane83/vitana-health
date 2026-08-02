const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { createDesktopUpdaterController } = require("./desktop-updater.cjs");

function fixture({ packaged = true, channel = "production", distributionChannel = "github" } = {}) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  updater.downloadUpdate = async () => {};
  updater.quitAndInstall = () => {};
  const scheduled = [];
  const diagnostics = { info() {}, error() {} };
  const prepareToInstall = async () => {};
  const controller = createDesktopUpdaterController({
    app: { isPackaged: packaged, getVersion: () => "1.2.3" },
    updater,
    diagnostics,
    channel,
    distributionChannel,
    prepareToInstall,
    schedule: (callback) => { scheduled.push(callback); }
  });
  return { controller, updater, scheduled };
}

test("development mode is unsupported and performs no update request", async () => {
  const { controller, updater, scheduled } = fixture({ packaged: false });
  let checks = 0;
  updater.checkForUpdates = async () => { checks++; };
  assert.deepEqual(controller.getState(), {
    status: "unsupported",
    currentVersion: "1.2.3",
    channel: null,
    distributionChannel: "github"
  });

  assert.equal(scheduled.length, 0);
  controller.start();
  assert.equal(scheduled.length, 0);
  await controller.check();
  assert.equal(checks, 0);
});

test("Store packages expose managed updates without initializing the GitHub updater", async () => {
  const { controller, updater, scheduled } = fixture({ distributionChannel: "store" });
  let calls = 0;
  updater.checkForUpdates = async () => { calls++; };
  updater.downloadUpdate = async () => { calls++; };
  updater.quitAndInstall = () => { calls++; };

  assert.deepEqual(controller.getState(), {
    status: "managed",
    currentVersion: "1.2.3",
    channel: null,
    distributionChannel: "store"
  });

  assert.equal(updater.eventNames().length, 0);
  controller.start();
  await controller.check();
  await controller.download();
  await controller.restartToInstall();
  assert.equal(scheduled.length, 0);
  assert.equal(calls, 0);
});

test("Linux AppImages expose manual updates without initializing the GitHub updater", async () => {
  const { controller, updater, scheduled } = fixture({ distributionChannel: "linux-appimage" });
  let calls = 0;
  updater.checkForUpdates = async () => { calls++; };

  assert.deepEqual(controller.getState(), {
    status: "unsupported",
    currentVersion: "1.2.3",
    channel: null,
    distributionChannel: "linux-appimage"
  });
  assert.equal(updater.eventNames().length, 0);
  controller.start();
  await controller.check();
  assert.equal(scheduled.length, 0);
  assert.equal(calls, 0);
});

test("tracks checks, availability, progress, and download completion", async () => {
  const { controller, updater } = fixture();
  let checks = 0;
  updater.checkForUpdates = async () => { checks++; };
  const first = controller.check();
  const second = controller.check();
  await Promise.all([first, second]);
  assert.equal(checks, 1);
  updater.emit("update-available", { version: "1.2.4" });
  assert.equal(controller.getState().status, "available");
  updater.emit("download-progress", { percent: 42.5, transferred: 425, total: 1000 });
  assert.deepEqual(controller.getState().progress, { percent: 42.5, transferred: 425, total: 1000 });
  updater.emit("update-downloaded", { version: "1.2.4" });
  assert.equal(controller.getState().status, "downloaded");
});

test("uses safe errors and installs only after graceful shutdown", async () => {
  const order = [];
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { throw new Error("https://private-feed/path unavailable"); };
  updater.downloadUpdate = async () => {};
  updater.quitAndInstall = () => order.push("install");
  const scheduled = [];
  const logged = [];
  const controller = createDesktopUpdaterController({
    app: { isPackaged: true, getVersion: () => "1.0.0" },
    updater,
    channel: "production",
    diagnostics: { info() {}, error(_message, error) { logged.push(error.message); } },
    prepareToInstall: async () => order.push("shutdown"),
    schedule: (callback) => scheduled.push(callback),
    distributionChannel: "github"
  });
  await controller.check();
  assert.equal(controller.getState().error.includes("private-feed"), false);
  assert.equal(logged.some((message) => message.includes("private-feed")), false);
  updater.emit("update-downloaded", { version: "1.1.0" });
  await controller.restartToInstall();
  await scheduled.pop()();
  assert.deepEqual(order, ["shutdown", "install"]);
});

test("allows retrying installation after graceful shutdown fails", async () => {
  const { updater, scheduled } = fixture();
  let installAttempts = 0;
  updater.quitAndInstall = () => { installAttempts++; };

  let prepareAttempts = 0;
  const prepareToInstall = async () => {
    prepareAttempts++;
    if (prepareAttempts === 1) throw new Error("shutdown failed");
  };
  const retryController = createDesktopUpdaterController({
    app: { isPackaged: true, getVersion: () => "1.2.3" },
    updater,
    diagnostics: { info() {}, error() {} },
    channel: "production",
    distributionChannel: "github",
    prepareToInstall,
    schedule: (callback) => scheduled.push(callback)
  });
  updater.emit("update-downloaded", { version: "1.2.4" });

  await retryController.restartToInstall();
  await scheduled.pop()();
  assert.equal(retryController.getState().status, "downloaded");
  assert.match(retryController.getState().error, /Try again/);

  await retryController.restartToInstall();
  await scheduled.pop()();
  assert.equal(prepareAttempts, 2);
  assert.equal(installAttempts, 1);
});
