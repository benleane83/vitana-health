// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { App } from "../App.js";
import { defaultMeasurementTypes, safetyNotice, type HealthStoreData } from "@local-fitness-advisor/shared";

// ─── Minimal fetch mock ────────────────────────────────────────────────────────

function makeEmptyStore(): HealthStoreData {
  return {
    schemaVersion: 2,
    profile: { id: "self", displayName: "Local user", units: "metric", updatedAt: "2026-01-01T00:00:00.000Z" },
    sourceImports: [],
    dataSources: [],
    devices: [],
    measurementTypes: [],
    observations: [],
    observationGroups: [],
    timeSeriesSamples: [],
    activitySessions: [],
    insights: [],
    auditEvents: []
  };
}

function makeEmptyAnalytics() {
  return {
    counts: { imports: 0, observations: 0, samples: 0, activities: 0, insights: 0 },
    latestMetrics: [],
    trendCards: [],
    labAlerts: [],
    evidenceDigest: ["Imported 0 source file(s), 0 observations, and 0 tracker samples."]
  };
}

function makeBootstrap(store: ReturnType<typeof makeEmptyStore>) {
  const measurementsByCode = new Map(store.measurementTypes.map((measurement) => [measurement.code, measurement]));
  const groupsById = new Map(store.observationGroups.map((group) => [group.id, group]));
  const templatesByLabel = new Map<string, {
    label: string;
    normalizedLabel: string;
    measurements: Array<{ measurementCode: string; marker: string; unit: string }>;
  }>();
  for (const observation of store.observations) {
    const group = observation.observationGroupId ? groupsById.get(observation.observationGroupId) : undefined;
    if (!group || group.kind !== "custom") continue;
    const normalizedLabel = group.label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const template = templatesByLabel.get(normalizedLabel) ?? {
      label: group.label.trim(),
      normalizedLabel,
      measurements: []
    };
    if (!template.measurements.some((measurement) => measurement.measurementCode === observation.measurementCode)) {
      const measurement = measurementsByCode.get(observation.measurementCode);
      template.measurements.push({
        measurementCode: observation.measurementCode,
        marker: measurement?.display ?? observation.measurementCode,
        unit: measurement?.canonicalUnit ?? observation.unit
      });
    }
    templatesByLabel.set(normalizedLabel, template);
  }
  return {
    profile: store.profile,
    measurementTypes: store.measurementTypes,
    manualObservationGroupTemplates: [...templatesByLabel.values()],
    latestInsight: store.insights[0],
    counts: {
      imports: store.sourceImports.length,
      observations: store.observations.length,
      samples: store.timeSeriesSamples.length,
      activities: store.activitySessions.length
    }
  };
}

function mockFetch(urlResponses: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = Object.keys(urlResponses).find((k) => url.includes(k));
    const body = key !== undefined
      ? urlResponses[key]
      : url.includes("/api/bootstrap")
        ? makeBootstrap((urlResponses["/api/store"] ?? makeEmptyStore()) as ReturnType<typeof makeEmptyStore>)
        : {};
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      blob: () => Promise.resolve(body instanceof Blob ? body : new Blob([JSON.stringify(body)])),
      headers: new Headers({ "content-disposition": 'attachment; filename="health-report.pdf"' })
    } as Response);
  });
}

