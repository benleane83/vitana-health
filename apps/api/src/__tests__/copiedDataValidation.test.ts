import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withCopiedDataValidation } from "../poc/copiedDataValidation.js";

let tempRoot: string;
let sourceDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "lfa-copied-data-test-"));
  sourceDir = tempRoot;
  writeFileSync(join(sourceDir, "placeholder"), "generated fixture");
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("copied-data validation", () => {
  it("isolates copy mutations and writes a source manifest", async () => {
    const workRoot = `${tempRoot}-work`;
    await withCopiedDataValidation({ sourceDir, workRoot }, async ({ inputCopyDir, manifestPath, sourceManifest }) => {
      expect(sourceManifest.files).toHaveLength(1);
      expect(readFileSync(manifestPath, "utf8")).toContain("placeholder");
      writeFileSync(join(inputCopyDir, "placeholder"), "changed copy");
    });
    expect(readFileSync(join(sourceDir, "placeholder"), "utf8")).toBe("generated fixture");
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("fails when validation changes a source file", async () => {
    const workRoot = `${tempRoot}-work`;
    await expect(withCopiedDataValidation({ sourceDir, workRoot }, async () => {
      writeFileSync(join(sourceDir, "placeholder"), "changed source");
    })).rejects.toThrow("Source after copied-data validation no longer matches");
    rmSync(workRoot, { recursive: true, force: true });
  });
});