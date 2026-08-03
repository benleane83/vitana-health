// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { defaultMeasurementTypes } from "@vitana/shared";
import { describe, expect, it } from "vitest";
import type { UploadEditableRow } from "../types.js";
import { ImportDraftReview } from "./ImportDraftReview.js";

const initialRows: UploadEditableRow[] = [
  row("weight", "Weight", true, "high"),
  row("unknown-a", "Unknown A", false, "low"),
  row("heart_rate", "Heart rate", true, "high"),
  row("unknown-b", "Unknown B", false, "low")
];

describe("ImportDraftReview", () => {
  it("groups selected rows first while preserving source order and numbering", () => {
    render(<ReviewHarness initialRows={initialRows} />);

    const selected = screen.getByRole("rowgroup", { name: "Selected for save, 2 measurements" });
    const notSelected = screen.getByRole("rowgroup", { name: "Not selected, 2 measurements" });

    expect(saveCheckboxLabels(selected)).toEqual([
      "Row 1: save Weight",
      "Row 3: save Heart rate"
    ]);
    expect(saveCheckboxLabels(notSelected)).toEqual([
      "Row 2: save Unknown A",
      "Row 4: save Unknown B"
    ]);
  });

  it("moves rows immediately when their selected state changes", () => {
    render(<ReviewHarness initialRows={initialRows} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Row 2: save Unknown A" }));

    const selected = screen.getByRole("rowgroup", { name: "Selected for save, 3 measurements" });
    const notSelected = screen.getByRole("rowgroup", { name: "Not selected, 1 measurement" });
    expect(saveCheckboxLabels(selected)).toEqual([
      "Row 1: save Weight",
      "Row 2: save Unknown A",
      "Row 3: save Heart rate"
    ]);
    expect(saveCheckboxLabels(notSelected)).toEqual(["Row 4: save Unknown B"]);
  });

  it("explains the empty selected group and disables saving", () => {
    render(<ReviewHarness initialRows={initialRows.map((entry) => ({ ...entry, included: false }))} />);

    expect(screen.getByRole("rowgroup", { name: "Selected for save, 0 measurements" }))
      .toHaveTextContent("Select at least one measurement to save it.");
    expect(screen.getByRole("button", { name: "Save approved rows" })).toBeDisabled();
  });

  it("shows display names without measurement codes in the known-measurement selector", () => {
    render(<ReviewHarness initialRows={initialRows} />);

    const combobox = screen.getByRole("combobox", { name: "Row 1 known measurement" });
    expect(combobox).toHaveValue("Weight");
    fireEvent.click(screen.getAllByRole("button", { name: "Open measurement choices" })[0]!);
    expect(screen.getByRole("option", { name: /Weight Body/ })).toBeInTheDocument();
    expect(screen.queryByText(/Weight \(weight\)/)).not.toBeInTheDocument();
  });

  it("keeps Add row at the bottom of the selected group", () => {
    render(<ReviewHarness initialRows={initialRows} />);

    const selected = screen.getByRole("rowgroup", { name: "Selected for save, 2 measurements" });
    expect(selected).toContainElement(screen.getByRole("button", { name: "Add row" }));
    expect(selected.lastElementChild).toHaveTextContent("Add row");
  });

  it("removes an empty manually added row when it is excluded", () => {
    const addedRow: UploadEditableRow = {
      ...row("manual", "Added measurement", true, "low"),
      value: "",
      manuallyAdded: true
    };
    render(<ReviewHarness initialRows={[...initialRows, addedRow]} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Row 5: save Added measurement" }));

    expect(screen.queryByRole("checkbox", { name: "Row 5: save Added measurement" })).not.toBeInTheDocument();
    expect(screen.getByRole("rowgroup", { name: "Selected for save, 2 measurements" })).toBeInTheDocument();
    expect(screen.getByRole("rowgroup", { name: "Not selected, 2 measurements" })).toBeInTheDocument();
  });
});

function ReviewHarness({ initialRows: startingRows }: { initialRows: UploadEditableRow[] }) {
  const [rows, setRows] = useState(startingRows);
  return (
    <ImportDraftReview
      fileName="report.pdf"
      diagnostics={[]}
      rowCount={rows.length}
      truncated={false}
      busy={false}
      rows={rows}
      measurementTypes={defaultMeasurementTypes}
      units="metric"
      onRowChange={(id, patch) => setRows((current) => current.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
      ))}
      onRemoveRow={(id) => setRows((current) => current.filter((entry) => entry.id !== id))}
      onAddRow={() => undefined}
      onCommit={(event) => event.preventDefault()}
    />
  );
}

function row(
  id: string,
  displayName: string,
  included: boolean,
  confidence: UploadEditableRow["confidence"]
): UploadEditableRow {
  return {
    id,
    label: displayName,
    measurementCode: id,
    displayName,
    value: "1",
    unit: "unit",
    confidence,
    included,
    generatedCode: !included
  };
}

function saveCheckboxLabels(container: HTMLElement): string[] {
  return within(container).getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label") ?? "");
}
