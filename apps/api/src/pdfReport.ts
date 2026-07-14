import PDFDocument from "pdfkit";
import type { ClinicianReport } from "@local-fitness-advisor/shared";

function date(value: string): string {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}

function section(document: PDFKit.PDFDocument, title: string): void {
  document.moveDown().fontSize(14).font("Helvetica-Bold").text(title).moveDown(0.3).fontSize(10).font("Helvetica");
}

function bulletList(document: PDFKit.PDFDocument, items: string[], empty: string): void {
  if (!items.length) {
    document.text(empty);
    return;
  }
  for (const item of items) document.text(`• ${item}`, { indent: 12 });
}

export async function createClinicianReportPdf(report: ClinicianReport): Promise<Buffer> {
  const document = new PDFDocument({ margin: 48, size: "A4", info: { Title: "Local Fitness Advisor clinician report" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.fontSize(20).font("Helvetica-Bold").text("Health Data Report");
  document.fontSize(10).font("Helvetica").text(`Generated: ${date(report.generatedAt)}`);
  document.text(`Profile: ${report.patient.displayName}`);
  const patientDetails = [
    report.patient.birthYear ? `Birth year: ${report.patient.birthYear}` : undefined,
    report.patient.sex ? `Sex: ${report.patient.sex}` : undefined,
    report.patient.height ? `Height: ${report.patient.height.value} ${report.patient.height.unit}` : undefined
  ].filter(Boolean);
  if (patientDetails.length) document.text(patientDetails.join("  |  "));

  section(document, "Data included");
  document.text(
    `Observations: ${report.totals.observations}  |  Samples: ${report.totals.samples}  |  Activities: ${report.totals.activities}`
  );

  section(document, "Latest measurements");
  bulletList(
    document,
    report.latestMeasurements.map((item) => `${item.displayName}: ${item.value} ${item.unit} (${date(item.measuredAt)})`),
    "No measurements have been recorded."
  );

  section(document, "Flagged laboratory results");
  bulletList(
    document,
    report.flaggedLabs.map((item) =>
      `${item.displayName}: ${item.value} ${item.unit} — ${item.flag}${item.referenceRange ? ` (reference: ${item.referenceRange})` : ""}${item.collectedAt ? `, collected ${date(item.collectedAt)}` : ""}`
    ),
    "No flagged laboratory results have been recorded."
  );

  section(document, "Trends");
  bulletList(document, report.trends.map((item) => `${item.displayName} (${item.unit}): ${item.summary}`), "No trends are available.");

  section(document, "Imported sources");
  bulletList(
    document,
    report.sources.map((item) => `${item.fileName} (${item.sourceKind}, ${item.rowCount} rows, ${item.status}, imported ${date(item.importedAt)})`),
    "No data sources have been imported."
  );

  section(document, "Important");
  document.text(report.disclaimer);
  document.end();
  return completed;
}
