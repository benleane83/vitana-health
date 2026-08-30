// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../api.js";
import { DashboardRoute } from "./DashboardRoute.js";

function careItem(id: string, title: string, dueStart: string) {
  return {
    id,
    title,
    dueStart,
    kind: "visit" as const,
    priority: "normal" as const,
    status: "open" as const
  };
}

function dateOffset(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function renderDashboard(onNavigateCare = vi.fn()) {
  render(
    <DashboardRoute
      profile={{ id: "self", displayName: "Local user", setupStatus: "complete", units: "metric", updatedAt: dateOffset(0) }}
      onEditProfile={vi.fn()}
      onNavigateSummary={vi.fn()}
      onNavigateMeasurement={vi.fn()}
      onNavigateCategory={vi.fn()}
      onNavigateCare={onNavigateCare}
    />
  );
  return onNavigateCare;
}

const analyticsWithTrend = {
  counts: { imports: 1, observations: 2, samples: 0, activities: 0, insights: 0, healthEvents: 0, careItems: 0 },
  latestMetrics: [],
  trendCards: [{
    code: "weight",
    label: "Weight",
    unit: "kg",
    points: [
      { date: "2026-08-01T00:00:00.000Z", value: 75 },
      { date: "2026-08-02T00:00:00.000Z", value: 74 }
    ],
    direction: "down" as const,
    summary: "Weight is down over the latest 2 reading(s)."
  }],
  labAlerts: [],
  rangeAlerts: [],
  evidenceDigest: []
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(api, "summary").mockResolvedValue({
    generatedAt: "2026-01-01T00:00:00.000Z",
    totals: { observations: 0, samples: 0, activities: 0, total: 0, types: 0 },
    categories: []
  });
});

