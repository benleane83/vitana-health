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
        latestMetrics: [],
        trendCards: [],
        labAlerts: [],
        evidenceDigest: []
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