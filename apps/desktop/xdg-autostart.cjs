const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const desktopFileName = "vitana-health.desktop";

function quoteDesktopExecArgument(value) {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) {
    throw new Error("The packaged executable path is invalid for XDG autostart.");
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("`", "\\`").replaceAll("$", "\\$")}"`;
}

function createXdgAutostartRegistration({
  executablePath,
  environment = process.env,
  homeDirectory = os.homedir(),
  fileSystem = fs
}) {
  const configDirectory = environment.XDG_CONFIG_HOME || path.join(homeDirectory, ".config");
  const autostartDirectory = path.join(configDirectory, "autostart");
  const filePath = path.join(autostartDirectory, desktopFileName);
  const contents = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Vitana Health",
    "Comment=Keep Vitana Health available for local companion sync",
    `Exec=${quoteDesktopExecArgument(executablePath)} --background`,
    "Terminal=false",
    "NoDisplay=true",
    "X-GNOME-Autostart-enabled=true",
    ""
  ].join("\n");

  function setEnabled(enabled) {
    if (!enabled) {
      fileSystem.rmSync(filePath, { force: true });
      return;
    }
    fileSystem.mkdirSync(autostartDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fileSystem.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fileSystem.renameSync(temporaryPath, filePath);
    } finally {
      fileSystem.rmSync(temporaryPath, { force: true });
    }
  }

  function isEnabled() {
    try {
      return fileSystem.readFileSync(filePath, "utf8") === contents;
    } catch {
      return false;
    }
  }

  return { setEnabled, isEnabled, filePath };
}

module.exports = { createXdgAutostartRegistration, quoteDesktopExecArgument };
