import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const retiredProductName = ["Local Fitness", "Advisor"].join(" ");
const retiredSlug = ["local", "fitness", "advisor"].join("-");
const retiredCompactName = ["local", "fitness", "advisor"].join("");
const accidentalName = ["Vita", "ra"].join("");
const retiredInitialism = ["L", "F", "A"].join("");

const checks = [
  { label: retiredProductName, pattern: new RegExp(retiredProductName, "g") },
  { label: retiredSlug, pattern: new RegExp(retiredSlug, "g") },
  { label: retiredCompactName, pattern: new RegExp(retiredCompactName, "gi") },
  { label: `${retiredInitialism}_`, pattern: new RegExp(`${retiredInitialism}_`, "g") },
  { label: retiredInitialism, pattern: new RegExp(`\\b${retiredInitialism}\\b`, "g") },
  { label: accidentalName, pattern: new RegExp(accidentalName, "gi") }
];

const compatibilityAllowlist = new Map([
  ["apps/api/src/storage/profileKey.ts", new Set([retiredSlug])],
  ["apps/api/src/security.ts", new Set([retiredSlug])],
  ["apps/desktop/user-data-migration.cjs", new Set([retiredProductName])],
  ["apps/desktop/user-data-migration.test.cjs", new Set([retiredProductName])],
  ["apps/desktop/background-service.cjs", new Set([retiredProductName])],
  ["apps/desktop/background-service.test.cjs", new Set([retiredProductName])],
  ["apps/desktop/build/installer.nsh", new Set([retiredProductName])],
  ["scripts/windows-desktop-smoke.ps1", new Set([retiredProductName])]
]);

function excluded(path) {
  return path.startsWith("node_modules/") ||
    path.startsWith(".git/") ||
    path.startsWith("dist/") ||
    path.includes("/dist/") ||
    path.startsWith(".expo-web-preview/") ||
    path.startsWith(".impeccable/critique/") ||
    /^docs\/CODEBASE_REVIEW_\d{8}\.md$/.test(path) ||
    path.endsWith(".map");
}

export function findBrandViolations(entries) {
  const violations = [];
  for (const { path, content } of entries) {
    if (excluded(path)) continue;
    const allowed = compatibilityAllowlist.get(path) ?? new Set();
    for (const check of checks) {
      if (allowed.has(check.label)) continue;
      for (const match of content.matchAll(check.pattern)) {
        const line = content.slice(0, match.index).split("\n").length;
        violations.push(`${path}:${line}: retired brand token ${JSON.stringify(match[0])}`);
      }
    }
  }
  return violations;
}

function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root }
  ).toString().split("\0").filter(Boolean);
  const entries = [];
  for (const path of paths) {
    const url = new URL(`../${path}`, import.meta.url);
    if (excluded(path) || !existsSync(url)) continue;
    const buffer = readFileSync(url);
    if (!buffer.includes(0)) entries.push({ path, content: buffer.toString("utf8") });
  }
  const violations = findBrandViolations(entries);
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Brand audit passed.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
