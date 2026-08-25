// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { HealthDataSummary } from "@vitana/shared";
import { describe, expect, it, vi } from "vitest";
import { SummaryPage } from "./SummaryOverviewPage.js";

const summary: HealthDataSummary = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  totals: { observations: 4, samples: 0, activities: 1, total: 5, types: 4 },
  categories: [
    category("activity", "Activity", "Active energy burned", 1, 1),
    category("body", "Body", "Weight", 1, 1),
    category("cardio", "Cardio", "Heart rate", 1, 0),
    category("lab", "Lab", "Albumin", 1, 1),
    category("sleep", "Sleep", "Sleep duration", 1, 1),
    category("derived", "Derived", "BMI", 1, 0)
  ]
};

function category(
  key: "activity" | "body" | "cardio" | "lab" | "sleep" | "derived",
  label: string,
  displayName: string,
  observations: number,
  activities: number
) {
  const total = observations + activities;
  return {
    key,
    label,
    counts: { observations, samples: 0, activities, total, types: 1 },
    rows: [{
      code: key === "activity" ? "active_energy_burned" : key === "body" ? "weight" : key === "cardio" ? "heart_rate" : key === "lab" ? "albumin" : key === "sleep" ? "sleep_duration" : "bmi",
      displayName,
      category: key,
      counts: { observations, samples: 0, activities, total },
      lastMeasuredAt: "2026-01-01T00:00:00.000Z"
    }]
  };
}

function renderSummary(categoryFilter?: "activity" | "body" | "lab" | "sleep") {
  const onClearCategoryFilter = vi.fn();
  const onAddCategory = vi.fn();
  render(
    <SummaryPage
      summary={summary}
      loading={false}
      sort="recency"
      onSortChange={vi.fn()}
      expandedCategories={new Set(summary.categories.map((category) => category.key))}
      onToggleCategory={vi.fn()}
      onSelectRow={vi.fn()}
      categoryFilter={categoryFilter}
      onClearCategoryFilter={onClearCategoryFilter}
      onAddCategory={onAddCategory}
    />
  );
  return { onAddCategory, onClearCategoryFilter };
}

describe("SummaryPage category navigation", () => {
  it("filters to the selected category and clears the filter", () => {
    const { onClearCategoryFilter } = renderSummary("body");

    expect(screen.getByText("Showing Body")).toBeInTheDocument();
    expect(screen.getByText("Body", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("Activity", { selector: "strong" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onClearCategoryFilter).toHaveBeenCalledOnce();
  });

  it("offers category-specific import actions but not Sleep actions", () => {
    const { onAddCategory } = renderSummary();

    fireEvent.click(screen.getByRole("button", { name: "Add Body data" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Upload" }));

    expect(onAddCategory).toHaveBeenCalledWith("body", "upload");
    expect(screen.queryByRole("button", { name: "Add Sleep data" })).not.toBeInTheDocument();
  });

  it("shows dashboard category icons where assets are available", () => {
    renderSummary();

    expect(document.querySelectorAll(".summary-category-title img")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Cardio 1 types / 1 entries" }).querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Derived 1 types / 1 entries" }).querySelector("img")).toBeNull();
    expect(document.querySelector(".summary-category-title img[src='/images/profile-navigation/activity.png']")).toBeInTheDocument();
    expect(document.querySelector(".summary-category-title img[src='/images/profile-navigation/body-composition.png']")).toBeInTheDocument();
    expect(document.querySelector(".summary-category-title img[src='/images/profile-navigation/lab-results.png']")).toBeInTheDocument();
    expect(document.querySelector(".summary-category-title img[src='/images/profile-navigation/sleep.png']")).toBeInTheDocument();
  });
});
