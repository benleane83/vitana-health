import PDFDocument from "pdfkit";
import type { ClinicianReport, ClinicianReportLatestMeasurement } from "@vitana/shared";

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

function categoryLabel(category: ClinicianReportLatestMeasurement["category"]): string {
  return {
    activity: "Activity",
    body: "Body",
    cardio: "Cardio",
    derived: "Derived",
    lab: "Lab",
    sleep: "Sleep",
    uncategorized: "Uncategorized"
  }[category];
}

function latestMeasurementDescription(item: ClinicianReportLatestMeasurement): string {
  if (item.value !== undefined && item.unit) return `${item.value} ${item.unit}`;
  if (item.activity) {
    const duration = item.activity.durationMinutes === undefined ? "" : `, ${item.activity.durationMinutes} min`;
    return `${item.activity.activityType}${duration}`;
  }
  return "Recorded";
}

export async function createClinicianReportPdf(report: ClinicianReport): Promise<Buffer> {
  const document = new PDFDocument({ margin: 48, size: "A4", info: { Title: "Vitana Health clinician report" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.fontSize(20).font("Helvetica-Bold").text("Vitana Health Data Report");
  document.fontSize(10).font("Helvetica").text(`Generated: ${date(report.generatedAt)}`);
  document.text(`Profile: ${report.patient.displayName}`);
  const patientDetails = [
    report.patient.birthDate ? `Birth date: ${report.patient.birthDate}` : undefined,
    report.patient.sex ? `Sex: ${report.patient.sex}` : undefined,
    report.patient.height ? `Height: ${report.patient.height.value} ${report.patient.height.unit}` : undefined
  ].filter(Boolean);
  if (patientDetails.length) document.text(patientDetails.join("  |  "));

  section(document, "Data included");
  document.text(
    `Observations: ${report.totals.observations}  |  Samples: ${report.totals.samples}  |  Activities: ${report.totals.activities}`
  );

  section(document, "Latest measurements");
  if (!report.latestMeasurements.length) {
    document.text("No measurements have been recorded.");
  } else {
    const byCategory = new Map<ClinicianReportLatestMeasurement["category"], ClinicianReportLatestMeasurement[]>();
    for (const measurement of report.latestMeasurements) {
      const category = byCategory.get(measurement.category) ?? [];
      category.push(measurement);
      byCategory.set(measurement.category, category);
    }
    for (const [category, measurements] of byCategory) {
      document.moveDown(0.3).fontSize(11).font("Helvetica-Bold").text(categoryLabel(category)).fontSize(10).font("Helvetica");
      bulletList(
        document,
        measurements.map((item) => `${item.displayName}: ${latestMeasurementDescription(item)} (${date(item.measuredAt)})`),
        ""
      );
    }
  }

  section(document, "Medications");
  bulletList(
    document,
    report.medications.map((medication) => {
      const ingredient = medication.activeIngredient ? ` (${medication.activeIngredient})` : "";
      const dose = [medication.dose, medication.unit].filter((value) => value !== undefined).join(" ");
      const dates = [
        medication.startDate ? `started ${medication.startDate}` : undefined,
        medication.endDate ? `ended ${medication.endDate}` : undefined
      ].filter(Boolean).join(", ");
      return `${medication.name}${ingredient}${dose ? ` — ${dose}` : ""}${dates ? `; ${dates}` : ""}`;
    }),
    "No medications have been recorded."
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

  section(document, "Important");
  document.text(report.disclaimer);
  document.end();
  return completed;
}
