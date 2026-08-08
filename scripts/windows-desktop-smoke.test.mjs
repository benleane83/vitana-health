import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Windows smoke validates the persisted DuckDB backend manifest field", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /\$storage\.backend -ne "duckdb"/);
  assert.doesNotMatch(script, /\$storage\.storageBackend/);
});

test("Windows smoke derives the NSIS executable name from desktop package metadata", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /apps\/desktop\/package\.json/);
  assert.match(script, /\$applicationName = "\$\(\$desktopPackage\.build\.executableName\)\.exe"/);
  assert.doesNotMatch(script, /\$applicationName = "\$productName\.exe"/);
});

test("Windows smoke does not require elevated firewall configuration from the per-user NSIS installer", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  assert.doesNotMatch(script, /Get-NetFirewallRule/);
  assert.doesNotMatch(script, /Get-NetFirewallApplicationFilter/);
  assert.doesNotMatch(script, /firewallRuleRemoved/);
});

test("Windows smoke uses the installed owner credential instead of renderer-only nonce authentication", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /Join-Path \$manifest\.DirectoryName "security\.json"/);
  assert.match(script, /\.ownerToken/);
  assert.match(script, /Authorization = "Bearer \$OwnerToken"/);
  assert.doesNotMatch(script, /\/api\/auth\/local/);
});

test("Windows smoke proves the native DuckDB binding loaded in both scopes", () => {
  const script = readFileSync(new URL("./windows-desktop-smoke.ps1", import.meta.url), "utf8");

  // The database-file assertion has to sit above the Fast early-return, otherwise a Fast run
  // reports success on an Electron build whose native binding never loaded.
  const databaseAssertion = script.indexOf("did not create an encrypted DuckDB database");
  const fastReturn = script.lastIndexOf('if ($Scope -eq "Fast")');
  assert.ok(databaseAssertion > 0 && fastReturn > 0);
  assert.ok(databaseAssertion < fastReturn);
  assert.match(script, /nativeBindingLoaded = \$true/);
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

test("Windows releases are gated on tests, use full smoke coverage, and stage a draft", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-windows.yml", import.meta.url), "utf8");

  // A release must never be cut from a red tree.
  assert.match(workflow, /run: npm run validate:fast/);
  assert.match(workflow, /npm run test:integration/);
  assert.match(workflow, /npm run test:durability/);
  assert.match(workflow, /npm run prepare:duckdb -w @vitana\/api/);

  // Full scope exercises the upgrade-over-existing-data path.
  assert.match(workflow, /-Scope Full/);
  assert.doesNotMatch(workflow, /-Scope Fast/);
  assert.match(workflow, /-HealthTimeoutSeconds 60/);
  assert.match(workflow, /- name: Upload preview update assets and evidence\s+if: always\(\)/);

  // Publishing is a deliberate manual step, and a live release is never clobbered.
  assert.match(workflow, /gh release create \$env:GITHUB_REF_NAME \$files --draft/);
  assert.match(workflow, /if \(-not \$release\.isDraft\)/);
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
  const desktopSmokeWorkflow = readFileSync(new URL("../.github/workflows/desktop-smoke.yml", import.meta.url), "utf8");

  assert.doesNotMatch(releaseWorkflow, /windows-store-smoke/);
  assert.doesNotMatch(ciWorkflow, /desktop_package_format|npm run package:store|\.\/scripts\/windows-store-smoke\.ps1/);
  assert.match(desktopSmokeWorkflow, /desktop_package_format/);
  assert.match(desktopSmokeWorkflow, /npm run package:store/);
  assert.match(desktopSmokeWorkflow, /\.\/scripts\/windows-store-smoke\.ps1/);
});