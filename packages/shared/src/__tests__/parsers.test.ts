import { describe, it, expect } from "vitest";
import {
  buildBodyCompositionImportFromDraft,
  buildBloodTestImportFromDraft,
  buildManualLabEntryImport,
  buildManualObservationImport,
  checksum,
  parseBodyCompositionText,
  parseBloodTestCsv,
  parseBloodTestScanText,
  parseObservationCsv
} from "../parsers.js";
import { parseLocaleNumber } from "../parserPrimitives.js";

// ─── checksum ──────────────────────────────────────────────────────────────────

describe("checksum", () => {
  it("is deterministic for the same input", () => {
    const a = checksum("hello world");
    const b = checksum("hello world");
    expect(a).toBe(b);
  });

  it("produces different values for different inputs", () => {
    expect(checksum("abc")).not.toBe(checksum("abd"));
    expect(checksum("")).not.toBe(checksum(" "));
  });

  it("returns a SHA-256 digest", () => {
    expect(checksum("test")).toBe("sha256-9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
  });
});

describe("parseLocaleNumber", () => {
  it.each([
    ["12,5", 12.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1 234,56", 1234.56],
    ["1\u00a0234.56", 1234.56]
  ])("parses %s without rescaling", (input, expected) => {
    expect(parseLocaleNumber(input)).toBe(expected);
  });

  it.each(["1,234", "1.234", "12,34,5", "12 34", "12.3.4"])("rejects ambiguous or malformed input: %s", (input) => {
    expect(parseLocaleNumber(input)).toBeUndefined();
  });
});

// ─── parseBloodTestCsv ─────────────────────────────────────────────────────────

const bloodTestCsv = `marker,value,unit,reference_low,reference_high
glucose,95,mg/dL,70,99
total_cholesterol,195,mg/dL,,200
hdl,52,mg/dL,40,`;

describe("parseBloodTestCsv — happy path", () => {
  it("returns a processed import", () => {
    const result = parseBloodTestCsv("labs.csv", bloodTestCsv);
    expect(result.sourceImport.status).toBe("processed");
    expect(result.sourceImport.sourceKind).toBe("blood-test-csv");
  });

  it("creates one lab group and canonical observations without legacy markers", () => {
    const result = parseBloodTestCsv("labs.csv", bloodTestCsv);
    expect(result.observationGroups).toEqual([
      expect.objectContaining({ kind: "lab_panel", label: "Lab test panel" })
    ]);
    expect(result.observations).toHaveLength(3);
    expect(result.observations.every((item) => item.observationGroupId === result.observationGroups[0].id)).toBe(true);
  });

  it("maps markers to the correct measurement codes", () => {
    const result = parseBloodTestCsv("labs.csv", bloodTestCsv);
    const codes = result.observations.map((m) => m.measurementCode);
    expect(codes).toContain("glucose");
    expect(codes).toContain("total_cholesterol");
    expect(codes).toContain("hdl_cholesterol");
  });

  it("creates observations for each marker", () => {
    const result = parseBloodTestCsv("labs.csv", bloodTestCsv);
    expect(result.observations).toHaveLength(3);
  });

  it("keeps an import processed when a missing unit only produces an informational diagnostic", () => {
    const result = parseBloodTestCsv("labs.csv", "marker,value\nglucose,95");

    expect(result.sourceImport.status).toBe("processed");
    expect(result.sourceImport.diagnostics).toEqual(["Used canonical unit for lab row with no unit: Glucose."]);
  });
});

describe("parseBloodTestCsv — malformed rows", () => {
  it("skips rows with unknown marker name and records a diagnostic", () => {
    const csv = `marker,value,unit
unknown_lab_marker,99,units`;
    const result = parseBloodTestCsv("bad.csv", csv);
    expect(result.observations).toHaveLength(0);
    expect(result.sourceImport.diagnostics.length).toBeGreaterThan(0);
  });

  describe("profile unit defaults", () => {
    it("uses the profile preference only when a known CSV measurement has no source unit", () => {
      const result = parseObservationCsv(
        "observations.csv",
        "observedAt,measurement,value,unit\n2026-06-15,weight,154,\n2026-06-16,weight,70,kg",
        "2026-06-17T00:00:00.000Z",
        "imperial"
      );

      expect(result.observations.map((observation) => observation.unit)).toEqual(["lb", "kg"]);
    });
  });
});

// ─── buildManualLabEntryImport ─────────────────────────────────────────────────

describe("buildManualLabEntryImport", () => {
  it("creates a grouped manual-entry import without duplicated marker values", () => {
    const result = buildManualLabEntryImport({
      collectedAt: "2026-06-15T00:00:00.000Z",
      panelName: "Lipid panel",
      markers: [
        { markerName: "Total cholesterol", value: 195, unit: "mg/dL" },
        { markerName: "HDL", value: 55, unit: "mg/dL" }
      ]
    });

    expect(result.sourceImport.sourceKind).toBe("manual-entry");
    expect(result.observationGroups).toEqual([expect.objectContaining({ kind: "lab_panel", label: "Lipid panel" })]);
    expect(result.observations).toHaveLength(2);
  });

  it("round-trip: checksum is stable for the same payload", () => {
    const payload = {
      collectedAt: "2026-06-15T00:00:00.000Z",
      panelName: "Lipid panel",
      markers: [{ markerName: "glucose", value: 90, unit: "mg/dL" }]
    };
    const r1 = buildManualLabEntryImport(payload, "2026-06-15T10:00:00.000Z");
    const r2 = buildManualLabEntryImport(payload, "2026-06-15T12:00:00.000Z");
    // checksum is based on payload content, not importedAt
    expect(r1.sourceImport.checksum).toBe(r2.sourceImport.checksum);
  });

  it("creates an observation for each accepted marker", () => {
    const result = buildManualLabEntryImport({
      collectedAt: "2026-06-15T00:00:00.000Z",
      panelName: "CMP",
      markers: [{ markerName: "glucose", value: 88 }]
    });
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].measurementCode).toBe("glucose");
  });

  it("uses code lookup when markerCode is provided and markerName is absent", () => {
    const result = buildManualLabEntryImport({
      collectedAt: "2026-06-15T00:00:00.000Z",
      panelName: "Test",
      markers: [{ markerCode: "hba1c", value: 5.4, unit: "%" }]
    });
    expect(result.observations[0].measurementCode).toBe("hba1c");
  });

  it("uses deterministic group and observation IDs", () => {
    const payload = { collectedAt: "2026-06-15T00:00:00.000Z", panelName: "CMP", markers: [{ markerName: "glucose", value: 88, unit: "mg/dL" }] };
    const first = buildManualLabEntryImport(payload);
    const second = buildManualLabEntryImport(payload);
    expect(second.observationGroups[0].id).toBe(first.observationGroups[0].id);
    expect(second.observations[0].id).toBe(first.observations[0].id);
  });
});

