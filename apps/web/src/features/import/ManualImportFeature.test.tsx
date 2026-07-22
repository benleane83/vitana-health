import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualImportFeature } from "./ManualImportFeature.js";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("ManualImportFeature", () => {
  it("prefills a lab marker from a Biological Age add-result link", () => {
    window.history.replaceState({}, "", "/import/manual?group=Lab&marker=albumin");

    render(
      <ManualImportFeature
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Observation group")).toHaveValue("Lab");
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("albumin");
  });
});
