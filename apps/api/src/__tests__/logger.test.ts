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
});