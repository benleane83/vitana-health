import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Windows smoke validates the persisted DuckDB backend manifest field", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /\$storage\.backend -ne "duckdb"/);
  assert.doesNotMatch(script, /\$storage\.storageBackend/);
});

test("Windows smoke refreshes the singleton process before closing recreated windows", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /function Close-DesktopMainWindow/);
  assert.match(script, /\$Process\.Refresh\(\)/);
  assert.match(script, /\$Process\.MainWindowHandle -ne 0 -and \$Process\.CloseMainWindow\(\)/);
  assert.equal(script.match(/Close-DesktopMainWindow \$firstLaunch/g)?.length, 3);
});