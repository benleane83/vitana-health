const { appendFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

function createStartupDiagnostics(options) {
  const { userDataPath, now = () => new Date() } = options;
  const logPath = path.join(userDataPath, "logs", "startup.log");

  function write(level, message, error) {
    const detail = error ? ` ${formatError(error)}` : "";
    const line = `${now().toISOString()} ${level} ${message}${detail}\n`;
    try {
      mkdirSync(path.dirname(logPath), { recursive: true });
      appendFileSync(logPath, line, "utf8");
    } catch {
      // Diagnostics must never prevent the application from launching.
    }
  }

  return {
    info(message) {
      write("INFO", message);
    },
    error(message, error) {
      write("ERROR", message, error);
    },
    logPath
  };
}

function formatError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  return String(error);
}

module.exports = { createStartupDiagnostics };