const fs = require("node:fs");
const path = require("node:path");

const version = 1;
const defaults = Object.freeze({
  version,
  backgroundServiceEnabled: false,
  closeNotificationShown: false
});

function createBackgroundServiceSettingsStore({ userDataPath, fileSystem = fs }) {
  const filePath = path.join(userDataPath, "desktop-runtime-settings.json");

  function read() {
    try {
      const value = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
      if (
        value?.version !== version ||
        typeof value.backgroundServiceEnabled !== "boolean" ||
        typeof value.closeNotificationShown !== "boolean"
      ) {
        return { ...defaults };
      }
      return {
        version,
        backgroundServiceEnabled: value.backgroundServiceEnabled,
        closeNotificationShown: value.closeNotificationShown
      };
    } catch {
      return { ...defaults };
    }
  }

  function write(value) {
    const validated = {
      version,
      backgroundServiceEnabled: value.backgroundServiceEnabled === true,
      closeNotificationShown: value.closeNotificationShown === true
    };
    fileSystem.mkdirSync(userDataPath, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fileSystem.writeFileSync(temporaryPath, JSON.stringify(validated), { encoding: "utf8", mode: 0o600 });
      fileSystem.renameSync(temporaryPath, filePath);
    } catch (error) {
      try {
        fileSystem.rmSync(temporaryPath, { force: true });
      } catch {}
      throw error;
    }
    return validated;
  }

  return { read, write, filePath };
}

module.exports = { createBackgroundServiceSettingsStore };
