/**
 * Restore journal for crash-safe atomic profile restore operations.
 *
 * The journal records the intent and progress of a restore operation so that
 * if the process crashes mid-restore, recovery can either complete or roll back.
 */
import {
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

export type JournalPhase =
  | "staged"       // Backup decrypted and validated, decisions recorded
  | "hydrating"    // Writing new profile databases
  | "committing"   // Updating registry/manifest atomically
  | "completed"    // Restore finished successfully
  | "rolled-back"; // Restore failed and was rolled back

export interface JournalEntry {
  profileId: string;
  decision: RestoreDecision;
  newProfileId?: string;
  originalDatabaseFile?: string;
  newDatabaseFile?: string;
  status: "pending" | "hydrated" | "committed" | "rolled-back";
}

export interface RestoreJournalData {
  id: string;
  createdAt: string;
  phase: JournalPhase;
  entries: JournalEntry[];
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
      entries: []
    };
  }

  static recover(dataDir: string): RestoreJournal | null {
    const journalDir = resolve(dataDir, "restore-journals");
    if (!existsSync(journalDir)) return null;
    // Find incomplete journals
    const files = readdirSync(journalDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const path = resolve(journalDir, file);
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as RestoreJournalData;
        if (raw.phase !== "completed" && raw.phase !== "rolled-back") {
          const journal = new RestoreJournal(dataDir, raw.id);
          journal.data = raw;
          return journal;
        }
        // Clean up completed journals
        rmSync(path, { force: true });
      } catch {
        rmSync(path, { force: true });
      }
    }
    return null;
  }

  get phase(): JournalPhase {
    return this.data.phase;
  }

  get entries(): readonly JournalEntry[] {
    return this.data.entries;
  }

  get id(): string {
    return this.data.id;
  }

  addEntry(entry: JournalEntry): void {
    this.data.entries.push(entry);
    this.persist();
  }

  setPhase(phase: JournalPhase): void {
    this.data.phase = phase;
    this.persist();
  }

  updateEntryStatus(profileId: string, status: JournalEntry["status"]): void {
    const entry = this.data.entries.find(e => e.profileId === profileId);
    if (entry) {
      entry.status = status;
      this.persist();
    }
  }

  complete(): void {
    this.data.phase = "completed";
    this.persist();
    // Clean up completed journal
    rmSync(this.journalPath, { force: true });
  }

  rollback(): void {
    this.data.phase = "rolled-back";
    this.persist();
    rmSync(this.journalPath, { force: true });
  }

  private persist(): void {
    const tmpPath = `${this.journalPath}.tmp`;
    mkdirSync(dirname(this.journalPath), { recursive: true });
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, this.journalPath);
  }
}
