const fileSystem = require("node:fs");
const path = require("node:path");

function hasData(directory, fs) {
  if (!fs.existsSync(directory)) return false;
  try {
    return fs.readdirSync(directory).length > 0;
  } catch {
    return true;
  }
}

function migrateUserDataDirectory(appDataPath, fs = fileSystem) {
  const legacyPath = path.join(appDataPath, "Local Fitness Advisor");
  const destinationPath = path.join(appDataPath, "Vitana Health");
  const legacyHasData = hasData(legacyPath, fs);
  const destinationHasData = hasData(destinationPath, fs);

  if (legacyHasData && destinationHasData) {
    throw new Error(
      `Both ${legacyPath} and ${destinationPath} contain data. Safeguard both folders, then remove or rename one before restarting.`
    );
  }
  if (!legacyHasData) return destinationPath;

  try {
    if (fs.existsSync(destinationPath)) fs.rmSync(destinationPath, { recursive: true });
    fs.renameSync(legacyPath, destinationPath);
  } catch (error) {
    throw new Error(
      `Vitana Health could not move the existing profile folder from ${legacyPath} to ${destinationPath}. ` +
      "No profile data was merged or overwritten. Safeguard both folders before retrying.",
      { cause: error }
    );
  }
  return destinationPath;
}

module.exports = { migrateUserDataDirectory };
