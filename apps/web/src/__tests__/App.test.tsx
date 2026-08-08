// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { defaultMeasurementTypes, safetyNotice } from "@vitana/shared";
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
        counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 0 }
      }));
    }
    if (url.includes("/api/profiles")) {
      return Promise.resolve(mockResponse({ profiles: [], activeProfileId: "self" }));
    }
    if (url.includes("/api/entitlement")) {
      return Promise.resolve(mockResponse({ tier: "free", source: null, overridden: false }));
    }
    if (url.includes("/api/analytics")) {
      return Promise.resolve(mockResponse({
        counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 0, insights: 0 },
        latestMetrics: [{
          code: "bmi",
          label: "BMI",
          value: 21.1,
          unit: "kg/m2",
          observedAt: "2026-01-01T00:00:00.000Z",
          status: "normal",
          isPinned: false
        }],
        trendCards: [],
        labAlerts: [{
          code: "ldl_cholesterol",
          marker: "LDL cholesterol",
          value: 31.13248797551377,
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
        isPinned: false,
        referenceRange: { source: "none" },
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
        isPinned: false,
        referenceRange: { source: "none" },
        counts: { observations: 1, samples: 0, activities: 0, total: 1 },
        deletion: { observationEntries: 1, deletableEntries: 1 },
        pagination: { limit: 100, loaded: 0, total: 1, hasMore: false }
      }));
    }
    if (url.includes("/api/calendar")) {
      const parsed = new URL(url, window.location.origin);
      return Promise.resolve(mockResponse({
        month: parsed.searchParams.get("month"),
        timezone: parsed.searchParams.get("timezone"),
        measurements: [],
        events: []
      }));
    }
    if (url.includes("/api/journal")) {
      const parsed = new URL(url, window.location.origin);
      return Promise.resolve(mockResponse({
        timezone: parsed.searchParams.get("timezone"),
        days: []
      }));
    }
    if (url.includes("/api/body-trend/2026-08-01")) {
      return Promise.resolve(mockResponse({
        date: "2026-08-01",
        timezone: "UTC",
        selectedSession: {
          sessionId: "body-reading-1",
          observedAt: "2026-08-01T09:00:00.000Z",
          sourceLabel: "Body composition scale",
          metrics: [{
            id: "muscle-1",
            measurementCode: "skeletal_muscle_mass",
            displayName: "Skeletal muscle mass",
            value: 31.6,
            unit: "kg",
            observedAt: "2026-08-01T09:00:00.000Z"
          }]
        },
        otherReadings: []
      }));
    }
    if (url.includes("/api/body-trend?")) {
      return Promise.resolve(mockResponse({
        generatedAt: "2026-08-01T10:00:00.000Z",
        range: "all",
        timezone: "UTC",
        unit: "kg",
        points: [{
          sessionId: "body-reading-1",
          date: "2026-08-01",
          observedAt: "2026-08-01T09:00:00.000Z",
          sourceLabel: "Body composition scale",
          components: { muscleMass: 31.6, fatMass: 17.8, boneMineralContent: 3.1, weight: 68.8 }
        }],
        totalPoints: 1,
        truncated: false
      }));
    }
    if (url.includes("/api/care/health-events")) {
      return Promise.resolve(mockResponse({ items: [], total: 0, offset: 0, limit: 20, hasMore: false }));
    }
    if (url.includes("/api/care/items")) {
      return Promise.resolve(mockResponse({ items: [], total: 0, offset: 0, limit: 20, hasMore: false }));
    }
    if (url.includes("/api/settings/desktop")) {
      return Promise.resolve(mockResponse({ supported: false, backgroundServiceEnabled: false }));
    }
    if (url.includes("/api/settings/ai")) {
      return Promise.resolve(mockResponse({
        provider: "ollama",
        endpoint: "http://127.0.0.1:11434/api/generate",
        model: "llama3.2",
        timeoutMs: 30000,
        hasApiKey: false
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
  it("orders Track tabs with Journal after Measurements and follows that order by keyboard", async () => {
    globalThis.history.replaceState({}, "", "/track");
    render(<App />);

    const trackTabs = within(screen.getByRole("tablist", { name: "Track views" }));
    expect(trackTabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Measurements",
      "Journal",
      "Calendar",
      "Body Trend"
    ]);

    fireEvent.keyDown(trackTabs.getByRole("tab", { name: "Measurements" }), { key: "ArrowRight" });

    expect(trackTabs.getByRole("tab", { name: "Journal" })).toHaveAttribute("aria-selected", "true");
  });

  it("routes a Body Trend date deep link without requesting a matching summary detail", async () => {
    globalThis.history.replaceState({}, "", "/track/body-trend/2026-08-01");
    render(<App />);

    expect(screen.getByRole("tab", { name: /^body trend$/i })).toHaveAttribute("aria-selected", "true");
    const detailHeading = await screen.findByRole("heading", { level: 2, name: /2026/ });
    expect(detailHeading).toHaveTextContent(/\d{1,2}:\d{2}/);
    expect(screen.queryByText("Body composition scale")).not.toBeInTheDocument();
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url))).not.toContain("/api/summary/body-trend/2026-08-01");
  });

  it("routes Track calendar as a subview and restores it on popstate", async () => {
    globalThis.history.replaceState({}, "", "/track/calendar");
    render(<App />);

    expect(screen.getByRole("tab", { name: /^track$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^calendar$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Track", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Calendar", level: 2 })).toBeInTheDocument();

    await act(async () => {
      globalThis.history.pushState({}, "", "/track");
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByRole("tab", { name: /^measurements$/i })).toHaveAttribute("aria-selected", "true"));

    await act(async () => {
      globalThis.history.pushState({}, "", "/track/calendar");
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByRole("tab", { name: /^calendar$/i })).toHaveAttribute("aria-selected", "true"));
  });

  it("routes Track Journal as a subview and restores it on popstate", async () => {
    globalThis.history.replaceState({}, "", "/track/journal");
    render(<App />);

    expect(screen.getByRole("tab", { name: /^journal$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Track", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Journal", level: 2 })).toBeInTheDocument();

    await act(async () => {
      globalThis.history.pushState({}, "", "/track");
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByRole("tab", { name: /^measurements$/i })).toHaveAttribute("aria-selected", "true"));

    await act(async () => {
      globalThis.history.pushState({}, "", "/track/journal");
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByRole("tab", { name: /^journal$/i })).toHaveAttribute("aria-selected", "true"));
  });

  it("clears notices when navigating to a different page", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const defaultFetch = fetchMock.getMockImplementation() as ((input: string | URL | Request, init?: RequestInit) => Promise<Response>);
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes("/api/bootstrap")
        ? Promise.reject(new Error("Offline"))
        : defaultFetch!(input, init);
    });
    render(<App />);

    expect(await screen.findByText("Offline")).toHaveClass("notice-message");
    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("formats lab range review values to at most two decimal places", async () => {
    render(<App />);

    expect(await screen.findByText("Explore trends and lab ranges")).toBeInTheDocument();
    expect(screen.getByText("31.13 mmol/L")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ldl cholesterol, 31\.13 mmol\/l/i })).toBeInTheDocument();
    expect(screen.queryByText(/31\.13248797551377/)).not.toBeInTheDocument();
  });

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
      "Dashboard", "Import", "Track", "Care", "Insights", "Export"
    ]);
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("routes Settings App and AI views with accessible roving tabs", async () => {
    globalThis.history.replaceState({}, "", "/settings");
    render(<App />);
    const appTab = screen.getByRole("tab", { name: "App" });
    const aiTab = screen.getByRole("tab", { name: "AI" });
    expect(appTab).toHaveAttribute("aria-selected", "true");
    expect(appTab).toHaveAttribute("aria-controls", "settings-panel-app");
    expect(aiTab).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(appTab, { key: "ArrowRight" });
    expect(aiTab).toHaveFocus();
    expect(aiTab).toHaveAttribute("aria-selected", "true");
    expect(globalThis.location.pathname).toBe("/settings/ai");
    expect(await screen.findByRole("heading", { name: /ai setup/i })).toBeInTheDocument();

    globalThis.history.pushState({}, "", "/settings/app");
    fireEvent.popState(window);
    expect(screen.getByRole("tab", { name: "App" })).toHaveAttribute("aria-selected", "true");
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
    globalThis.history.replaceState({}, "", "/insights/ai-review");
    render(<App />);
    expect(screen.getByText(safetyNotice)).toBeInTheDocument();
  });

  it("reaches all import modes and navigates to the canonical upload/sync routes", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    expect(screen.getByRole("tablist", { name: /import mode/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^manual$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^upload$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^sync$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^upload$/i }));
    expect(globalThis.location.pathname).toBe("/import/upload");

    fireEvent.click(screen.getByRole("tab", { name: /^sync$/i }));
    expect(globalThis.location.pathname).toBe("/import/sync");
  });

  it("keeps PDF and image report imports available in the unified Upload tab", () => {
    globalThis.history.replaceState({}, "", "/import/upload");
    render(<App />);
    expect([...screen.getByLabelText("Upload type").querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Body composition report",
      "Lab results report",
      "CSV or TSV observations"
    ]);
    fireEvent.change(screen.getByLabelText("Upload type"), {
      target: { value: "body-composition" }
    });
    expect(screen.getByLabelText("Select body composition report").getAttribute("accept"))
      .toContain("application/pdf");
    expect(screen.getByRole("button", { name: "Preview report" })).toBeInTheDocument();
  });

  it("supports keyboard navigation within Import and Insights tablists", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    const manual = screen.getByRole("tab", { name: /^manual$/i });
    manual.focus();
    fireEvent.keyDown(manual, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: /^upload$/i })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /^upload$/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /^upload$/i }), { key: "End" });
    expect(screen.getByRole("tab", { name: /^sync$/i })).toHaveFocus();

    fireEvent.click(screen.getByRole("tab", { name: /^insights$/i }));
    const biologicalAge = screen.getByRole("tab", { name: /biological age/i });
    biologicalAge.focus();
    fireEvent.keyDown(biologicalAge, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /ai review/i })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /ai review/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /ai review/i }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /ai query/i })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /ai query/i })).toHaveAttribute("aria-selected", "true");
    expect(globalThis.location.pathname).toBe("/insights/ai-query");
    fireEvent.keyDown(screen.getByRole("tab", { name: /ai query/i }), { key: "Home" });
    expect(screen.getByRole("tab", { name: /biological age/i })).toHaveFocus();
  });

  it("routes to the Care page and shows its two-view switch", () => {
    globalThis.history.replaceState({}, "", "/care/items");
    render(<App />);
    expect(screen.getByRole("tab", { name: /^care$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tablist", { name: /care views/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add care item/i })).toBeInTheDocument();
  });
});