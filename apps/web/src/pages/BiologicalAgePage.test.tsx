import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BiologicalAgeReport } from "@vitana/shared";
import { BiologicalAgePage } from "./BiologicalAgePage.js";

const incompleteReport: BiologicalAgeReport = {
  generatedAt: "2026-07-22T00:00:00Z",
  disclaimer: "Informational wellness estimate only.",
  models: [{
    id: "phenoage-levine-2018",
    name: "PhenoAge",
    version: "Levine 2018",
    status: "incomplete",
    methodology: "A published wellness measure using routine blood markers.",
    citation: "Not displayed.",
    limitations: [],
    inputs: [
      { code: "albumin", label: "Albumin", normalizedUnit: "g/L", status: "missing" },
      {
        code: "glucose",
        label: "Glucose",
        normalizedUnit: "mmol/L",
        value: 5.4,
        unit: "mmol/L",
        normalizedValue: 5.4,
        status: "used"
      },
      {
        code: "white_blood_cell_count",
        label: "White blood cell count",
        normalizedUnit: "10³/µL",
        value: 500,
        unit: "10³/µL",
        status: "invalid",
        detail: "Outside the usable range."
      }
    ]
  }]
};

describe("BiologicalAgePage", () => {
  it("puts readiness and actionable missing inputs directly below the method", () => {
    render(<BiologicalAgePage report={incompleteReport} loading={false} />);

    const methodHeading = screen.getByRole("heading", { name: "PhenoAge" });
    const inputsHeading = screen.getByRole("heading", { name: "Review required inputs (3)" });
    expect(methodHeading.compareDocumentPosition(inputsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(inputsHeading.parentElement!).getByText("Needs more data")).toBeInTheDocument();
    expect(screen.getByText("Missing or unusable (2): Albumin, White blood cell count.")).toBeInTheDocument();

    const albuminRow = screen.getByText("Albumin").closest("tr")!;
    expect(within(albuminRow).getByText("Missing")).toBeInTheDocument();
    expect(within(albuminRow).getByText("No saved result found.")).toBeInTheDocument();
    expect(within(albuminRow).getByText("Liver function / metabolic panel")).toBeInTheDocument();
    expect(within(albuminRow).getByRole("link", { name: "Add result" })).toHaveAttribute(
      "href",
      "/import/manual?group=Lab&marker=albumin"
    );

    expect(screen.queryByText("Evidence readiness")).not.toBeInTheDocument();
    expect(screen.queryByText("Method reference")).not.toBeInTheDocument();
    expect(screen.queryByText("Important context")).not.toBeInTheDocument();
  });

  it("links to the routine blood-marker research and keeps the disclaimer last", () => {
    render(<BiologicalAgePage report={incompleteReport} loading={false} />);

    expect(screen.getByRole("link", { name: "Read the scientific research" })).toHaveAttribute(
      "href",
      "https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.1002718"
    );
    expect(screen.getByRole("link", { name: "Read the scientific research" })).toHaveAttribute("target", "_blank");

    const inputsHeading = screen.getByRole("heading", { name: "Review required inputs (3)" });
    const disclaimerHeading = screen.getByRole("heading", { name: "Important information" });
    expect(inputsHeading.compareDocumentPosition(disclaimerHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
