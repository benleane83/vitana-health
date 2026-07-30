import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

  it("rotates the log file once it passes the size cap", () => {
    const previousLogFile = process.env.VITANA_LOG_FILE;
    const logFile = join(tmpdir(), `vitana-api-${crypto.randomUUID()}.ndjson`);
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.VITANA_LOG_FILE = logFile;
    try {
      writeFileSync(logFile, Buffer.alloc(8 * 1024 * 1024, 0x20));
      log.info("First record after the cap");

      expect(statSync(`${logFile}.1`).size).toBe(8 * 1024 * 1024);
      const rotated = readFileSync(logFile, "utf8").trim().split("\n");
      expect(rotated).toHaveLength(1);
      expect((JSON.parse(rotated[0]) as { msg: string }).msg).toBe("First record after the cap");
    } finally {
      write.mockRestore();
      rmSync(logFile, { force: true });
      rmSync(`${logFile}.1`, { force: true });
      if (previousLogFile === undefined) delete process.env.VITANA_LOG_FILE;
      else process.env.VITANA_LOG_FILE = previousLogFile;
    }
  });
});