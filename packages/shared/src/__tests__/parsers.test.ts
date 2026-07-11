import { describe, it, expect } from "vitest";
import {
  buildBodyCompositionImportFromDraft,
  buildManualLabEntryImport,
  checksum,
  parseBloodTestCsv
} from "../parsers.js";

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
      expect.objectContaining({ kind: "lab_panel", label: "Blood test panel" })
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
});

describe("parseBloodTestCsv — malformed rows", () => {
  it("skips rows with unknown marker name and records a diagnostic", () => {
    const csv = `marker,value,unit
unknown_lab_marker,99,units`;
    const result = parseBloodTestCsv("bad.csv", csv);
    expect(result.observations).toHaveLength(0);
    expect(result.sourceImport.diagnostics.length).toBeGreaterThan(0);
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

describe("buildBodyCompositionImportFromDraft", () => {
  it("groups included report observations", () => {
    const result = buildBodyCompositionImportFromDraft({
      fileName: "report.pdf", reportDate: "2026-06-15", sourceChecksum: "report",
      rows: [{ id: "weight", label: "Weight", measurementCode: "weight", displayName: "Weight", value: 82, unit: "kg", confidence: "high", included: true }]
    });
    expect(result.observationGroups).toEqual([expect.objectContaining({ kind: "body_composition_report" })]);
    expect(result.observations[0].observationGroupId).toBe(result.observationGroups[0].id);
  });
});
