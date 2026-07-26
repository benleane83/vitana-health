import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultMeasurementTypes, type AppBootstrap } from "@vitana/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { ManualImportFeature } from "./ManualImportFeature.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("ManualImportFeature", () => {
  it("restores the last observation group for the active profile", () => {
    window.localStorage.setItem("vitana.manualImport.lastObservationGroup.v1.self", "Body");

    render(
      <ManualImportFeature
        activeProfileId="self"
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Observation group")).toHaveValue("Body");
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("weight");
  });

  it("prefills a lab marker from a Biological Age add-result link", () => {
    window.localStorage.setItem("vitana.manualImport.lastObservationGroup.v1.self", "Body");
    window.history.replaceState({}, "", "/import/manual?group=Lab&marker=albumin");

    render(
      <ManualImportFeature
        activeProfileId="self"
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Observation group")).toHaveValue("Lab");
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("albumin");
  });

  it("keeps observation-group preferences isolated when the active profile changes", () => {
    window.localStorage.setItem("vitana.manualImport.lastObservationGroup.v1.self", "Body");
    window.localStorage.setItem("vitana.manualImport.lastObservationGroup.v1.family", "Lab");
    const props = {
      units: "metric" as const,
      onImported: vi.fn().mockResolvedValue(undefined),
      onNotice: vi.fn()
    };
    const { rerender } = render(<ManualImportFeature activeProfileId="self" {...props} />);

    rerender(<ManualImportFeature activeProfileId="family" {...props} />);

    expect(screen.getByLabelText("Observation group")).toHaveValue("Lab");
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("glucose");
    expect(window.localStorage.getItem("vitana.manualImport.lastObservationGroup.v1.self")).toBe("Body");
  });

  it("hydrates a stored custom-group template when bootstrap data arrives", () => {
    window.localStorage.setItem(
      "vitana.manualImport.lastObservationGroup.v1.self",
      "Morning metrics"
    );
    const props = {
      activeProfileId: "self",
      units: "metric" as const,
      onImported: vi.fn().mockResolvedValue(undefined),
      onNotice: vi.fn()
    };
    const { rerender } = render(<ManualImportFeature {...props} />);
    const bootstrap = {
      profile: { id: "self", displayName: "Local user", units: "metric", updatedAt: "2026-01-01" },
      measurementTypes: defaultMeasurementTypes,
      manualObservationGroupTemplates: [{
        label: "Morning metrics",
        normalizedLabel: "morning metrics",
        measurements: [{ measurementCode: "weight", marker: "Weight", unit: "kg" }]
      }],
      counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 0 }
    } as AppBootstrap;

    rerender(<ManualImportFeature {...props} bootstrap={bootstrap} />);

    expect(screen.getByLabelText("Observation group")).toHaveValue("Morning metrics");
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("weight");
  });

  it("persists a typed custom observation group without storing its empty transition", () => {
    window.localStorage.setItem("vitana.manualImport.lastObservationGroup.v1.self", "Lab");
    render(
      <ManualImportFeature
        activeProfileId="self"
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Observation group"), { target: { value: "__custom__" } });
    expect(window.localStorage.getItem("vitana.manualImport.lastObservationGroup.v1.self")).toBe("Lab");
    fireEvent.change(screen.getByLabelText("Custom observation group"), {
      target: { value: "Post-workout check-in" }
    });

    expect(window.localStorage.getItem("vitana.manualImport.lastObservationGroup.v1.self"))
      .toBe("Post-workout check-in");
  });

  it("uses compact accessible controls to remove manual rows", () => {
    render(
      <ManualImportFeature
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    const removeButtons = screen.getAllByRole("button", { name: /Remove row/ });

    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[1]).toHaveTextContent("");
    expect(removeButtons[1].querySelector("svg")).not.toBeNull();
    fireEvent.click(removeButtons[1]);
    expect(screen.queryByRole("button", { name: "Remove row 2" })).not.toBeInTheDocument();
  });

  it("selects the next available measurement when adding a row", () => {
    render(
      <ManualImportFeature
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );
    const firstMeasurement = screen.getByLabelText("Row 1: select known measurement") as HTMLSelectElement;
    const knownOptions = [...firstMeasurement.options].filter((option) => option.value);
    const currentIndex = knownOptions.findIndex((option) => option.value === firstMeasurement.value);
    const expectedNextMeasurement = knownOptions[(currentIndex + 1) % knownOptions.length]?.value;

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));

    expect(screen.getByLabelText("Row 2: select known measurement")).toHaveValue(expectedNextMeasurement);
    expect(screen.queryByLabelText("Row 2 measurement name")).not.toBeInTheDocument();
  });

  it("retains the imported group while clearing observation values", async () => {
    window.localStorage.setItem("vitana.manualImport.lastObservationGroup.v1.self", "Body");
    vi.spyOn(api, "importManualObservations").mockResolvedValue(undefined as never);
    render(
      <ManualImportFeature
        activeProfileId="self"
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("Row 1 value"), { target: { value: "80" } });

    fireEvent.click(screen.getByRole("button", { name: "Import observations" }));

    await waitFor(() => expect(api.importManualObservations).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Observation group")).toHaveValue("Body");
    expect(screen.getByLabelText("Row 1 value")).toHaveValue("");
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("weight");
  });

  it("falls back cleanly when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    render(
      <ManualImportFeature
        activeProfileId="self"
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("Observation group"), { target: { value: "Body" } });

    expect(screen.getByLabelText("Observation group")).toHaveValue("Body");
  });
});