beforeEach(() => {
  global.fetch = mockFetch({
    "/api/store": makeEmptyStore(),
    "/api/analytics": makeEmptyAnalytics(),
    "/api/profiles": { profiles: [], activeProfileId: "self" }
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

  it("renders the Vitara dashboard brand lockup", () => {
    render(<App />);
    expect(screen.getByText(/all your health\. in one place\./i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /track\. understand\. thrive\./i })).toBeInTheDocument();
  });

  it("does not request the full store during startup", async () => {
    render(<App />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/bootstrap", expect.anything()));
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).includes("/api/store"))).toBe(false);
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

  it("renders the main navigation tabs", () => {
    render(<App />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Dashboard",
      "Import",
      "Track",
      "Insights",
      "Export"
    ]);
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("loads the Biological Age page", async () => {
    global.fetch = mockFetch({
      "/api/store": makeEmptyStore(),
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" },
      "/api/biological-age": {
        generatedAt: "2026-01-01T00:00:00Z",
        disclaimer: "Wellness only.",
        models: [{
          id: "phenoage-levine-2018", name: "PhenoAge", version: "Levine 2018", status: "incomplete",
          methodology: "Published model.", citation: "Citation.", inputs: [], limitations: ["No inputs."]
        }]
      }
    });
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^insights$/i }));
    fireEvent.click(screen.getByRole("tab", { name: /biological age/i }));
    expect(await screen.findByRole("heading", { name: /biological age/i })).toBeInTheDocument();
    expect(screen.getByText(/incomplete data/i)).toBeInTheDocument();
  });

  it("opens the AI setup screen from Settings", async () => {
    global.fetch = mockFetch({
      "/api/store": makeEmptyStore(),
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" },
      "/api/settings/ai": {
        provider: "ollama",
        endpoint: "http://127.0.0.1:11434/api/generate",
        model: "llama3.2",
        timeoutMs: 30000,
        hasApiKey: false
      }
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(await screen.findByRole("heading", { name: /ai setup/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/endpoint url/i)).toHaveValue("http://127.0.0.1:11434/api/generate");
    expect(screen.getByRole("button", { name: /connect openrouter/i })).toBeInTheDocument();
  });

  describe("App — PDF export", () => {
    it("downloads the PDF report from the Export page", async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:report"), revokeObjectURL: vi.fn() });
      global.fetch = mockFetch({
        "/api/store": makeEmptyStore(),
        "/api/analytics": makeEmptyAnalytics(),
        "/api/profiles": { profiles: [], activeProfileId: "self" },
        "/api/export/pdf": new Blob(["%PDF-test"], { type: "application/pdf" })
      });

      render(<App />);
      fireEvent.click(screen.getByRole("tab", { name: /^export$/i }));
      fireEvent.click(screen.getByRole("button", { name: /download pdf report/i }));

      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/export/pdf",
        expect.objectContaining({ credentials: "include" })
      );
    });
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
    expect(screen.getByRole("tablist", { name: /import mode/i })).toBeInTheDocument();
  });

  it("shows the four import modes", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    expect(screen.getByRole("tab", { name: /^manual$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /upload csv/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^scan$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /fitness tracker/i })).toBeInTheDocument();
  });

  it("uses category-backed groups to initialize and filter manual rows", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));

    const observationGroup = screen.getByRole("combobox", { name: /observation group/i });
    expect(observationGroup).toHaveValue("Activity");
    expect([...observationGroup.querySelectorAll("option")].map((option) => option.getAttribute("value")))
      .toEqual(["Activity", "Body", "Lab", "__custom__"]);
    expect([...observationGroup.querySelectorAll("option")].map((option) => option.textContent))
      .toEqual(["Activity", "Body", "Lab", "Custom group"]);

    let measurement = screen.getByRole("combobox", { name: /row 1: select known measurement/i });
    expect(measurement).toHaveValue("steps");
    expect(measurement.querySelector('option[value="weight"]')).toBeNull();
    expect(measurement.querySelector('option[value="glucose"]')).toBeNull();

    fireEvent.change(observationGroup, { target: { value: "Body" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: /row 1: select known measurement/i })).toHaveValue("weight"));
    measurement = screen.getByRole("combobox", { name: /row 1: select known measurement/i });
    expect(measurement).toHaveValue("weight");
    expect(measurement.querySelector('option[value="steps"]')).toBeNull();
    expect(measurement.querySelector('option[value="glucose"]')).toBeNull();

    fireEvent.change(observationGroup, { target: { value: "Lab" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: /row 1: select known measurement/i })).toHaveValue("glucose"));
    measurement = screen.getByRole("combobox", { name: /row 1: select known measurement/i });
    expect(measurement).toHaveValue("glucose");
    expect(measurement.querySelector('option[value="weight"]')).toBeNull();

    fireEvent.change(observationGroup, { target: { value: "__custom__" } });
    const customObservationGroup = screen.getByRole("textbox", { name: /custom observation group/i });
    fireEvent.change(customObservationGroup, { target: { value: "Post-workout check-in" } });
    expect(customObservationGroup).toHaveValue("Post-workout check-in");
    measurement = screen.getByRole("combobox", { name: /row 1: select known measurement/i });
    expect([...measurement.querySelectorAll("optgroup")].map((group) => group.getAttribute("label")))
      .toEqual(["Activity", "Body", "Cardio", "Derived", "Lab", "Sleep"]);
  });

  it("preloads blank rows for every measurement previously used by a custom group", async () => {
    global.fetch = mockFetch({
      "/api/store": {
        ...makeEmptyStore(),
        measurementTypes: defaultMeasurementTypes,
        observationGroups: [
          { id: "group-1", kind: "custom", label: "Morning metrics" },
          { id: "group-2", kind: "custom", label: "  MORNING   METRICS  " },
          { id: "group-empty", kind: "custom", label: "Deleted measurements" }
        ],
        observations: [
          { id: "obs-1", measurementCode: "weight", observedAt: "2026-01-01", value: 80, unit: "kg", sourceId: "source-1", observationGroupId: "group-1" },
          { id: "obs-2", measurementCode: "body_fat_pct", observedAt: "2026-01-01", value: 20, unit: "%", sourceId: "source-1", observationGroupId: "group-1" },
          { id: "obs-3", measurementCode: "custom_score", observedAt: "2026-01-02", value: 7, unit: "points", sourceId: "source-2", observationGroupId: "group-2" }
        ]
      },
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    const observationGroup = screen.getByRole("combobox", { name: /observation group/i });
    await waitFor(() => expect(observationGroup.querySelector('option[value="Morning metrics"]')).not.toBeNull());
    expect(observationGroup.querySelector('option[value="Deleted measurements"]')).toBeNull();

    fireEvent.change(observationGroup, { target: { value: "Morning metrics" } });
    const measurements = screen.getAllByRole("combobox", { name: /select known measurement/i });
    expect(measurements).toHaveLength(3);
    expect(measurements.map((measurement) => (measurement as HTMLSelectElement).value))
      .toEqual(["body_fat_pct", "", "weight"]);
    expect(screen.getByRole("textbox", { name: /row 2 measurement name/i })).toHaveValue("custom_score");
    expect(screen.getByRole("textbox", { name: /row 2 measurement code/i })).toHaveValue("custom_score");
    expect(screen.getByRole("textbox", { name: /row 1 value/i })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /row 3 value/i })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /row 2 unit/i })).toHaveValue("points");
    expect(measurements[0]?.querySelector('option[value="weight"]')).not.toBeNull();
    expect(measurements[0]?.querySelector('option[value="glucose"]')).toBeNull();
  });

  it("offers to save additional default-group rows as a custom group before importing", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /row 1 value/i }), { target: { value: "100" } });
    const measurements = screen.getAllByRole("combobox", { name: /select known measurement/i });
    fireEvent.change(measurements[1]!, { target: { value: "distance" } });
    fireEvent.change(screen.getByRole("textbox", { name: /row 2 value/i }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /^import observations$/i }));

    expect(screen.getByRole("heading", { name: /save this measurement set/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import without saving/i })).toBeInTheDocument();

    const groupName = screen.getByRole("textbox", { name: /custom group name/i });
    fireEvent.change(groupName, { target: { value: "Weekend movement" } });
    fireEvent.click(screen.getByRole("button", { name: /save as custom group/i }));

    await waitFor(() => {
      const requests = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(requests.some(([url, init]) =>
        String(url).includes("/api/import/observations/manual") &&
        String(init?.body).includes('"label":"Weekend movement"')
      )).toBe(true);
    });
  });
});

// ─── No console errors on mount ───────────────────────────────────────────────

describe("App — no React errors", () => {
  it("does not throw during initial render", () => {
    expect(() => render(<App />)).not.toThrow();
  });
});