describe("generic observation imports", () => {
  it("accepts manual body-composition observations", () => {
    const result = buildManualObservationImport({
      observedAt: "2026-06-15", label: "Home scale",
      observations: [{ measurementName: "Weight", value: 82, unit: "kg" }]
    });
    expect(result.observations[0]).toMatchObject({ measurementCode: "weight", value: 82 });
    expect(result.observationGroups[0].metadata).toStrictEqual({});
    expect(result.observations[0].sourceJson).toStrictEqual({ measurementName: "Weight", value: 82, unit: "kg" });
  });

  it.each([
    ["Body", "body_composition_report"],
    ["Lab", "lab_panel"],
    ["Home readings", "custom"]
  ] as const)("assigns the %s manual group its matching kind", (label, kind) => {
    const result = buildManualObservationImport({
      observedAt: "2026-06-15",
      label,
      observations: [{ measurementName: "Custom score", value: 7, unit: "points" }]
    });

    expect(result.observationGroups[0].kind).toBe(kind);
  });

  it("preserves a note supplied with a manual observation", () => {
    const result = buildManualObservationImport({
      observedAt: "2026-06-15", label: "Manual Glucose",
      observations: [{ measurementCode: "glucose", value: 5.2, unit: "mmol/L", note: "Fasting" }]
    });
    expect(result.observations[0]).toMatchObject({ note: "Fasting" });
    expect(result.observations[0].sourceJson).toMatchObject({ note: "Fasting" });
  });

  it("maps generic CSV observations and generates a fallback code", () => {
    const result = parseObservationCsv("observations.csv", "observedAt,measurement,value,unit\n2026-06-15,Custom score,7,points");
    expect(result.sourceImport.sourceKind).toBe("observation-csv");
    expect(result.sourceImport.status).toBe("processed");
    expect(result.observations[0].measurementCode).toBe("manual_custom_score");
    expect(result.observationGroups[0].metadata).toStrictEqual({});
  });
});

