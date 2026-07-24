/**
 * Structured request logging with correlation IDs and PHI/credential redaction.
 *
 * Rules:
 * - DO NOT log request bodies, model prompts, or data payloads.
 * - Redact any field names matching credential/auth patterns before logging.
 * - Output goes to stderr and, when configured, a newline-delimited JSON log file.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const SENSITIVE_VALUE = /\b(password|token|secret|key|auth|credential|pin)\b\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_VALUE = /\bbearer\s+[^\s,;]+/gi;

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
  activeProfileDisplayName?: string;
  activationState?: "initialization" | "reopen" | "not-applicable";
}

function write(record: LogRecord): void {
  const line = JSON.stringify(record) + "\n";
  process.stderr.write(line);
  const logFile = process.env.VITANA_LOG_FILE;
  if (!logFile) return;
  try {
    mkdirSync(path.dirname(logFile), { recursive: true });
    appendFileSync(logFile, line, "utf8");
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
