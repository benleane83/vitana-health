"use strict";

/**
 * Copies the encrypted DuckDB profile files aside immediately before an update installs.
 *
 * An update can bring a schema migration, and a migration that goes wrong on a user's machine is
 * the one failure mode with no undo — the data is local and there is no server copy. This runs
 * after the embedded API has shut down, so the files are checkpointed and closed.
 */

const nodeFs = require("node:fs");
const path = require("node:path");

const DATABASE_SUBPATH = path.join("duckdb-storage", "databases");
const BACKUP_DIRECTORY = "pre-update-backups";
const DEFAULT_KEEP = 3;

function sanitizeVersion(value) {
  const normalized = String(value ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

function timestamp(now) {
  return (now ?? new Date()).toISOString().replace(/[:.]/g, "-");
}

/**
 * @returns the backup directory that was written, or undefined when there was nothing to back up.
 */
function createPreUpdateBackup(options = {}) {
  const {
    userDataPath,
    fromVersion,
    toVersion,
    keep = DEFAULT_KEEP,
    fs = nodeFs,
    now
  } = options;
  if (!userDataPath) return undefined;

  const sourceDirectory = path.join(userDataPath, DATABASE_SUBPATH);
  if (!fs.existsSync(sourceDirectory)) return undefined;

  const files = fs
    .readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".duckdb") || name.endsWith(".duckdb.wal"));
  if (files.length === 0) return undefined;

  const backupRoot = path.join(userDataPath, BACKUP_DIRECTORY);
  const destination = path.join(
    backupRoot,
    `${sanitizeVersion(fromVersion)}-to-${sanitizeVersion(toVersion)}-${timestamp(now)}`
  );
  fs.mkdirSync(destination, { recursive: true });
  for (const name of files) {
    fs.copyFileSync(path.join(sourceDirectory, name), path.join(destination, name));
  }

  prunePreUpdateBackups({ userDataPath, keep, fs });
  return destination;
}

/** Keeps the newest `keep` backup directories so repeated updates cannot fill the disk. */
function prunePreUpdateBackups(options = {}) {
  const { userDataPath, keep = DEFAULT_KEEP, fs = nodeFs } = options;
  const backupRoot = path.join(userDataPath, BACKUP_DIRECTORY);
  if (!fs.existsSync(backupRoot)) return [];

  const directories = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // Names end with an ISO timestamp, so lexical order is chronological order.
    .sort();
  const removed = directories.slice(0, Math.max(0, directories.length - Math.max(1, keep)));
  for (const name of removed) {
    fs.rmSync(path.join(backupRoot, name), { recursive: true, force: true });
  }
  return removed;
}

module.exports = { createPreUpdateBackup, prunePreUpdateBackups };
