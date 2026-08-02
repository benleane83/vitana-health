import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("Linux workflows are manual-only and isolated from Windows delivery", () => {
  for (const workflow of ["../.github/workflows/package-linux.yml", "../.github/workflows/release-linux.yml"]) {
    const source = read(workflow);
    assert.match(source, /^on:\s*\n\s+workflow_dispatch:/m);
    assert.doesNotMatch(source, /^\s+(?:push|pull_request|schedule):/m);
    assert.match(source, /runs-on: ubuntu-24\.04|runs-on: \[self-hosted, linux, x64, gnome, secret-service\]/);
    assert.doesNotMatch(source, /windows-/i);
  }
});

test("Linux package workflow rebuilds native dependencies and gates graphical evidence", () => {
  const source = read("../.github/workflows/package-linux.yml");
  assert.match(source, /npm ci --ignore-scripts/);
  assert.match(source, /npm rebuild duckdb/);
  assert.match(source, /npm run package:linux -w @vitana\/desktop/);
  assert.match(source, /inspect-linux-desktop-package\.mjs/);
  assert.match(source, /linux-appimage-smoke\.sh/);
  assert.match(source, /ubuntu-gnome-runtime-evidence/);
});

test("Linux release publishes only AppImage assets and Linux checksums to a draft", () => {
  const source = read("../.github/workflows/release-linux.yml");
  assert.match(source, /ubuntu-gnome-runtime-evidence/);
  assert.match(source, /SHA256SUMS-linux-x64\.txt/);
  assert.match(source, /gh release create .+ --draft/);
  assert.doesNotMatch(source, /latest(?:-linux)?\.yml|\.blockmap/);
});
