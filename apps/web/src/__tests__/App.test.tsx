// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { App } from "../App.js";
import { safetyNotice } from "@local-fitness-advisor/shared";

// ─── Minimal fetch mock ────────────────────────────────────────────────────────

function makeEmptyStore() {
  return {
    profile: { id: "self", displayName: "Local user", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: [],
    observations: [],
    timeSeriesSamples: [],
    activitySessions: [],
    sleepSessions: [],
    sleepStageIntervals: [],
    labPanels: [],
    labMarkers: [],
    insights: [],
    auditEvents: []
  };
}

function makeEmptyAnalytics() {
  return {
    counts: { imports: 0, observations: 0, samples: 0, activities: 0, labMarkers: 0, insights: 0 },
    latestMetrics: [],
    trendCards: [],
    labAlerts: [],
    evidenceDigest: ["Imported 0 source file(s), 0 observations, and 0 tracker samples."]
  };
}

function mockFetch(urlResponses: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = Object.keys(urlResponses).find((k) => url.includes(k));
    const body = key !== undefined ? urlResponses[key] : {};
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body))
    } as Response);
  });
}

beforeEach(() => {
  global.fetch = mockFetch({
    "/api/store": makeEmptyStore(),
    "/api/analytics": makeEmptyAnalytics()
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Renders without crashing ─────────────────────────────────────────────────

describe("App — renders without crashing", () => {
  it("mounts the application", () => {
    const { container } = render(<App />);
    expect(container).toBeTruthy();
  });
});

// ─── Navigation landmarks ─────────────────────────────────────────────────────

describe("App — navigation landmarks", () => {
  it("renders a <main> element", () => {
    render(<App />);
    expect(document.querySelector("main")).not.toBeNull();
  });

  it("renders a <nav> element with accessible label", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: /page navigation/i });
    expect(nav).toBeInTheDocument();
  });

  it("renders the four main navigation tabs", () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /import/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /health data summary/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /ai query/i })).toBeInTheDocument();
  });
});

// ─── Safety notice visible ────────────────────────────────────────────────────

describe("App — safety notice", () => {
  it("renders the safety disclaimer text in the DOM", () => {
    render(<App />);
    expect(screen.getByText(safetyNotice)).toBeInTheDocument();
  });
});

// ─── Import tab navigation ────────────────────────────────────────────────────

describe("App — import tab", () => {
  it("navigates to the import tab when Import button is clicked", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    // Import source tabs should now be visible
    expect(screen.getByRole("tablist", { name: /import source/i })).toBeInTheDocument();
  });

  it("shows Labs and Fitness Tracker tabs in the import view", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    expect(screen.getByRole("tab", { name: /labs/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /fitness tracker/i })).toBeInTheDocument();
  });
});

// ─── No console errors on mount ───────────────────────────────────────────────

describe("App — no React errors", () => {
  it("does not throw during initial render", () => {
    expect(() => render(<App />)).not.toThrow();
  });
});
