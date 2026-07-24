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

test("Windows smoke health waits use a wall-clock deadline and bounded requests", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /\$healthRequestTimeoutSeconds = 2/);
  assert.match(script, /-TimeoutSec \$healthRequestTimeoutSeconds/);
  assert.match(script, /\$deadline = \[DateTime\]::UtcNow\.AddSeconds\(\$effectiveHealthTimeoutSeconds\)/);
  assert.match(script, /Wait-ForHealth "initial startup"/);
  assert.match(script, /Wait-ForHealth "restart"/);
  assert.doesNotMatch(script, /for \(\$elapsedSeconds = 0; \$elapsedSeconds -lt \$effectiveHealthTimeoutSeconds/);
});

test("Windows releases use fast smoke coverage and retain failure evidence", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-windows.yml", import.meta.url), "utf8");

  assert.match(workflow, /-Scope Fast/);
  assert.match(workflow, /-HealthTimeoutSeconds 60/);
  assert.match(workflow, /- name: Upload preview update assets and evidence\s+if: always\(\)/);
});

test("Store smoke uses AppX package lifecycle and captures package diagnostics", () => {
  const script = readFileSync(new URL("./windows-store-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /Add-AppxPackage -Path \$resolvedPackage/);
  assert.match(script, /Remove-AppxPackage -Package \$installedPackage\.PackageFullName/);
  assert.match(script, /shell:AppsFolder\\\$?\(\$installedPackage\.PackageFamilyName\)!\$ApplicationId/);
  assert.match(script, /Packages\\\$?\(\$installedPackage\.PackageFamilyName\)/);
  assert.match(script, /Get-NetFirewallRule -DisplayName "\*Vitana\*"/);
  assert.match(script, /Get-CimInstance Win32_StartupCommand/);
  assert.match(script, /InstallLocation "app\\resources\\duckdb-extensions"/);
  assert.match(script, /store-smoke-test\.json/);
});

test("Store smoke remains separate from the NSIS release path", () => {
  const releaseWorkflow = readFileSync(new URL("../.github/workflows/release-windows.yml", import.meta.url), "utf8");
  const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

  assert.doesNotMatch(releaseWorkflow, /windows-store-smoke/);
  assert.match(ciWorkflow, /desktop_package_format/);
  assert.match(ciWorkflow, /npm run package:store/);
  assert.match(ciWorkflow, /\.\/scripts\/windows-store-smoke\.ps1/);
});