describe("parseBloodTestScanText", () => {
  it("creates editable blood-test draft rows with diagnostics", () => {
    const result = parseBloodTestScanText("cbc-2026-06-15.pdf", "Report date: 2026-06-15\nGlucose: 95 mg/dL");
    expect(result.rows).toEqual([expect.objectContaining({ measurementCode: "glucose", included: true, confidence: "high" })]);
    expect(result.parserVersion).toBe("blood-test-text-v1");
    expect(result.reportDate).toContain("2026-06-15");
  });

  it("parses day/month-name report dates from OCR text", () => {
    const result = parseBloodTestScanText(
      "tanita-report.jpg",
      "TANITA BODY COMPOSITION ANALYZER\n06/JUN/2026 12:36\nWEIGHT 74.8kg"
    );
    expect(result.reportDate).toContain("2026-06-06T12:36:00.000Z");
  });

  it("parses a known marker from a lab table without treating metadata dates as measurements", () => {
    const result = parseBloodTestScanText(
      "BloodTestResults_Jul2026_Iron.pdf",
      [
        "Receiving Date 08/07/2026 18:49",
        "08/07/2026 19:25 AUTHORISED Date",
        "Iron (Fe++) 13.7 umol/L 5.8-34.5 Test Result Flag Units Ref. Range",
        "Instant: 09/07/2026 11:20"
      ].join("\n")
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        measurementCode: "iron",
        displayName: "Iron",
        value: 13.7,
        unit: "µmol/L",
        included: true,
        confidence: "high"
      })
    ]);
    expect(result.reportDate).toBe("2026-07-08T18:49:00.000Z");
  });

  it("skips OCR-spaced date metadata while preserving nearby lab measurements", () => {
    const result = parseBloodTestScanText(
      "BloodTestResults_Aug2026.pdf",
      [
        "Authorised Date 18 05 2026 22:50",
        "Collection Date: 18 05 2026",
        "Receiving Date 18 05 2026",
        "Haemoglobin 13.8 g/dL"
      ].join("\n")
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        measurementCode: "haemoglobin",
        value: 13.8,
        unit: "g/dL",
        included: true
      })
    ]);
    expect(result.reportDate).toBe("2026-05-18T22:50:00.000Z");
  });

  it("skips administrative identifier lines instead of drafting them as unknown measurements", () => {
    const result = parseBloodTestScanText(
      "results.pdf",
      "Lab No: 123456\nLicense No. 7890\nGlucose 95 mg/dL"
    );

    expect(result.rows).toEqual([expect.objectContaining({ measurementCode: "glucose" })]);
    expect(result.diagnostics.filter((message) => message.includes("administrative identifier"))).toHaveLength(2);
  });

  it("prioritizes report dates and excludes the active profile birth date", () => {
    const result = parseBloodTestScanText(
      "LabResults_CliniPath_2.pdf",
      [
        "Birthdate: 21/08/1980 Sex: F",
        "17/12/2008 Requested: 16/12/2008 Collected: 16/12/2008 Reported: 10:46",
        "Ferritin 50 ug/L"
      ].join("\n"),
      undefined,
      { excludedDates: ["1980-08-21"] }
    );

    expect(result.reportDate).toBe("2008-12-17T00:00:00.000Z");
  });

  it("prefers explicitly reported dates over other document dates", () => {
    const result = parseBloodTestScanText(
      "results.pdf",
      "Birthdate: 21/08/1980\nCollected: 16/12/2008\nReported: 17/12/2008\nFerritin 50 ug/L",
      undefined,
      { excludedDates: ["1980-08-21"] }
    );

    expect(result.reportDate).toBe("2008-12-17T00:00:00.000Z");
  });
});

