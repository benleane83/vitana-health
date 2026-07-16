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
  it("renders the accessible application shell and primary navigation", () => {
    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /page navigation/i })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Dashboard", "Import", "Track", "Insights", "Export"
    ]);
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
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

  it("prioritizes profile freshness and latest data on the dashboard", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: /track\. understand\. thrive\./i })).toBeInTheDocument();
    expect(screen.getByLabelText(/data privacy and freshness/i)).toHaveTextContent("Private on this device");
    expect(screen.getByRole("heading", { name: /your latest data/i })).toBeInTheDocument();
    expect(screen.getByText("No focus set")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /encrypted local vault/i })).not.toBeInTheDocument();
  });

  it("opens measurement details from the latest data list", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /view details for bmi/i }));

    await waitFor(() => expect(window.location.pathname).toBe("/track/bmi"));
    expect(screen.getByRole("tab", { name: /^track$/i })).toHaveAttribute("aria-selected", "true");
  });

  it("opens measurement details from the lab range review", async () => {
    render(<App />);

    fireEvent.click(await screen.findByText("Explore trends, lab ranges, and AI review"));
    fireEvent.click(screen.getByRole("button", { name: /view details for ldl cholesterol/i }));

    await waitFor(() => expect(window.location.pathname).toBe("/track/ldl_cholesterol"));
    expect(await screen.findByRole("heading", { name: "LDL cholesterol" })).toBeInTheDocument();
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
});