import { describe, expect, it } from "vitest";
import {
  buildStructuredUploadImportFromDraft,
  detectUploadFormat,
  detectUploadLayout,
  parseStructuredUpload
} from "../uploadImportParser.js";
import type { UploadDraftRow } from "../parserTypes.js";

// ─── format / layout detection ─────────────────────────────────────────────────

describe("detectUploadFormat", () => {
  it("uses the file extension when present", () => {
    expect(detectUploadFormat("data.tsv", "a,b\n1,2")).toBe("tsv");
    expect(detectUploadFormat("data.csv", "a\tb\n1\t2")).toBe("csv");
  });

  it("sniffs the delimiter from the header line when the extension is ambiguous", () => {
    expect(detectUploadFormat("export.txt", "date\tweight_kg\n2026-01-01\t80")).toBe("tsv");
    expect(detectUploadFormat("export.txt", "date,weight_kg\n2026-01-01,80")).toBe("csv");
  });
});

describe("detectUploadLayout", () => {
  it("recognizes long-format headers (measurement + value columns)", () => {
    expect(detectUploadLayout(["observedAt", "measurement", "value", "unit"])).toBe("long");
  });

  it("falls back to wide format when there is no measurement/value pair", () => {
    expect(detectUploadLayout(["date", "weight_kg", "heart_rate"])).toBe("wide");
  });
});

// ─── long-format parsing ────────────────────────────────────────────────────────

const longFormatCsv = `observedAt,measurement,value,unit
2026-07-01T08:00:00Z,glucose,95,mg/dL
2026-07-02T08:00:00Z,Not A Real Marker,12,widgets`;

describe("parseStructuredUpload — long format", () => {
  it("maps known measurements and includes them by default", () => {
    const draft = parseStructuredUpload("labs.csv", longFormatCsv);
    expect(draft.layout).toBe("long");
    expect(draft.format).toBe("csv");
    const glucoseRow = draft.rows.find((row) => row.measurementCode === "glucose");
    expect(glucoseRow?.included).toBe(true);
    expect(glucoseRow?.confidence).toBe("high");
  });

  it("excludes unknown/ambiguous measurements by default and flags them", () => {
    const draft = parseStructuredUpload("labs.csv", longFormatCsv);
    const unknownRow = draft.rows.find((row) => row.value === 12);
    expect(unknownRow?.included).toBe(false);
    expect(unknownRow?.generatedCode).toBe(true);
    expect(draft.diagnostics.some((message) => message.includes("excluded until mapped"))).toBe(true);
  });

  it("skips rows with no numeric value instead of drafting them", () => {
    const draft = parseStructuredUpload(
      "labs.csv",
      "observedAt,measurement,value,unit\n2026-07-01T08:00:00Z,glucose,not-a-number,mg/dL"
    );
    expect(draft.rows).toHaveLength(0);
    expect(draft.diagnostics.some((message) => message.includes("no numeric value"))).toBe(true);
  });
});

// ─── wide-format parsing ────────────────────────────────────────────────────────

const wideFormatCsv = `date,weight_kg,unknown_metric
2026-07-01,80,5
2026-07-02,79.5,6`;

describe("parseStructuredUpload — wide format", () => {
  it("suggests measurement mappings for recognized columns and ignores unknown ones", () => {
    const draft = parseStructuredUpload("wide.csv", wideFormatCsv);
    expect(draft.layout).toBe("wide");
    expect(draft.mappingSuggestion.measurementColumns?.["weight_kg"]?.measurementCode).toBe("weight");
    expect(draft.mappingSuggestion.measurementColumns?.["unknown_metric"]).toBeUndefined();
    expect(draft.mapping.ignoredColumns).toContain("unknown_metric");
  });

  it("only produces rows for mapped columns", () => {
    const draft = parseStructuredUpload("wide.csv", wideFormatCsv);
    expect(draft.rows.every((row) => row.measurementCode === "weight")).toBe(true);
    expect(draft.rows).toHaveLength(2);
    expect(draft.rows[0].observedAt).toBeDefined();
  });

  it("reads units from parenthesized wide-format headers", () => {
    const draft = parseStructuredUpload(
      "wide.csv",
      "date,Weight (lb)\n2026-07-01,176"
    );
    expect(draft.rows[0]).toMatchObject({ measurementCode: "weight", unit: "lb", value: 176 });
  });

  it("applies a mapping override to include a previously unknown column", () => {
    const draft = parseStructuredUpload("wide.csv", wideFormatCsv, {
      mapping: {
        layout: "wide",
        measurementColumns: { unknown_metric: { measurementCode: "steps" } }
      }
    });
    const stepsRows = draft.rows.filter((row) => row.measurementCode === "steps");
    expect(stepsRows).toHaveLength(2);
  });

  it("allows a recognized column to be explicitly ignored", () => {
    const draft = parseStructuredUpload("wide.csv", wideFormatCsv, {
      mapping: {
        layout: "wide",
        ignoredColumns: ["weight_kg", "unknown_metric"]
      }
    });
    expect(draft.mapping.measurementColumns?.["weight_kg"]).toBeUndefined();
    expect(draft.rows).toHaveLength(0);
  });

  it("allows the automatically detected date column to be cleared", () => {
    const draft = parseStructuredUpload("wide.csv", wideFormatCsv, {
      mapping: { layout: "wide", dateColumn: "" }
    });
    expect(draft.mapping.dateColumn).toBe("");
    expect(draft.rows.every((row) => row.observedAt === undefined)).toBe(true);
  });
});

