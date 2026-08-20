// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HealthDataChartSeries, HealthDataDetail } from "@vitana/shared";
import { DetailTrendChart } from "./Charts.js";

const detail: HealthDataDetail = {
  generatedAt: "2026-07-15T00:00:00.000Z",
  isPinned: false,
  measurement: {
    code: "glucose",
    displayName: "Glucose",
    category: "lab",
    counts: { observations: 3, samples: 0, activities: 0, total: 3 },
    lastMeasuredAt: "2026-07-15T00:00:00.000Z"
  },
  referenceRange: { source: "none" },
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

const series: HealthDataChartSeries = {
  generatedAt: "2026-07-15T00:00:00.000Z",
  measurementCode: "glucose",
  range: "all",
  requestedMode: "auto",
  granularity: "daily",
  aggregation: "average",
  totalPoints: 3,
  truncated: false,
  points: detail.chartPoints.map((point) => ({
    timestamp: point.timestamp,
    value: point.value,
    unit: point.unit,
    count: 1,
    referenceRange: point.referenceRange
  }))
};

describe("DetailTrendChart", () => {
  it("renders time controls, point details, and a compatible reference range", () => {
    const onRangeChange = vi.fn();
    render(<DetailTrendChart detail={detail} series={series} range="all" mode="auto" busy={false} onRangeChange={onRangeChange} onModeChange={vi.fn()} />);

    expect(screen.getByRole("group", { name: /trend chart controls/i })).toBeInTheDocument();
    expect(screen.getByText(/reference range: 3.9–5.5 mmol\/l/i)).toBeInTheDocument();
    expect(screen.getByText(/ref\. low 3.9/i)).toBeInTheDocument();
    expect(screen.getByText(/ref\. high 5.5/i)).toBeInTheDocument();
    expect(document.querySelector(".summary-detail-optimal-band")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /chart range legend/i })).not.toBeInTheDocument();

    const chartPoints = document.querySelectorAll<SVGCircleElement>(".summary-detail-chart-hit-target");
    fireEvent.focus(chartPoints[2]!);
    expect(document.querySelector(".summary-detail-chart-tooltip")).toHaveTextContent(/daily bucket .* 5.2 mmol\/l/i);

    fireEvent.click(chartPoints[1]!);
    expect(document.querySelector(".summary-detail-chart-tooltip")).toHaveTextContent(/daily bucket .* 5.8 mmol\/l/i);

    fireEvent.click(screen.getByRole("button", { name: "1M" }));
    expect(onRangeChange).toHaveBeenCalledWith("1m");
    expect(screen.getByRole("button", { name: "Adaptive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Readings" })).toBeInTheDocument();
  });

  it("renders one nested optimal band and a conditional range legend", () => {
    const optimalSeries = {
      ...series,
      points: series.points.map((point) => ({
        ...point,
        optimalRange: { low: 4.4, high: 5.2, unit: "mmol/L" }
      }))
    };

    render(<DetailTrendChart detail={detail} series={optimalSeries} range="all" mode="auto" busy={false} onRangeChange={vi.fn()} onModeChange={vi.fn()} />);

    expect(document.querySelectorAll(".summary-detail-reference-band")).toHaveLength(1);
    expect(document.querySelectorAll(".summary-detail-optimal-band")).toHaveLength(1);
    expect(document.querySelectorAll(".summary-detail-reference-line")).toHaveLength(2);
    const legend = screen.getByLabelText(/chart range legend/i);
    expect(legend).toHaveTextContent("Normal range");
    expect(legend).toHaveTextContent("Optimal range");
    expect(screen.getByText(/optimal range: 4.4–5.2 mmol\/l/i)).toBeInTheDocument();
  });

  it("hides aggregation mode controls for latest measurements while retaining time controls", () => {
    const latestSeries = { ...series, aggregation: "latest" as const };

    render(<DetailTrendChart detail={detail} series={latestSeries} range="all" mode="auto" busy={false} onRangeChange={vi.fn()} onModeChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1M" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adaptive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Readings" })).not.toBeInTheDocument();
  });

  it("keeps time controls available when the selected range has no points", () => {
    const onRangeChange = vi.fn();
    const emptyRangeSeries = { ...series, range: "1m" as const, totalPoints: 0, points: [] };

    render(<DetailTrendChart detail={detail} series={emptyRangeSeries} range="1m" mode="auto" busy={false} onRangeChange={onRangeChange} onModeChange={vi.fn()} />);

    expect(screen.getByText(/no data available for the selected time period/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1M" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onRangeChange).toHaveBeenCalledWith("all");
  });

  it("renders duplicate readings as separate selectable points", () => {
    const duplicateSeries = { ...series, points: [series.points[2]!, series.points[2]!] };

    render(<DetailTrendChart detail={detail} series={duplicateSeries} range="all" mode="raw" busy={false} onRangeChange={vi.fn()} onModeChange={vi.fn()} />);

    expect(document.querySelectorAll(".summary-detail-chart-hit-target")).toHaveLength(2);
  });
});
