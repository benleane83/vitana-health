import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { RestoreDecision } from "@vitana/shared";
import { log } from "../logger.js";

export type JournalPhase = "staged" | "hydrating" | "committing" | "completed" | "rolled-back";

export interface JournalEntry {
  profileId: string;
  decision: RestoreDecision;
  newProfileId?: string;
  originalDatabaseFile?: string;
  newDatabaseFile?: string;
  stagedDatabaseFile?: string;
  rollbackDatabaseFile?: string;
  status: "pending" | "hydrated" | "committed" | "rolled-back";
}

interface JournalMetadataFile {
  path: string;
  backupPath: string;
  existed: boolean;
}

export interface RestoreJournalData {
  id: string;
  createdAt: string;
  phase: JournalPhase;
  entries: JournalEntry[];
  metadataFiles: JournalMetadataFile[];
}

export class RestoreJournal {
  private data: RestoreJournalData;
  private readonly journalPath: string;

  constructor(dataDir: string, id: string) {
    const journalDir = resolve(dataDir, "restore-journals");
    mkdirSync(journalDir, { recursive: true });
    this.journalPath = resolve(journalDir, `${id}.json`);
    this.data = {
      id,
      createdAt: new Date().toISOString(),
      phase: "staged",
      entries: [],
      metadataFiles: []
    };
  }

  /**
   * Compensates any restore that was interrupted before it committed. Runs on the startup path, so
   * it distinguishes two failures that look alike but are not:
   *
   * - A journal that cannot be read says nothing about whether a restore is outstanding — a
   *   half-written file is exactly what a power cut during `persist()` leaves behind. It is moved
   *   aside and skipped, because refusing to start makes the app unrecoverable for a user who
   *   cannot be talked through deleting a file in `%APPDATA%`.
   * - A journal that reads cleanly and whose rollback fails means a restore really is uncompensated
   *   and the databases on disk may be half-swapped. That still throws.
   */
  static recover(dataDir: string): number {
    const journalDir = resolve(dataDir, "restore-journals");
    if (!existsSync(journalDir)) return 0;
    let recovered = 0;
    for (const file of readdirSync(journalDir).filter((name) => name.endsWith(".json"))) {
      const path = resolve(journalDir, file);
      let raw: RestoreJournalData;
      try {
        raw = JSON.parse(readFileSync(path, "utf8")) as RestoreJournalData;
        if (typeof raw?.id !== "string" || !Array.isArray(raw?.entries)) {
          throw new Error("Journal is missing an id or entry list.");
        }
      } catch (error) {
        quarantineJournal(path, error);
        continue;
      }
      if (raw.phase === "completed" || raw.phase === "rolled-back") {
        rmSync(path, { force: true });
        continue;
      }
      const journal = new RestoreJournal(dataDir, raw.id);
      journal.data = { ...raw, metadataFiles: raw.metadataFiles ?? [] };
      if (!journal.rollback()) {
        throw new Error(`Restore journal ${raw.id} could not be compensated.`);
      }
      recovered += 1;
    }
    return recovered;
  }

  get entries(): readonly JournalEntry[] { return this.data.entries; }
  get id(): string { return this.data.id; }

  addEntry(entry: JournalEntry): void {
    this.data.entries.push(entry);
    this.persist();
  }

  snapshotMetadataFile(path: string): void {
    const backupPath = `${this.journalPath}.${this.data.metadataFiles.length}.metadata`;
    const existed = existsSync(path);
    if (existed) copyFileSync(path, backupPath);
    this.data.metadataFiles.push({ path, backupPath, existed });
    this.persist();
  }

  setPhase(phase: JournalPhase): void {
    this.data.phase = phase;
    this.persist();
  }

  updateEntryStatus(profileId: string, status: JournalEntry["status"]): void {
    const entry = this.data.entries.find((candidate) => candidate.profileId === profileId);
    if (entry) {
      entry.status = status;
      this.persist();
    }
  }

  complete(): void {
    this.data.phase = "completed";
    this.persist();
    for (const entry of this.data.entries) {
      if (entry.rollbackDatabaseFile) rmSync(entry.rollbackDatabaseFile, { force: true });
    }
    this.cleanup();
  }

  rollback(): boolean {
    try {
      for (const entry of [...this.data.entries].reverse()) {
        if (entry.stagedDatabaseFile) removeDatabaseArtifacts(entry.stagedDatabaseFile);
        if (entry.rollbackDatabaseFile && existsSync(entry.rollbackDatabaseFile)) {
          if (entry.newDatabaseFile) removeDatabaseArtifacts(entry.newDatabaseFile);
          renameSync(entry.rollbackDatabaseFile, entry.originalDatabaseFile!);
        } else if (entry.originalDatabaseFile && entry.status === "committed") {
          return false;
        } else if (!entry.originalDatabaseFile && entry.newDatabaseFile) {
          removeDatabaseArtifacts(entry.newDatabaseFile);
        }
        if (entry.originalDatabaseFile && !existsSync(entry.originalDatabaseFile)) return false;
        if (!entry.originalDatabaseFile && entry.newDatabaseFile && existsSync(entry.newDatabaseFile)) return false;
        entry.status = "rolled-back";
      }
      for (const metadata of this.data.metadataFiles) {
        if (metadata.existed) copyFileSync(metadata.backupPath, metadata.path);
        else rmSync(metadata.path, { force: true });
      }
      this.data.phase = "rolled-back";
      this.persist();
      this.cleanup();
      return true;
    } catch (error) {
      // The caller only learns that compensation failed. Without this the reason — a disk that
      // filled, a file another process still holds — never reaches anyone who could act on it.
      log.error(
        `Restore journal ${this.data.id} rollback failed: ${error instanceof Error ? error.message : String(error)}`,
        { code: "restore-rollback-failed" }
      );
      return false;
    }
  }

  private cleanup(): void {
    for (const metadata of this.data.metadataFiles) rmSync(metadata.backupPath, { force: true });
    rmSync(this.journalPath, { force: true });
  }

  private persist(): void {
    const temporaryPath = `${this.journalPath}.tmp`;
    mkdirSync(dirname(this.journalPath), { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.journalPath);
  }
}

/**
 * Moves a journal we cannot parse out of the recovery directory so the next startup does not trip
 * over it again, while keeping the bytes around for a bug report.
 */
function quarantineJournal(path: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const quarantinePath = `${path}.corrupt`;
  try {
    rmSync(quarantinePath, { force: true });
    renameSync(path, quarantinePath);
  } catch {
    rmSync(path, { force: true });
  }
  log.warn(`Skipped an unreadable restore journal (${detail}). Moved it to ${quarantinePath}.`, {
    code: "restore-journal-unreadable"
  });
}

function removeDatabaseArtifacts(databasePath: string): void {
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}.wal`, { force: true });
  const parent = dirname(databasePath);
  const hydrationPrefix = `${databasePath}.hydrating-`;
  if (!existsSync(parent)) return;
  for (const name of readdirSync(parent)) {
    const candidate = resolve(parent, name);
    if (candidate.startsWith(hydrationPrefix)) rmSync(candidate, { force: true });
  }
}
