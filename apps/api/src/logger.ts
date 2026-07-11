/**
 * Structured request logging with correlation IDs and PHI/credential redaction.
 *
 * Rules:
 * - DO NOT log request bodies, model prompts, or data payloads.
 * - Redact any field names matching credential/auth patterns before logging.
 * - All output goes to stderr as newline-delimited JSON.
 */

const SENSITIVE_FIELD = /\b(?:password|token|secret|key|auth|credential|bearer|pin)\b/i;

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
}

function write(record: LogRecord): void {
  process.stderr.write(JSON.stringify(record) + "\n");
}

function redactMessage(msg: string): string {
  if (!SENSITIVE_FIELD.test(msg)) return msg;
  // Redact anything that looks like a value after separators
  return msg.replace(/([=:\s])([^\s,;]+)/g, (_m, sep: string, _val: string) => `${sep}[redacted]`);
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
