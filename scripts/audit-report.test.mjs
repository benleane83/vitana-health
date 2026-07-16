import assert from "node:assert/strict";
import test from "node:test";
import { vulnerabilitiesFromAuditReport } from "./audit-report.mjs";

test("accepts a valid npm audit report", () => {
  assert.deepEqual(vulnerabilitiesFromAuditReport({ vulnerabilities: {} }), {});
});

test("rejects npm registry error payloads", () => {
  assert.throws(
    () => vulnerabilitiesFromAuditReport({ message: "registry unavailable", error: { summary: "" } }),
    /npm audit failed: registry unavailable/
  );
});

test("rejects reports without vulnerability results", () => {
  assert.throws(() => vulnerabilitiesFromAuditReport({ metadata: {} }), /does not contain a vulnerabilities object/);
});