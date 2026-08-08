// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BodyTrendPoint } from "@vitana/shared";
import { BodyTrendChart } from "./BodyTrendChart.js";

const points: BodyTrendPoint[] = [
  {
    sessionId: "reading-1",
    date: "2026-07-01",
    observedAt: "2026-07-01T09:00:00.000Z",
    components: { muscleMass: 31.2, fatMass: 18.4, boneMineralContent: 3.1, weight: 69.8 }
  },
  {
    sessionId: "reading-2",
    date: "2026-08-01",
    observedAt: "2026-08-01T09:00:00.000Z",
    components: { muscleMass: 31.6, fatMass: 17.8, boneMineralContent: 3.1 }
  }
];

describe("BodyTrendChart", () => {
  it("renders component stacks and lets keyboard users select a dated reading", () => {
    const onSelect = vi.fn();
    render(<BodyTrendChart points={points} unit="kg" onSelect={onSelect} />);

    expect(document.querySelectorAll(".body-trend-muscle")).toHaveLength(3);
    expect(document.querySelectorAll(".body-trend-fat")).toHaveLength(3);
    expect(document.querySelectorAll(".body-trend-bone")).toHaveLength(3);
    expect(document.querySelectorAll(".body-trend-weight-line")).toHaveLength(1);
    expect(screen.getByRole("img", { name: /total mass for the selected range, from 52.5 to 69.8 kg/i })).toBeInTheDocument();
    expect(document.querySelector(".body-trend-chart-svg")).toHaveAttribute("width", "680");

    const targets = document.querySelectorAll<SVGRectElement>(".body-trend-hit-target");
    fireEvent.focus(targets[1]!);
    fireEvent.keyDown(targets[1]!, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("2026-08-01");
    expect(screen.getByText(/muscle mass, .*fat, .*bone mineral kg/i)).toBeInTheDocument();
  });
});