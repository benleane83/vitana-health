import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("Weight");
  });

  it("uses the requested category's manual form preset", () => {
    window.localStorage.setItem("vitana.manualImport.lastObservationGroup.v1.self", "Lab");

    render(
      <ManualImportFeature
        activeProfileId="self"
        category="body"
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Observation group")).toHaveValue("Body");
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("Weight");
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
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("Albumin");
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
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("Glucose");
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
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("Weight");
  });

  it("defers custom group naming to import and starts with a known measurement", async () => {
    window.localStorage.setItem("vitana.manualImport.lastObservationGroup.v1.self", "Lab");
    vi.spyOn(api, "importManualObservations").mockResolvedValue(undefined as never);
    render(
      <ManualImportFeature
        activeProfileId="self"
        units="metric"
        onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Observation group"), { target: { value: "__custom__" } });
    expect(screen.queryByLabelText("Custom observation group")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("Active energy burned");
    expect(screen.queryByLabelText("Row 1 measurement name")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("vitana.manualImport.lastObservationGroup.v1.self")).toBe("Lab");
    fireEvent.change(screen.getByLabelText("Row 1 value"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Import observations" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Name this custom group" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Custom group name"), { target: { value: "Post-workout check-in" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import observations" }));

    await waitFor(() => expect(api.importManualObservations).toHaveBeenCalledWith(expect.objectContaining({
      label: "Post-workout check-in"
    })));
  });

  it("generates a standard code from a custom measurement name", async () => {
      vi.spyOn(api, "importManualObservations").mockResolvedValue(undefined as never);
      render(
        <ManualImportFeature
          activeProfileId="self"
          units="metric"
          onImported={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
        />
      );

    fireEvent.change(screen.getByLabelText("Observation group"), { target: { value: "__custom__" } });
    expect(screen.queryByLabelText("Row 1 measurement name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Row 1 measurement code")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Row 1 unit"), { target: { value: "kcal" } });
    fireEvent.click(screen.getByRole("button", { name: "Open measurement choices" }));
    fireEvent.change(screen.getByLabelText("Row 1: select known measurement"), { target: { value: "Custom score" } });
    fireEvent.click(screen.getByRole("option", { name: "Use a custom measurement" }));

    expect(screen.getByLabelText("Row 1 measurement name")).toHaveValue("Custom score");
      expect(screen.getByLabelText("Row 1 unit")).toHaveValue("");
      expect(screen.queryByLabelText("Row 1 measurement code")).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Row 1 value"), { target: { value: "7" } });
      fireEvent.change(screen.getByLabelText("Row 1 unit"), { target: { value: "points" } });
      fireEvent.click(screen.getByRole("button", { name: "Import observations" }));
      fireEvent.change(screen.getByLabelText("Custom group name"), { target: { value: "Custom readings" } });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Import observations" }));

      await waitFor(() => expect(api.importManualObservations).toHaveBeenCalledWith(expect.objectContaining({
        label: "Custom readings",
        observations: [expect.objectContaining({
          measurementName: "Custom score",
          measurementCode: "manual_custom_score"
        })]
      })));
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
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));

    expect(screen.getByLabelText("Row 2: select known measurement")).toHaveValue("Total calories burned");
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
    expect(screen.getByLabelText("Row 1: select known measurement")).toHaveValue("Weight");
    expect(screen.getByRole("status")).toHaveTextContent("1 observation imported successfully.");

    fireEvent.change(screen.getByLabelText("Row 1 value"), { target: { value: "81" } });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
