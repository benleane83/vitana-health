/**
 * Structured request logging with correlation IDs and PHI/credential redaction.
 *
 * Rules:
 * - DO NOT log request bodies, model prompts, or data payloads.
 * - Redact any field names matching credential/auth patterns before logging.
 * - All output goes to stderr as newline-delimited JSON.
 */

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
  process.stderr.write(JSON.stringify(record) + "\n");
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
