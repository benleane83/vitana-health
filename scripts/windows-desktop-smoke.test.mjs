import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Windows smoke validates the persisted DuckDB backend manifest field", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /\$storage\.backend -ne "duckdb"/);
  assert.doesNotMatch(script, /\$storage\.storageBackend/);
});