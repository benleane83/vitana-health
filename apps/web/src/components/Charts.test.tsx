// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HealthDataDetail } from "@local-fitness-advisor/shared";
import { DetailTrendChart } from "./Charts.js";

const detail: HealthDataDetail = {
  generatedAt: "2026-07-15T00:00:00.000Z",
  measurement: {
    code: "glucose",
    displayName: "Glucose",
    category: "lab",
    counts: { observations: 3, samples: 0, activities: 0, total: 3 },
    lastMeasuredAt: "2026-07-15T00:00:00.000Z"
  },
  entries: [],
  chartPoints: [
    {
      kind: "observation",
      timestamp: "2025-01-15T00:00:00.000Z",
      value: 5.4,
      unit: "mmol/L",
      referenceRange: { low: 3.9, high: 5.5, unit: "mmol/L" }
    },
    {
      kind: "observation",
      timestamp: "2026-04-15T00:00:00.000Z",
      value: 5.8,
      unit: "mmol/L",
      referenceRange: { low: 3.9, high: 5.5, unit: "mmol/L" }
    },
    {
      kind: "observation",
      timestamp: "2026-07-15T00:00:00.000Z",
      value: 5.2,
      unit: "mmol/L",
      referenceRange: { low: 3.9, high: 5.5, unit: "mmol/L" }
    }
  ],
  counts: { observations: 3, samples: 0, activities: 0, total: 3 },
  deletion: { observationEntries: 3, deletableEntries: 3 },
  pagination: { limit: 50, loaded: 3, total: 3, hasMore: false }
};

describe("DetailTrendChart", () => {
  it("renders time controls, point details, and a compatible reference range", () => {
    render(<DetailTrendChart detail={detail} />);

    expect(screen.getByRole("group", { name: /trend time range/i })).toBeInTheDocument();
    expect(screen.getByText(/reference range: 3.9–5.5 mmol\/l/i)).toBeInTheDocument();
    expect(screen.getByText(/ref\. low 3.9/i)).toBeInTheDocument();
    expect(screen.getByText(/ref\. high 5.5/i)).toBeInTheDocument();

    const chartPoints = document.querySelectorAll<SVGCircleElement>(".summary-detail-chart-dot");
    fireEvent.focus(chartPoints[2]!);
    expect(document.querySelector(".summary-detail-chart-tooltip")).toHaveTextContent(/observation .* 5.2 mmol\/l/i);

    fireEvent.click(screen.getByRole("button", { name: "1M" }));
    expect(screen.getByRole("img", { name: /1 readings/i })).toBeInTheDocument();
  });
});