describe("parseBodyCompositionText", () => {
  it("parses day/month-name report dates from OCR text", () => {
    const result = parseBodyCompositionText(
      "tanita-report.jpg",
      "TANITA BODY COMPOSITION ANALYZER\n06/JUN/2026 12:36\nWEIGHT 74.8kg"
    );
    expect(result.reportDate).toContain("2026-06-06T12:36:00.000Z");
  });

  it("parses an InBody Test Date /Time timestamp with spaces around numeric separators", () => {
    const result = parseBodyCompositionText(
      "BodyComp_InBody_1.pdf",
      "ID Height Age Gender Test Date /Time\nbrl83 187.9cm 35 Male 23. 03. 2019 14:13\nWeight 76.7 kg"
    );

    expect(result.reportDate).toBe("2019-03-23T14:13:00.000Z");
  });

  it("skips values in a body composition history section and resumes at current-data sections", () => {
    const result = parseBodyCompositionText(
      "inbody.pdf",
      [
        "Skeletal Muscle Mass 34.9 kg",
        "BODYCOMPOSITION HISTORY",
        "Weight kg 72.7 73.9 76.7",
        "Skeletal Muscle Mass kg 33.8 34.1 34.9",
        "Additional Data",
        "Basal Metabolic Rate 1721 kcal"
      ].join("\n")
    );

    expect(result.rows.filter((row) => row.measurementCode === "skeletal_muscle_mass")).toEqual([
      expect.objectContaining({ value: 34.9, included: true })
    ]);
    expect(result.rows).toContainEqual(expect.objectContaining({ measurementCode: "basal_metabolic_rate", value: 1721, included: true }));
    expect(result.diagnostics).toContain("Skipped measurements in a body composition history section.");
  });

  it("continues parsing reports without a history section", () => {
    const result = parseBodyCompositionText(
      "BodyComp-Ben-Jun62026.pdf",
      [
        "06/JUN/2026 12:36",
        "WEIGHT 74.8kg",
        "FAT % 16.3 %",
        "MUSCLE MASS 59.5kg",
        "SKELETAL MUSCLE MASS 34.9kg",
        "DESIRABLE RANGE"
      ].join("\n")
    );

    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ measurementCode: "weight", value: 74.8, included: true }),
      expect.objectContaining({ measurementCode: "body_fat_pct", value: 16.3, included: true }),
      expect.objectContaining({ measurementCode: "muscle_mass", value: 59.5, included: true }),
      expect.objectContaining({ measurementCode: "skeletal_muscle_mass", value: 34.9, included: true })
    ]));
    expect(result.rows.filter((row) => row.measurementCode === "muscle_mass")).toHaveLength(1);
    expect(result.rows.filter((row) => row.measurementCode === "skeletal_muscle_mass")).toHaveLength(1);
    expect(result.diagnostics).not.toContain("Skipped measurements in a body composition history section.");
  });

  it("parses the reliable metric tiles from a Eufy body-composition image OCR layout", () => {
    const result = parseBodyCompositionText(
      "EufyBodyComp.jpg",
      [
        "© weicHT             EA mi",
        "54.0.     18.0",
        "BODY FAT %         Ey WATER",
        "23.74                 92.4,",
        "EMR                 dy VISCERAL",
        "1 062 kcal             2.0",
        "BOE MRE",
        "4] , kg                   12.8 kg",
        "77. BONE MASS         fo MUSCLE",
        "2.4 kg                         3 8 . 8 kg"
      ].join("\n")
    );

    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ measurementCode: "weight", value: 54, unit: "kg", included: true }),
      expect.objectContaining({ measurementCode: "bmi", value: 18, unit: "kg/m2", included: true }),
      expect.objectContaining({ measurementCode: "body_fat_pct", value: 23.74, unit: "%", included: true }),
      expect.objectContaining({ measurementCode: "body_water_pct", value: 52.4, unit: "%", included: true }),
      expect.objectContaining({ measurementCode: "basal_metabolic_rate", value: 1062, unit: "kcal/day", included: true }),
      expect.objectContaining({ measurementCode: "visceral_fat_level", value: 2, unit: "level", included: true }),
      expect.objectContaining({ measurementCode: "lean_body_mass", value: 41.2, unit: "kg", included: true }),
      expect.objectContaining({ measurementCode: "fat_mass", value: 12.8, unit: "kg", included: true }),
      expect.objectContaining({ measurementCode: "bone_mineral_content", value: 2.4, unit: "kg", included: true }),
      expect.objectContaining({ measurementCode: "muscle_mass", value: 38.8, unit: "kg", included: true })
    ]));
    expect(result.rows).toHaveLength(10);
    expect(result.rows.some((row) => row.generatedCode)).toBe(false);
    expect(result.diagnostics).toContain("No report date was detected; confirm the date before saving.");
  });

  it("skips administrative identifier lines instead of drafting them as unknown measurements", () => {
    const result = parseBodyCompositionText(
      "body.pdf",
      "Lab No: 123456\nLicense No. 7890\nWeight 76.7 kg"
    );

    expect(result.rows).toEqual([expect.objectContaining({ measurementCode: "weight", value: 76.7 })]);
    expect(result.diagnostics.filter((message) => message.includes("administrative identifier"))).toHaveLength(2);
  });
});

