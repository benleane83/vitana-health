import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { vulnerabilitiesFromAuditReport } from "./audit-report.mjs";

function readAllowlist() {
  try {
    const raw = readFileSync(new URL("../.audit-allowlist.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw);
    const allowed = new Set(parsed.allowedHighOrCriticalPackages ?? []);
    return { allowed, notes: parsed.notes ?? "" };
  } catch (error) {
    console.error("Failed to read .audit-allowlist.json", error);
    process.exit(2);
  }
}

function runAuditJson() {
  const cmd = "npm audit --omit=dev --json";
  try {
    return execSync(cmd, { encoding: "utf8" });
  } catch (error) {
    // npm audit exits 1 when vulnerabilities are found; stdout still contains JSON report.
    if (typeof error?.stdout === "string" && error.stdout.trim().startsWith("{")) {
      return error.stdout;
    }
    console.error("npm audit failed unexpectedly");
    if (error?.stdout) {
      console.error(String(error.stdout));
    }
    if (error?.stderr) {
      console.error(String(error.stderr));
    }
    process.exit(2);
  }
}

function parseAudit(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("Failed to parse npm audit JSON output", error);
    process.exit(2);
  }
}

function summarize(vulns, allowedPackages) {
  const blocked = [];
  const allowed = [];

  for (const [name, detail] of Object.entries(vulns)) {
    const severity = detail?.severity;
    if (severity !== "high" && severity !== "critical") {
      continue;
    }

    const item = {
      name,
      severity,
      via: Array.isArray(detail?.via)
        ? detail.via
            .map((entry) => (typeof entry === "string" ? entry : entry?.url || entry?.title || entry?.name || "(unknown)"))
            .slice(0, 6)
        : []
    };

    if (allowedPackages.has(name)) {
      allowed.push(item);
    } else {
      blocked.push(item);
    }
  }

  return { blocked, allowed };
}

function printList(label, items) {
  if (items.length === 0) {
    console.log(`${label}: none`);
    return;
  }

  console.log(`${label}:`);
  for (const item of items) {
    console.log(`- ${item.severity.toUpperCase()} ${item.name}`);
    if (item.via.length > 0) {
      console.log(`  via: ${item.via.join(" | ")}`);
    }
  }
}

const { allowed: allowedPackages, notes } = readAllowlist();
const report = parseAudit(runAuditJson());
let vulnerabilities;
try {
  vulnerabilities = vulnerabilitiesFromAuditReport(report);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const { blocked, allowed } = summarize(vulnerabilities, allowedPackages);

printList("Allowed high/critical vulnerabilities", allowed);
printList("Blocking high/critical vulnerabilities", blocked);

if (notes) {
  console.log(`Allowlist notes: ${notes}`);
}

if (blocked.length > 0) {
  console.error(`Audit gate failed: ${blocked.length} unapproved high/critical vulnerabilities found.`);
  process.exit(1);
}

console.log("Audit gate passed: no unapproved high/critical vulnerabilities found.");
