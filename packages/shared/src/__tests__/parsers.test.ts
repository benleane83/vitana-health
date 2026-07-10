import { describe, it, expect } from "vitest";
import { checksum, parseSamsungHealthCsv, parseBloodTestCsv, buildManualLabEntryImport } from "../parsers.js";

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

  it("starts with the expected prefix", () => {
    expect(checksum("test")).toMatch(/^fnv1a-[0-9a-f]{8}$/);
  });
});

// ─── parseSamsungHealthCsv ─────────────────────────────────────────────────────

const samsungHappyCsv = `date,type,value,unit
2026-06-01,heart_rate,65,bpm
2026-06-02,heart_rate,68,bpm
2026-06-03,weight,82.4,kg`;

describe("parseSamsungHealthCsv — happy path", () => {
  it("returns a processed import", () => {
    const result = parseSamsungHealthCsv("test.csv", samsungHappyCsv);
    expect(result.sourceImport.status).toBe("processed");
    expect(result.sourceImport.sourceKind).toBe("samsung-health");
    expect(result.sourceImport.rowCount).toBe(3);
  });

  it("stores the file content as rawContent", () => {
    const result = parseSamsungHealthCsv("test.csv", samsungHappyCsv);
    expect(result.sourceImport.rawContent).toBe(samsungHappyCsv);
  });

  it("assigns the correct checksum", () => {
    const result = parseSamsungHealthCsv("test.csv", samsungHappyCsv);
    expect(result.sourceImport.checksum).toBe(checksum(samsungHappyCsv));
  });

  it("parses heart_rate rows into timeSeriesSamples", () => {
    const result = parseSamsungHealthCsv("test.csv", samsungHappyCsv);
    const hrSamples = result.timeSeriesSamples.filter((s) => s.measurementCode === "heart_rate");
    expect(hrSamples).toHaveLength(2);
    expect(hrSamples[0].value).toBe(65);
    expect(hrSamples[0].unit).toBe("bpm");
  });

  it("parses weight rows into observations", () => {
    const result = parseSamsungHealthCsv("test.csv", samsungHappyCsv);
    const weightObs = result.observations.filter((o) => o.measurementCode === "weight");
    expect(weightObs).toHaveLength(1);
    expect(weightObs[0].value).toBe(82.4);
  });
});

describe("parseSamsungHealthCsv — deduplication", () => {
  it("same file imported twice produces the same checksum", () => {
    const r1 = parseSamsungHealthCsv("test.csv", samsungHappyCsv, "2026-01-01T00:00:00.000Z");
    const r2 = parseSamsungHealthCsv("test.csv", samsungHappyCsv, "2026-01-02T00:00:00.000Z");
    // checksum is based on file content, not import time
    expect(r1.sourceImport.checksum).toBe(r2.sourceImport.checksum);
  });
});

describe("parseSamsungHealthCsv — malformed rows", () => {
  it("skips rows with unrecognized type and records a diagnostic", () => {
    const csv = `date,type,value,unit
2026-06-01,unknown_metric,99,xyz`;
    const result = parseSamsungHealthCsv("bad.csv", csv);
    expect(result.observations).toHaveLength(0);
    expect(result.timeSeriesSamples).toHaveLength(0);
    expect(result.sourceImport.diagnostics.length).toBeGreaterThan(0);
  });

  it("returns empty arrays for an empty CSV", () => {
    const result = parseSamsungHealthCsv("empty.csv", "");
    expect(result.observations).toHaveLength(0);
    expect(result.timeSeriesSamples).toHaveLength(0);
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

  it("creates one panel and correct markers", () => {
    const result = parseBloodTestCsv("labs.csv", bloodTestCsv);
    expect(result.labPanels).toHaveLength(1);
    expect(result.labMarkers).toHaveLength(3);
  });

  it("maps markers to the correct measurement codes", () => {
    const result = parseBloodTestCsv("labs.csv", bloodTestCsv);
    const codes = result.labMarkers.map((m) => m.measurementCode);
    expect(codes).toContain("glucose");
    expect(codes).toContain("total_cholesterol");
    expect(codes).toContain("hdl_cholesterol");
  });

  it("creates observations for each marker", () => {
    const result = parseBloodTestCsv("labs.csv", bloodTestCsv);
    expect(result.observations).toHaveLength(3);
  });
});

describe("parseBloodTestCsv — malformed rows", () => {
  it("skips rows with unknown marker name and records a diagnostic", () => {
    const csv = `marker,value,unit
unknown_lab_marker,99,units`;
    const result = parseBloodTestCsv("bad.csv", csv);
    expect(result.labMarkers).toHaveLength(0);
    expect(result.sourceImport.diagnostics.length).toBeGreaterThan(0);
  });
});

// ─── buildManualLabEntryImport ─────────────────────────────────────────────────

describe("buildManualLabEntryImport", () => {
  it("creates a manual-entry import with one panel and markers", () => {
    const result = buildManualLabEntryImport({
      collectedAt: "2026-06-15T00:00:00.000Z",
      panelName: "Lipid panel",
      markers: [
        { markerName: "Total cholesterol", value: 195, unit: "mg/dL", referenceHigh: 200 },
        { markerName: "HDL", value: 55, unit: "mg/dL", referenceLow: 40 }
      ]
    });
    expect(result.sourceImport.sourceKind).toBe("manual-entry");
    expect(result.labPanels).toHaveLength(1);
    expect(result.labMarkers).toHaveLength(2);
    expect(result.labPanels[0].panelName).toBe("Lipid panel");
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
    expect(result.labMarkers[0].measurementCode).toBe("hba1c");
  });
});
