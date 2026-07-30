/**
 * Structured request logging with correlation IDs and PHI/credential redaction.
 *
 * Rules:
 * - DO NOT log request bodies, model prompts, or data payloads.
 * - DO NOT log profile display names. They are the names of the household's people and pets, and
 *   the log file sits unencrypted beside the encrypted databases those names live in. Identify a
 *   profile by its opaque id instead.
 * - Redact any field names matching credential/auth patterns before logging.
 * - Output goes to stderr and, when configured, a newline-delimited JSON log file.
 */

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const SENSITIVE_VALUE = /\b(password|token|secret|key|auth|credential|pin)\b\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_VALUE = /\bbearer\s+[^\s,;]+/gi;

/**
 * The desktop app logs one line per request and runs for weeks at a time in the background, so an
 * unrotated file grows without limit on a tester's machine. One previous generation is kept, which
 * caps the logs at twice this size while still covering enough history to explain a crash.
 */
const maxLogFileBytes = 8 * 1024 * 1024;

/** Byte count for the file currently being appended to, so rotation costs no `stat` per line. */
let trackedLogFile: string | undefined;
let trackedLogBytes = 0;

function appendWithRotation(logFile: string, line: string): void {
  mkdirSync(path.dirname(logFile), { recursive: true });
  if (trackedLogFile !== logFile) {
    trackedLogFile = logFile;
    try {
      trackedLogBytes = statSync(logFile).size;
    } catch {
      trackedLogBytes = 0;
    }
  }
  const bytes = Buffer.byteLength(line, "utf8");
  if (trackedLogBytes > 0 && trackedLogBytes + bytes > maxLogFileBytes) {
    // `renameSync` will not overwrite an existing destination on Windows.
    rmSync(`${logFile}.1`, { force: true });
    renameSync(logFile, `${logFile}.1`);
    trackedLogBytes = 0;
  }
  appendFileSync(logFile, line, "utf8");
  trackedLogBytes += bytes;
}

export interface LogRecord {
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
  correlationId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  code?: string;
  storageBackend?: "duckdb";
  profileCount?: number;
  activeProfileId?: string;
  activationState?: "initialization" | "reopen" | "not-applicable";
}

function write(record: LogRecord): void {
  const line = JSON.stringify(record) + "\n";
  process.stderr.write(line);
  const logFile = process.env.VITANA_LOG_FILE;
  if (!logFile) return;
  try {
    appendWithRotation(logFile, line);
  } catch {
    // Diagnostics must not affect API availability.
  }
}

function redactMessage(msg: string): string {
  return msg
    .replace(SENSITIVE_VALUE, (_match, field: string) => `${field}=[redacted]`)
    .replace(BEARER_VALUE, "Bearer [redacted]");
}

export const log = {
  info(msg: string, extra?: Partial<LogRecord>): void {
    write({ ts: new Date().toISOString(), level: "info", msg, ...extra });
  },
  warn(msg: string, extra?: Partial<LogRecord>): void {
    write({ ts: new Date().toISOString(), level: "warn", msg, ...extra });
  },
  error(msg: string, extra?: Partial<LogRecord>): void {
    write({ ts: new Date().toISOString(), level: "error", msg: redactMessage(msg), ...extra });
  },
  request(record: Omit<LogRecord, "ts" | "level" | "msg">): void {
    write({
      ts: new Date().toISOString(),
      level: "info",
      msg: `${record.method ?? "?"} ${record.path ?? "?"} ${record.status ?? 0} ${record.durationMs ?? 0}ms`,
      ...record,
    });
  },
};

export function generateCorrelationId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}
