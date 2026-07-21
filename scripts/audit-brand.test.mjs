import assert from "node:assert/strict";
import test from "node:test";
import { findBrandViolations } from "./audit-brand.mjs";

test("brand audit detects retired names in maintained source", () => {
  const retiredName = ["Local Fitness", "Advisor"].join(" ");
  const violations = findBrandViolations([{ path: "apps/web/src/example.ts", content: retiredName }]);
  assert.equal(violations.length, 1);
});

test("brand audit excludes dated reviews and permits only compatibility files", () => {
  const retiredSlug = ["local", "fitness", "advisor"].join("-");
  assert.deepEqual(findBrandViolations([
    { path: "docs/CODEBASE_REVIEW_20260715.md", content: retiredSlug },
    { path: "apps/api/src/storage/profileKey.ts", content: retiredSlug }
  ]), []);
  assert.equal(findBrandViolations([{ path: "apps/api/src/server.ts", content: retiredSlug }]).length, 1);
});
