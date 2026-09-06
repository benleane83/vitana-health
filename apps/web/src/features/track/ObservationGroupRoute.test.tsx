// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultMeasurementTypes } from "@vitana/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { ObservationGroupRoute } from "./ObservationGroupRoute.js";

const group = {
  id: "morning-vitals-1",
  kind: "custom" as const,
  label: "Morning vitals",
  collectedAt: "2026-08-07T08:15:00.000Z",
  source: { kind: "manual-entry" as const, label: "Manual observations" },
  editable: true,
  observations: [{
    id: "glucose-1",
    measurementCode: "glucose",
    displayName: "Glucose",
    observedAt: "2026-08-07T08:15:00.000Z",
    value: 5.2,
    unit: "mmol/L",
    note: "Fasting",
    status: "normal" as const
  }]
};

function renderRoute(confirm = vi.fn().mockResolvedValue(true)) {
  const onBack = vi.fn();
  const onDataChanged = vi.fn().mockResolvedValue(undefined);
  const onNotice = vi.fn();
  vi.spyOn(api, "observationGroup").mockResolvedValue(group);

  render(
    <ObservationGroupRoute
      groupId={group.id}
      activeProfileId="profile-1"
      measurementTypes={defaultMeasurementTypes}
      units="metric"
      backLabel="Back to panels"
      onBack={onBack}
      onSelectMeasurement={vi.fn()}
      onDataChanged={onDataChanged}
      onNotice={onNotice}
      confirm={confirm}
    />
  );

  return { confirm, onBack, onDataChanged, onNotice };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ObservationGroupRoute panel deletion", () => {
  it("shows the labelled delete icon beside Edit panel and does not delete when cancelled", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const deleteObservationGroup = vi.spyOn(api, "deleteObservationGroup");
    renderRoute(confirm);

    await screen.findByRole("heading", { name: group.label });
    expect(screen.getByRole("button", { name: "Delete Morning vitals panel" })).toHaveAttribute("title", "Delete panel");
    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Morning vitals panel" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(
      "Delete panel",
      "Permanently delete Morning vitals and all 1 contained measurement? This cannot be undone.",
      "Delete panel",
      true
    ));
    expect(deleteObservationGroup).not.toHaveBeenCalled();
  });

  it("deletes a confirmed panel, refreshes data, notifies, and returns", async () => {
    const deleteObservationGroup = vi.spyOn(api, "deleteObservationGroup").mockResolvedValue({
      deletedCount: 1,
      deletedGroupId: group.id,
      deletedObservationCount: 1,
      counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 0 }
    });
    const callbacks = renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Delete Morning vitals panel" }));

    await waitFor(() => expect(deleteObservationGroup).toHaveBeenCalledWith(group.id));
    await waitFor(() => expect(callbacks.onDataChanged).toHaveBeenCalledOnce());
    expect(callbacks.onNotice).toHaveBeenCalledWith("Panel and 1 measurement deleted.");
    expect(callbacks.onBack).toHaveBeenCalledOnce();
  });

  it("reports a deletion failure and keeps the detail view open", async () => {
    vi.spyOn(api, "deleteObservationGroup").mockRejectedValue(new Error("offline"));
    const callbacks = renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Delete Morning vitals panel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't delete this panel. Please try again.");
    expect(callbacks.onDataChanged).not.toHaveBeenCalled();
    expect(callbacks.onBack).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: group.label })).toBeInTheDocument();
  });
});