describe("DashboardRoute upcoming care", () => {
  it("shows the requested category totals and routes a category row to Track", async () => {
    vi.spyOn(api.care, "listCareItems").mockResolvedValue({
      items: [], total: 0, offset: 0, limit: 3, hasMore: false
    });
    vi.spyOn(api, "summary").mockResolvedValue({
      generatedAt: "2026-01-01T00:00:00.000Z",
      totals: { observations: 5, samples: 0, activities: 2, total: 7, types: 4 },
      categories: [
        { key: "activity", label: "Activity", counts: { observations: 0, samples: 0, activities: 2, total: 2, types: 1 }, rows: [] },
        { key: "body", label: "Body", counts: { observations: 2, samples: 0, activities: 0, total: 2, types: 1 }, rows: [] },
        { key: "lab", label: "Lab", counts: { observations: 3, samples: 0, activities: 0, total: 3, types: 1 }, rows: [] },
        { key: "sleep", label: "Sleep", counts: { observations: 0, samples: 0, activities: 0, total: 0, types: 0 }, rows: [] }
      ]
    });
    const onNavigateCategory = vi.fn();

    render(
      <DashboardRoute
        profile={{ id: "self", displayName: "Local user", setupStatus: "complete", units: "metric", updatedAt: dateOffset(0) }}
        onEditProfile={vi.fn()}
        onNavigateSummary={vi.fn()}
        onNavigateMeasurement={vi.fn()}
        onNavigateCategory={onNavigateCategory}
        onNavigateCare={vi.fn()}
      />
    );

    expect(await screen.findByRole("button", { name: "View Body: 2 entries in Track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Lab Results: 3 entries in Track" })).toBeInTheDocument();
    expect(screen.queryByText("Observations")).not.toBeInTheDocument();
    expect(screen.queryByText("Samples")).not.toBeInTheDocument();
    for (const iconPath of [
      "/images/profile-navigation/activity.png",
      "/images/profile-navigation/body-composition.png",
      "/images/profile-navigation/lab-results.png",
      "/images/profile-navigation/sleep.png"
    ]) {
      expect(document.querySelector(`img[src="${iconPath}"]`)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "View Activities: 2 entries in Track" }));
    expect(onNavigateCategory).toHaveBeenCalledWith("activity");
  });

  it("opens measurement detail when a trend trace is selected", async () => {
    vi.spyOn(api.care, "listCareItems").mockResolvedValue({
      items: [], total: 0, offset: 0, limit: 3, hasMore: false
    });
    const onNavigateMeasurement = vi.fn();

    render(
      <DashboardRoute
        analytics={analyticsWithTrend}
        profile={{ id: "self", displayName: "Local user", setupStatus: "complete", units: "metric", updatedAt: dateOffset(0) }}
        onEditProfile={vi.fn()}
        onNavigateSummary={vi.fn()}
        onNavigateMeasurement={onNavigateMeasurement}
        onNavigateCategory={vi.fn()}
        onNavigateCare={vi.fn()}
      />
    );

    const trend = screen.getByRole("button", { name: "View details for Weight trend" });
    expect(trend).toHaveClass("trend", "trend-link");
    fireEvent.click(trend);

    expect(onNavigateMeasurement).toHaveBeenCalledWith("weight");
  });

  it("does not repeat the measurement name in trend descriptions", async () => {
    vi.spyOn(api.care, "listCareItems").mockResolvedValue({
      items: [], total: 0, offset: 0, limit: 3, hasMore: false
    });

    render(
      <DashboardRoute
        analytics={analyticsWithTrend}
        profile={{ id: "self", displayName: "Local user", setupStatus: "complete", units: "metric", updatedAt: dateOffset(0) }}
        onEditProfile={vi.fn()}
        onNavigateSummary={vi.fn()}
        onNavigateMeasurement={vi.fn()}
        onNavigateCategory={vi.fn()}
        onNavigateCare={vi.fn()}
      />
    );

    expect(screen.getByText("Weight", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("is down over the latest 2 reading(s).")).toBeInTheDocument();
    expect(screen.queryByText("Weight is down over the latest 2 reading(s).")).not.toBeInTheDocument();
  });

  it("uses category-neutral Range Review copy when no results are outside range", async () => {
    vi.spyOn(api.care, "listCareItems").mockResolvedValue({
      items: [], total: 0, offset: 0, limit: 3, hasMore: false
    });

    render(
      <DashboardRoute
        analytics={analyticsWithTrend}
        profile={{ id: "self", displayName: "Local user", setupStatus: "complete", units: "metric", updatedAt: dateOffset(0) }}
        onEditProfile={vi.fn()}
        onNavigateSummary={vi.fn()}
        onNavigateMeasurement={vi.fn()}
        onNavigateCategory={vi.fn()}
        onNavigateCare={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Range Review" })).toBeInTheDocument();
    expect(screen.queryByText("Stored results outside their recorded reference range")).not.toBeInTheDocument();
    expect(screen.getByText("No out-of-range results yet.")).toBeInTheDocument();
  });

  it("loads overdue and next-30-day items, caps the preview, and routes item actions", async () => {
    const listCareItems = vi.spyOn(api.care, "listCareItems").mockResolvedValue({
      items: [
        careItem("overdue", "Annual check-up", dateOffset(-2)),
        careItem("today", "Prescription review", dateOffset(0)),
        careItem("soon", "Dental cleaning", dateOffset(12))
      ],
      total: 4,
      offset: 0,
      limit: 3,
      hasMore: true
    });
    const onNavigateCare = renderDashboard();

    expect(await screen.findByText("4 items need attention in the next 30 days.")).toBeInTheDocument();
    const query = listCareItems.mock.calls[0]?.[0];
    expect(query).toMatchObject({ status: "open", limit: 3, offset: 0 });
    expect(new Date(query?.dueTo ?? 0).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(new Date(query?.dueTo ?? 0).getTime() - Date.now()).toBeLessThanOrEqual(31 * 86_400_000);

    const itemList = screen.getByText("Annual check-up").closest(".dashboard-care-items");
    expect(itemList).not.toBeNull();
    expect(within(itemList as HTMLElement).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Overdue by 2 days")).toBeInTheDocument();
    expect(screen.getByText("Due today")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Annual check-up.*Open in Care/i }));
    expect(onNavigateCare).toHaveBeenCalledWith("overdue");
    const upcomingCare = screen.getByRole("heading", { name: "Upcoming care" }).closest("section");
    expect(upcomingCare).not.toBeNull();
    fireEvent.click(within(upcomingCare as HTMLElement).getByRole("button", { name: /View all/i }));
    expect(onNavigateCare).toHaveBeenLastCalledWith();
  });

  it("shows a quiet clear state when nothing is due", async () => {
    vi.spyOn(api.care, "listCareItems").mockResolvedValue({
      items: [], total: 0, offset: 0, limit: 3, hasMore: false
    });

    renderDashboard();

    const clearMessage = await screen.findByText("Nothing due in the next 30 days.");
    expect(clearMessage.closest("[role='status']")).toBeInTheDocument();
    const upcomingCare = screen.getByRole("heading", { name: "Upcoming care" }).closest("section");
    expect(upcomingCare).not.toBeNull();
    expect(within(upcomingCare as HTMLElement).queryByRole("button", { name: /View all/i })).not.toBeInTheDocument();
  });

  it("keeps the Dashboard usable and retries a failed care request", async () => {
    const listCareItems = vi.spyOn(api.care, "listCareItems")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 3, hasMore: false });

    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent("Upcoming care could not be loaded.");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(listCareItems).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Nothing due in the next 30 days.")).toBeInTheDocument();
  });
});