describe("buildBodyCompositionImportFromDraft", () => {
  it("groups included report observations", () => {
    const result = buildBodyCompositionImportFromDraft({
      fileName: "report.pdf", reportDate: "2026-06-15", sourceChecksum: "report",
      rows: [{ id: "weight", label: "Weight", measurementCode: "weight", displayName: "Weight", value: 82, unit: "kg", confidence: "high", included: true }]
    });
    expect(result.observationGroups).toEqual([expect.objectContaining({ kind: "body_composition_report", label: "Body" })]);
    expect(result.observations[0].observationGroupId).toBe(result.observationGroups[0].id);
    expect(result.observations[0]).toMatchObject({
      observedAt: "2026-06-15T00:00:00.000Z",
      note: "Body composition report: scanned from phone"
    });
    expect(result.dataSource.label).toBe("Body composition report: scanned from phone");
    expect(result.sourceImport.fileName).toBe("report.pdf");
  });
});

describe("buildBloodTestImportFromDraft", () => {
  it("maps lab-result observations to the Lab group", () => {
    const result = buildBloodTestImportFromDraft({
      fileName: "results.pdf", reportDate: "2026-06-15", sourceChecksum: "results",
      rows: [{ id: "iron", label: "Iron", measurementCode: "iron", displayName: "Iron", value: 13.7, unit: "µmol/L", confidence: "high", included: true }]
    });
    expect(result.observationGroups).toEqual([expect.objectContaining({ kind: "lab_panel", label: "Lab" })]);
    expect(result.observations[0].observationGroupId).toBe(result.observationGroups[0].id);
    expect(result.observations[0].observedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(result.observations[0]).not.toHaveProperty("note");
    expect(result.dataSource.label).toBe("Blood test report: scanned from phone");
    expect(result.sourceImport.fileName).toBe("results.pdf");
  });

  it("preserves the fallback-based observation identity without persisting its note", () => {
    const importedAt = "2026-06-15T12:00:00.000Z";
    const bloodTestImport = buildBloodTestImportFromDraft({
      fileName: "results.pdf", reportDate: "2026-06-15", sourceChecksum: "results",
      rows: [{ id: "iron", label: "Iron", measurementCode: "iron", displayName: "Iron", value: 13.7, unit: "µmol/L", confidence: "high", included: true }]
    }, importedAt);
    const manualImport = buildManualObservationImport({
      observedAt: "2026-06-15",
      label: "Lab",
      observations: [{ measurementName: "Iron", measurementCode: "iron", value: 13.7, unit: "µmol/L" }]
    }, importedAt, "lab_panel");

    expect(bloodTestImport.observations[0]).not.toHaveProperty("note");
    expect(bloodTestImport.observations[0].id).toBe(manualImport.observations[0].id);
  });

  it("includes legacy rows unless they were explicitly excluded", () => {
    const legacyRow = {
      id: "iron",
      label: "Iron",
      measurementCode: "iron",
      displayName: "Iron",
      value: 13.7,
      unit: "µmol/L",
      confidence: "high"
    } as unknown as import("../parserTypes.js").BodyCompositionDraftRow;
    const result = buildBloodTestImportFromDraft({
      fileName: "results.pdf", reportDate: "2026-06-15", sourceChecksum: "results", rows: [legacyRow]
    });

    expect(result.observations).toHaveLength(1);
  });
});
