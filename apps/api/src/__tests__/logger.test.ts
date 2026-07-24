import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { log } from "../logger.js";

describe("logger", () => {
  it("preserves an I/O error while redacting explicit credential values", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      log.error("IO Error: cannot open file; encryption key: top-secret-value");
      const record = JSON.parse(String(write.mock.calls[0]?.[0])) as { msg: string };
      expect(record.msg).toBe("IO Error: cannot open file; encryption key=[redacted]");
    } finally {
      write.mockRestore();
    }
  });

  it("persists redacted records when a log file is configured", () => {
    const previousLogFile = process.env.VITANA_LOG_FILE;
    const logFile = join(tmpdir(), `vitana-api-${crypto.randomUUID()}.ndjson`);
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.VITANA_LOG_FILE = logFile;
    try {
      log.error("Database failed; encryption key: top-secret-value");
      const record = JSON.parse(readFileSync(logFile, "utf8")) as { msg: string };
      expect(record.msg).toBe("Database failed; encryption key=[redacted]");
    } finally {
      write.mockRestore();
      if (previousLogFile === undefined) delete process.env.VITANA_LOG_FILE;
      else process.env.VITANA_LOG_FILE = previousLogFile;
    }
  });
});