import type { BodyCompositionDraftRow } from "@vitana/shared";
import { describe, expect, it } from "vitest";
import {
  dateOnlyToLocalDate,
  groupScanRows,
  localDateOnly,
  newScanReportRow,
  scanReportDate,
  shouldRemoveScanReportRowOnExclude,
  toCommittedScanRows,
  toEditableScanRows,
  type ScanReportEditableRow
} from "./scanReportReview";

describe("scan report review", () => {
  it("keeps decimal text editable until commit", () => {
    const [editable] = toEditableScanRows([row("weight", true, 72)]);
    editable.value = "72.";
    expect(editable.value).toBe("72.");

    editable.value = "72.5";
    expect(toCommittedScanRows([editable])[0].value).toBe(72.5);
  });

  it("validates selected rows without allowing excluded rows to block import", () => {
    const selected = editableRow("weight", true, "72.5");
    const excluded = editableRow("unknown", false, "not a number");
    expect(toCommittedScanRows([selected, excluded])).toHaveLength(1);
    expect(() => toCommittedScanRows([{ ...selected, value: "" }])).toThrow("numeric value");
    expect(() => toCommittedScanRows([{ ...selected, included: false }])).toThrow("Include at least one row");
  });

  it("groups selected rows first while preserving source order", () => {
    const rows = [
      editableRow("first", true, "1"),
      editableRow("second", false, "2"),
      editableRow("third", true, "3"),
      editableRow("fourth", false, "4")
    ];
    expect(groupScanRows(rows).selected.map((entry) => entry.id)).toEqual(["first", "third"]);
    expect(groupScanRows(rows).notSelected.map((entry) => entry.id)).toEqual(["second", "fourth"]);

    const regrouped = groupScanRows(rows.map((entry) => entry.id === "second" ? { ...entry, included: true } : entry));
    expect(regrouped.selected.map((entry) => entry.id)).toEqual(["first", "second", "third"]);
  });

  it("adds a blank manually entered row selected for save", () => {
    expect(newScanReportRow("manual-1")).toEqual(expect.objectContaining({
      id: "manual-1",
      measurementCode: "",
      value: "",
      unit: "",
      included: true,
      manuallyAdded: true
    }));
  });

  it("removes only empty manually added rows when they are excluded", () => {
    expect(shouldRemoveScanReportRowOnExclude(newScanReportRow("manual-empty"))).toBe(true);
    expect(shouldRemoveScanReportRowOnExclude({ ...newScanReportRow("manual-valued"), value: "72" })).toBe(false);
    expect(shouldRemoveScanReportRowOnExclude(editableRow("ocr-empty", true, ""))).toBe(false);
  });

  it("uses the detected report date or a local calendar fallback without UTC conversion", () => {
    const fallback = new Date(2026, 6, 25, 23, 30);
    expect(scanReportDate("2026-06-15T23:00:00.000Z", fallback)).toBe("2026-06-15");
    expect(scanReportDate(undefined, fallback)).toBe("2026-07-25");
    expect(localDateOnly(dateOnlyToLocalDate("2026-06-15"))).toBe("2026-06-15");
  });
});

function row(id: string, included: boolean, value: number): BodyCompositionDraftRow {
  return {
    id,
    label: id,
    measurementCode: id,
    displayName: id,
    value,
    unit: "unit",
    confidence: included ? "high" : "low",
    included
  };
}

function editableRow(id: string, included: boolean, value: string): ScanReportEditableRow {
  return { ...row(id, included, 0), value };
}