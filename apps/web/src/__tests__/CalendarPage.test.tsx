// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarPage, heatBuckets, buildMonthCells } from "../pages/CalendarPage.js";
import { localDayRange, preferredCalendarMeasurementCode } from "../features/track/CalendarRoute.js";

describe("calendar page helpers", () => {
  it("builds stable five and six week month grids", () => {
    const fiveWeek = buildMonthCells("2026-02", 0);
    const sixWeek = buildMonthCells("2026-08", 1);

    expect(fiveWeek).toHaveLength(35);
    expect(fiveWeek.filter((cell) => cell.inMonth)).toHaveLength(28);
    expect(sixWeek).toHaveLength(42);
    expect(sixWeek.filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it("assigns adaptive monthly buckets without inventing missing values", () => {
    const point = (date: string, value: number) => ({
      date,
      value,
      measurementCode: "steps",
      unit: "count",
      count: 1,
      min: value,
      max: value,
      aggregation: "sum" as const,
      sources: ["Health Connect"]
    });
    const buckets = heatBuckets([
      point("2026-08-01", 10),
      point("2026-08-02", 10),
      point("2026-08-03", 30)
    ]);

    expect(buckets.get("2026-08-01")).toBe(1);
    expect(buckets.get("2026-08-02")).toBe(1);
    expect(buckets.get("2026-08-03")).toBe(5);
    expect(buckets.has("2026-08-04")).toBe(false);
  });

  it("creates DST-safe inclusive local day ranges", () => {
    expect(localDayRange("2026-03-08", "America/New_York")).toEqual({
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T03:59:59.999Z"
    });
    expect(localDayRange("2026-11-01", "America/New_York")).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T04:59:59.999Z"
    });
  });

  it("uses Steps as the default primary metric when it is recorded", () => {
    const measurement = (code: string, display: string) => ({
      code,
      display,
      description: display,
      category: "activity" as const,
      kind: "point" as const,
      canonicalUnit: "count",
      aliases: [],
      aggregation: "sum" as const
    });

    expect(preferredCalendarMeasurementCode(
      [measurement("weight", "Weight"), measurement("steps", "Steps")],
      [{ code: "weight", isPinned: true, observedAt: "2026-08-03T12:00:00.000Z" }]
    )).toBe("steps");
  });

  it("keeps selected-day detail available through disclosures", () => {
    render(
      <CalendarPage
        month="2026-08"
        data={{
          month: "2026-08",
          timezone: "America/New_York",
          measurements: [{
            date: "2026-08-03",
            measurementCode: "steps",
            value: 7_425,
            unit: "count",
            count: 2,
            min: 3_100,
            max: 7_425,
            aggregation: "sum",
            sources: ["Health Connect"]
          }],
          events: [{ date: "2026-08-03", count: 1, kinds: ["visit"] }]
        }}
        loading={false}
        availableMeasurements={[]}
        selectedMeasurements={[{
          code: "steps",
          display: "Steps",
          description: "Daily steps",
          category: "activity",
          kind: "point",
          canonicalUnit: "count",
          aliases: [],
          aggregation: "sum"
        }, {
          code: "weight",
          display: "Weight",
          description: "Body weight",
          category: "body",
          kind: "point",
          canonicalUnit: "kg",
          aliases: [],
          aggregation: "latest"
        }]}
        selectedDate="2026-08-03"
        today="2026-08-03"
        eventDetails={[{
          id: "event-1",
          kind: "visit",
          status: "completed",
          occurredAt: "2026-08-03T14:00:00.000Z",
          source: "manual-entry",
          provider: "Northside Clinic",
          notes: "Annual review"
        }]}
        eventLoading={false}
        onPreviousMonth={vi.fn()}
        onNextMonth={vi.fn()}
        onToday={vi.fn()}
        onAddMeasurement={vi.fn()}
        onRemoveMeasurement={vi.fn()}
        onPromoteMeasurement={vi.fn()}
        onSelectDate={vi.fn()}
        onRetry={vi.fn()}
        onRetryEvents={vi.fn()}
      />
    );

    const inspector = within(screen.getByRole("complementary"));
    expect(screen.queryByText("Selected metrics")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Make Weight primary")).toHaveAttribute("title", "Make Weight primary");
    expect(inspector.getByText("Steps")).toBeInTheDocument();
    expect(inspector.getByText("7,425")).toBeInTheDocument();
    expect(inspector.getByText("1 health event")).toBeInTheDocument();
    expect(inspector.getByText("Measurement details").closest("details")).not.toHaveAttribute("open");
    expect(inspector.getByText("1 health event").closest("details")).toHaveAttribute("open");
    expect(inspector.getByText("Health Connect")).toBeInTheDocument();
    expect(inspector.getByText("Provider: Northside Clinic")).toBeInTheDocument();
    expect(inspector.getByText("Annual review")).toBeInTheDocument();
  });
});