describe("parseStructuredUpload — mapping overrides", () => {
  it("allows an automatically detected long-format column to be cleared", () => {
    const draft = parseStructuredUpload("labs.csv", longFormatCsv, {
      mapping: { layout: "long", dateColumn: "" }
    });
    expect(draft.mapping.dateColumn).toBe("");
    expect(draft.rows.every((row) => row.observedAt === undefined)).toBe(true);
  });

  it("retains mapped source metadata in committed provenance", () => {
    const draft = parseStructuredUpload(
      "labs.csv",
      "date,measurement,value,unit,source,note\n2026-07-01,glucose,95,mg/dL,Home meter,Fasting",
      { mapping: { sourceNameColumn: "source", noteColumn: "note" } }
    );
    const imported = buildStructuredUploadImportFromDraft({ fileName: "labs.csv", rows: draft.rows });
    expect(imported.observations[0].sourceJson).toMatchObject({
      sourceName: "Home meter",
      note: "Fasting"
    });
  });
});

// ─── row ceiling ────────────────────────────────────────────────────────────────

describe("parseStructuredUpload — row ceiling", () => {
  it("caps drafted rows at the 200-row ceiling and reports truncation", () => {
    const lines = ["observedAt,measurement,value,unit"];
    for (let index = 0; index < 250; index += 1) {
      lines.push(`2026-07-01T00:00:00Z,glucose,${90 + index},mg/dL`);
    }
    const draft = parseStructuredUpload("labs.csv", lines.join("\n"));
    expect(draft.rows).toHaveLength(200);
    expect(draft.truncated).toBe(true);
    expect(draft.rowCount).toBe(250);
  });
});

// ─── commit builder ─────────────────────────────────────────────────────────────

describe("buildStructuredUploadImportFromDraft", () => {
  const approvedRows: UploadDraftRow[] = [
    {
      id: "row-1",
      label: "glucose",
      measurementCode: "glucose",
      displayName: "Glucose",
      value: 95,
      unit: "mg/dL",
      observedAt: "2026-07-01T08:00:00.000Z",
      confidence: "high",
      included: true
    },
    {
      id: "row-2",
      label: "Excluded marker",
      measurementCode: "manual_excluded_marker",
      displayName: "Excluded marker",
      value: 12,
      unit: "widgets",
      confidence: "low",
      included: false,
      generatedCode: true
    }
  ];

  it("only commits rows still marked included", () => {
    const imported = buildStructuredUploadImportFromDraft({ fileName: "labs.csv", rows: approvedRows });
    expect(imported.observations).toHaveLength(1);
    expect(imported.observations[0].measurementCode).toBe("glucose");
    expect(imported.sourceImport.sourceKind).toBe("structured-upload");
    expect(imported.dataSource.sourceKind).toBe("structured-upload");
  });

  it("is idempotent: committing the same draft twice produces the same observation IDs", () => {
    const first = buildStructuredUploadImportFromDraft({ fileName: "labs.csv", checksum: "sha256-fixed", rows: approvedRows });
    const second = buildStructuredUploadImportFromDraft({ fileName: "labs.csv", checksum: "sha256-fixed", rows: approvedRows });
    expect(first.observations[0].id).toBe(second.observations[0].id);
    expect(first.sourceImport.id).toBe(second.sourceImport.id);
  });
});
