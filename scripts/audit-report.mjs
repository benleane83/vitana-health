export function vulnerabilitiesFromAuditReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("npm audit returned an invalid report.");
  }
  if ("error" in report || typeof report.message === "string") {
    throw new Error(`npm audit failed: ${typeof report.message === "string" ? report.message.trim() : "registry error"}`);
  }
  if (!report.vulnerabilities || typeof report.vulnerabilities !== "object" || Array.isArray(report.vulnerabilities)) {
    throw new Error("npm audit report does not contain a vulnerabilities object.");
  }
  return report.vulnerabilities;
}