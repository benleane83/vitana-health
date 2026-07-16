// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { App } from "../App.js";
import { defaultMeasurementTypes, type HealthStoreData } from "@local-fitness-advisor/shared";

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
  globalThis.history.replaceState({}, "", "/");
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
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

describe("App feature flows", () => {
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

  it("presents available Biological Age results without a redundant status label", async () => {
    global.fetch = mockFetch({
      "/api/store": makeEmptyStore(),
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" },
      "/api/biological-age": {
        generatedAt: "2026-07-14T00:00:00Z",
        disclaimer: "Wellness only.",
        models: [{
          id: "phenoage-levine-2018", name: "PhenoAge", version: "Levine 2018", status: "available",
          methodology: "Published model.", citation: "Citation.", inputs: [], limitations: ["No limitations."],
          chronologicalAge: 46, biologicalAge: 39.8, ageAcceleration: -6.2,
          panelCollectedAt: "2026-07-14T00:00:00.000Z"
        }]
      }
    });
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^insights$/i }));
    fireEvent.click(screen.getByRole("tab", { name: /biological age/i }));

    const selectedPanel = await screen.findByText(/Selected lab panel:/i);
    expect(screen.queryByText(/^Available$/i)).not.toBeInTheDocument();
    expect(selectedPanel.querySelector("strong")).not.toBeNull();
    expect(screen.getByText("Chronological age").closest(".biological-age-stats")).not.toBeNull();
    expect(screen.getByText("Biological age").closest(".biological-age-stats")).not.toBeNull();
    expect(screen.getByText("Age acceleration").closest(".biological-age-stats")).not.toBeNull();
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

// ─── Import tab navigation ────────────────────────────────────────────────────

describe("App — import tab", () => {
  it("dismisses a global notification after it has been read", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    fireEvent.click(screen.getByRole("tab", { name: /upload csv/i }));
    fireEvent.click(screen.getByRole("button", { name: /^upload csv$/i }));

    expect(screen.getByRole("status")).toHaveTextContent("Select a CSV file before upload.");
    fireEvent.click(screen.getByRole("button", { name: /dismiss notification/i }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("adds a manually entered row to a scan preview", async () => {
    global.fetch = mockFetch({
      "/api/store": { ...makeEmptyStore(), measurementTypes: defaultMeasurementTypes },
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" },
      "/api/import/body-composition/preview": {
        fileName: "report.pdf",
        reportDate: "2026-07-08T00:00:00.000Z",
        sourceText: "Weight 80 kg",
        checksum: "sha256-test",
        parserVersion: "body-composition-text-v1",
        diagnostics: [],
        rows: [{
          id: "weight-row",
          label: "Weight",
          measurementCode: "weight",
          displayName: "Weight",
          value: 80,
          unit: "kg",
          confidence: "high",
          included: true
        }]
      }
    });

    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^scan$/i }));
    fireEvent.change(screen.getByLabelText(/select report/i), {
      target: { files: [new File(["report"], "report.pdf", { type: "application/pdf" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: /preview scan/i }));

    await screen.findByRole("button", { name: /^add row$/i });
    fireEvent.click(screen.getByRole("button", { name: /^add row$/i }));

    expect(screen.getAllByRole("checkbox", { name: /save/i })).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: /row 2: save/i })).toBeChecked();
    const measurement = screen.getByRole("combobox", { name: /row 2 known measurement/i });
    expect(measurement).toHaveValue("");
    fireEvent.change(measurement, { target: { value: "iron" } });
    expect(screen.getByRole("combobox", { name: /row 2 known measurement/i })).toHaveValue("iron");
    expect(screen.getByRole("textbox", { name: /row 2 unit/i })).toHaveValue("µmol/L");
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

  it("shows pet fields only when the Pet profile type is selected", async () => {
    global.fetch = mockFetch({
      "/api/store": { ...makeEmptyStore(), measurementTypes: defaultMeasurementTypes },
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" }
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));

    const profileType = screen.getByRole("combobox", { name: /profile type/i });
    expect(profileType).toHaveValue("adult");
    expect(screen.queryByRole("textbox", { name: /pet species/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /pet species/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /pet breed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /microchip id/i })).not.toBeInTheDocument();

    fireEvent.change(profileType, { target: { value: "pet" } });
    const petSpecies = screen.getByRole("combobox", { name: /pet species/i });
    expect(petSpecies).toBeInTheDocument();
    expect(petSpecies).toHaveValue("");
    expect(petSpecies.querySelector('option[value="dog"]')).not.toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /height/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /blood type/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /pet breed/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /microchip id/i })).toBeInTheDocument();

    fireEvent.change(profileType, { target: { value: "child" } });
    expect(screen.queryByRole("textbox", { name: /pet species/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /pet species/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /pet breed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /microchip id/i })).not.toBeInTheDocument();
  });

  it("uses birth date throughout the dashboard and profile editor", async () => {
    const store = makeEmptyStore();
    store.profile.birthDate = "1983-04-05";
    store.profile.sex = "female";
    store.profile.subjectKind = "adult";
    global.fetch = mockFetch({
      "/api/store": { ...store, measurementTypes: defaultMeasurementTypes },
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" },
      "/api/profile": store.profile
    });

    render(<App />);
    expect(await screen.findByText("1983-04-05")).toBeInTheDocument();
    expect(screen.getByText("Birth date")).toBeInTheDocument();
    expect(screen.getByText("Profile type")).toBeInTheDocument();
    expect(screen.getByText("Female - Adult")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const birthDate = screen.getByLabelText(/birth date/i);
    expect(birthDate).toHaveValue("1983-04-05");
    expect(screen.queryByRole("spinbutton", { name: /birth year/i })).not.toBeInTheDocument();

    fireEvent.change(birthDate, { target: { value: "1983-04-06" } });
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      const request = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url, init]) =>
        url === "/api/profile" && init?.method === "PUT"
      );
      const body = JSON.parse(String(request?.[1]?.body));
      expect(body.birthDate).toBe("1983-04-06");
      expect(body).not.toHaveProperty("birthYear");
    });
  });

  it("presents profile management as contextual actions with progressive profile creation", async () => {
    const store = makeEmptyStore();
    const profiles = [
      { id: "self", displayName: "Local user", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "family", displayName: "Family member", updatedAt: "2026-01-02T00:00:00.000Z" }
    ];
    global.fetch = mockFetch({
      "/api/store": store,
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles, activeProfileId: "self" }
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /local user/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /manage profiles/i }));

    const manager = screen.getByRole("dialog", { name: /manage profiles/i });
    expect(within(manager).queryByRole("combobox", { name: /switch profile/i })).not.toBeInTheDocument();
    expect(within(manager).getByText("Active profile")).toBeInTheDocument();
    expect(within(manager).getByRole("button", { name: /switch/i })).toBeInTheDocument();
    expect(within(manager).getAllByRole("button", { name: /^edit$/i })).toHaveLength(2);

    const addProfile = within(manager).getByText("Add profile").closest("details");
    expect(addProfile).not.toHaveAttribute("open");
    fireEvent.click(within(manager).getByText("Add profile"));
    expect(addProfile).toHaveAttribute("open");

    const newProfileName = within(manager).getByLabelText("Profile name");
    newProfileName.focus();
    fireEvent.change(newProfileName, { target: { value: "Sam" } });
    expect(newProfileName).toHaveFocus();
    expect(newProfileName).toHaveValue("Sam");

    fireEvent.click(within(manager).getAllByRole("button", { name: /^edit$/i })[0]);
    expect(screen.getByRole("dialog", { name: /edit profile/i })).toBeInTheDocument();
  });

  it("uses imperial units when editing a profile and changing manual measurements", async () => {
    global.fetch = mockFetch({
      "/api/store": {
        ...makeEmptyStore(),
        profile: {
          id: "self",
          displayName: "Local user",
          heightCm: 177.8,
          units: "imperial",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        measurementTypes: defaultMeasurementTypes
      },
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" },
      "/api/profile": {
        id: "self",
        displayName: "Local user",
        heightCm: 177.8,
        units: "imperial",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText("Imperial")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const height = screen.getByRole("spinbutton", { name: /height in/i });
    const units = screen.getByRole("combobox", { name: /^units$/i });
    expect(height).toHaveValue(70);

    fireEvent.change(units, { target: { value: "metric" } });
    expect(screen.getByRole("spinbutton", { name: /height cm/i })).toHaveValue(177.8);
    fireEvent.change(units, { target: { value: "imperial" } });
    expect(screen.getByRole("spinbutton", { name: /height in/i })).toHaveValue(70);
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      const request = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url, init]) =>
        url === "/api/profile" && init?.method === "PUT"
      );
      const body = JSON.parse(String(request?.[1]?.body));
      expect(body.units).toBe("imperial");
      expect(body.heightCm).toBeCloseTo(177.8);
    });

    fireEvent.click(screen.getByRole("tab", { name: /^import$/i }));
    const observationGroup = screen.getByRole("combobox", { name: /observation group/i });
    fireEvent.change(observationGroup, { target: { value: "Lab" } });

    const measurement = screen.getByRole("combobox", { name: /row 1: select known measurement/i });
    await waitFor(() => expect(measurement).toHaveValue("glucose"));
    expect(screen.getByRole("textbox", { name: /row 1 unit/i })).toHaveValue("mg/dL");

    fireEvent.change(measurement, { target: { value: "iron" } });
    expect(screen.getByRole("textbox", { name: /row 1 unit/i })).toHaveValue("µmol/L");
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

describe("App — measurement detail", () => {
  it("shows only the source label for manually entered measurements", async () => {
    globalThis.history.replaceState({}, "", "/track/glucose");
    global.fetch = mockFetch({
      "/api/store": { ...makeEmptyStore(), measurementTypes: defaultMeasurementTypes },
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" },
      "/api/summary/glucose": {
        generatedAt: "2026-07-14T00:00:00.000Z",
        measurement: {
          code: "glucose", displayName: "Glucose", category: "lab", canonicalUnit: "mmol/L",
          counts: { observations: 1, samples: 0, activities: 0, total: 1 },
          lastMeasuredAt: "2026-07-14T00:00:00.000Z"
        },
        entries: [{
          kind: "observation", id: "glucose-1", measurementCode: "glucose", displayName: "Glucose",
          timestamp: "2026-07-14T00:00:00.000Z", value: 5.2, unit: "mmol/L",
          sourceLabel: "Manual observations: Lab", sourceKind: "manual-entry",
          importFileName: "lab-2026-07-14.manual-entry", note: "Manual observation from Lab", canDelete: true
        }],
        chartPoints: [{ kind: "observation", timestamp: "2026-07-14T00:00:00.000Z", value: 5.2, unit: "mmol/L" }],
        counts: { observations: 1, samples: 0, activities: 0, total: 1 },
        deletion: { observationEntries: 1, deletableEntries: 1 },
        pagination: { limit: 50, loaded: 1, total: 1, hasMore: false }
      }
    });

    render(<App />);
    expect(await screen.findByText("Manual observations: Lab")).toBeInTheDocument();
    expect(screen.queryByText(/lab-2026-07-14\.manual-entry/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Manual observation from Lab/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/measurement overview/i)).toHaveTextContent(/latest reading.*5.2.*mmol\/l/i);
    expect(screen.getByRole("img", { name: /glucose trend: 1 reading/i })).toHaveTextContent(/not enough data for a trend yet/i);
    expect(screen.getByRole("columnheader", { name: "Value" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Unit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Kind" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete 1 observation record/i })).toBeInTheDocument();
  });

  it("edits a single observation from its detail row", async () => {
    globalThis.history.replaceState({}, "", "/track/glucose");
    const detail = {
      generatedAt: "2026-07-14T00:00:00.000Z",
      measurement: {
        code: "glucose", displayName: "Glucose", category: "lab", canonicalUnit: "mmol/L",
        counts: { observations: 1, samples: 0, activities: 0, total: 1 },
        lastMeasuredAt: "2026-07-14T00:00:00.000Z"
      },
      entries: [{
        kind: "observation", id: "glucose-edit-1", measurementCode: "glucose", displayName: "Glucose",
        timestamp: "2026-07-14T08:30:00.000Z", value: 5.2, unit: "mmol/L",
        sourceLabel: "Manual observations: Lab", sourceKind: "manual-entry", note: "Fasting", canDelete: true
      }],
      chartPoints: [{ kind: "observation", timestamp: "2026-07-14T08:30:00.000Z", value: 5.2, unit: "mmol/L" }],
      counts: { observations: 1, samples: 0, activities: 0, total: 1 },
      deletion: { observationEntries: 1, deletableEntries: 1 },
      pagination: { limit: 50, loaded: 1, total: 1, hasMore: false }
    };
    global.fetch = mockFetch({
      "/api/store": { ...makeEmptyStore(), measurementTypes: defaultMeasurementTypes },
      "/api/analytics": makeEmptyAnalytics(),
      "/api/profiles": { profiles: [], activeProfileId: "self" },
      "/api/summary/glucose": detail,
      "/api/summary": {
        generatedAt: "2026-07-14T00:00:00.000Z",
        totals: { types: 1, observations: 1, samples: 0, activities: 0, total: 1 },
        categories: []
      },
      "/api/observations/glucose-edit-1": { updatedObservation: { id: "glucose-edit-1" } }
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /edit glucose observation/i }));

    expect(await screen.findByRole("dialog", { name: /edit observation/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^measurement$/i })).toHaveValue("glucose");
    expect(screen.getByRole("spinbutton", { name: /^value$/i })).toHaveValue(5.2);
    expect(screen.getByRole("textbox", { name: /^unit$/i })).toHaveValue("mmol/L");
    expect(screen.getByRole("textbox", { name: /^note$/i })).toHaveValue("Fasting");

    fireEvent.change(screen.getByRole("spinbutton", { name: /^value$/i }), { target: { value: "5.6" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^note$/i }), { target: { value: "Corrected fasting result" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const request = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url, init]) =>
        String(url).includes("/api/observations/glucose-edit-1") && init?.method === "PATCH"
      );
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
        measurementCode: "glucose",
        value: 5.6,
        unit: "mmol/L",
        note: "Corrected fasting result"
      });
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /edit observation/i })).not.toBeInTheDocument());
  });
});

