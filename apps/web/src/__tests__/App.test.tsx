// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultMeasurementTypes, safetyNotice } from "@local-fitness-advisor/shared";
import { App } from "../App.js";

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers()
  } as Response;
}

beforeEach(() => {
  globalThis.history.replaceState({}, "", "/");
  global.fetch = vi.fn((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/bootstrap")) {
      return Promise.resolve(mockResponse({
        profile: { id: "self", displayName: "Local user", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
        measurementTypes: defaultMeasurementTypes,
        manualObservationGroupTemplates: [],
        counts: { imports: 0, observations: 0, samples: 0, activities: 0 }
      }));
    }
    if (url.includes("/api/profiles")) {
      return Promise.resolve(mockResponse({ profiles: [], activeProfileId: "self" }));
    }
    if (url.includes("/api/analytics")) {
      return Promise.resolve(mockResponse({
        counts: { imports: 0, observations: 0, samples: 0, activities: 0, insights: 0 },
        latestMetrics: [{
          code: "bmi",
          label: "BMI",
          value: 21.1,
          unit: "kg/m2",
          observedAt: "2026-01-01T00:00:00.000Z",
          status: "normal"
        }],
        trendCards: [],
        labAlerts: [{
          code: "ldl_cholesterol",
          marker: "LDL cholesterol",
          value: 3.02,
          unit: "mmol/L",
          observedAt: "2026-01-01T00:00:00.000Z",
          reference: "--3",
          flag: "high"
        }],
        evidenceDigest: []
      }));
    }
    if (url.includes("/api/summary/bmi")) {
      return Promise.resolve(mockResponse({
        generatedAt: "2026-01-01T00:00:00.000Z",
        measurement: {
          code: "bmi",
          displayName: "BMI",
          description: "A number calculated from your height and weight, used as a simple screening measure for weight status.",
          category: "body",
          counts: { observations: 1, samples: 0, activities: 0, total: 1 },
          lastMeasuredAt: "2026-01-01T00:00:00.000Z"
        },
        entries: [],
        chartPoints: [],
        counts: { observations: 1, samples: 0, activities: 0, total: 1 },
        deletion: { observationEntries: 1, deletableEntries: 1 },
        pagination: { limit: 100, loaded: 0, total: 1, hasMore: false }
      }));
    }
    if (url.includes("/api/summary/ldl_cholesterol")) {
      return Promise.resolve(mockResponse({
        generatedAt: "2026-01-01T00:00:00.000Z",
        measurement: {
          code: "ldl_cholesterol",
          displayName: "LDL cholesterol",
          category: "lab",
          counts: { observations: 1, samples: 0, activities: 0, total: 1 },
          lastMeasuredAt: "2026-01-01T00:00:00.000Z"
        },
        entries: [],
        chartPoints: [],
        counts: { observations: 1, samples: 0, activities: 0, total: 1 },
        deletion: { observationEntries: 1, deletableEntries: 1 },
        pagination: { limit: 100, loaded: 0, total: 1, hasMore: false }
      }));
    }
    return Promise.resolve(mockResponse({}));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App smoke", () => {
  it("shows a measurement description directly below its name on the detail page", async () => {
    globalThis.history.replaceState({}, "", "/track/bmi");
    render(<App />);

    const heading = await screen.findByRole("heading", { name: "BMI" });
    const description = screen.getByText(
      "A number calculated from your height and weight, used as a simple screening measure for weight status."
    );
    expect(heading.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("bmi")).not.toBeInTheDocument();
  });

  it("renders the accessible application shell and primary navigation", () => {
    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /page navigation/i })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Dashboard", "Import", "Track", "Insights", "Export"
    ]);
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("supports arrow, Home, and End navigation across the route tablist", () => {
    render(<App />);
    const dashboard = screen.getByRole("tab", { name: "Dashboard" });
    dashboard.focus();

    fireEvent.keyDown(dashboard, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Import" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Import" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Import" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Export" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Export" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Dashboard" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Export" })).toHaveFocus();
  });

  it("starts from the bounded bootstrap contract without requesting the full store", async () => {
    render(<App />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/bootstrap", expect.anything()));
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).includes("/api/store"))).toBe(false);
  });

  it("keeps the safety disclaimer visible", () => {
    render(<App />);
    expect(screen.getByText(safetyNotice)).toBeInTheDocument();
  });

  it("reaches all import modes and uses the Lab results scan label", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    expect(screen.getByRole("tablist", { name: /import mode/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^manual$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /upload csv/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^scan$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /fitness tracker/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^scan$/i }));
    expect(screen.getByRole("option", { name: "Lab results" })).toHaveValue("blood-test");
  });

  it("supports keyboard navigation within Import and Insights tablists", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    const manual = screen.getByRole("tab", { name: /^manual$/i });
    manual.focus();
    fireEvent.keyDown(manual, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: /upload csv/i })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /upload csv/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /upload csv/i }), { key: "End" });
    expect(screen.getByRole("tab", { name: /fitness tracker/i })).toHaveFocus();

    fireEvent.click(screen.getByRole("tab", { name: /^insights$/i }));
    const biologicalAge = screen.getByRole("tab", { name: /biological age/i });
    biologicalAge.focus();
    fireEvent.keyDown(biologicalAge, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /ai query/i })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /ai query/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /ai query/i }), { key: "Home" });
    expect(screen.getByRole("tab", { name: /biological age/i })).toHaveFocus();
  });
});