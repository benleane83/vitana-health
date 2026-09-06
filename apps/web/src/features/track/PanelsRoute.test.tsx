// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { PanelsRoute } from "./PanelsRoute.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PanelsRoute", () => {
  it("loads panels, applies filters from the first page, and opens existing group detail", async () => {
    const observationGroups = vi.spyOn(api, "observationGroups")
      .mockResolvedValueOnce({
        items: [{
          id: "panel-1",
          kind: "lab_panel",
          label: "Annual blood tests",
          date: "2026-08-20T09:00:00.000Z",
          measurementCount: 4
        }],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false
      })
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
        hasMore: false
      });
    const onViewObservationGroup = vi.fn();

    render(
      <PanelsRoute
        activeProfileId="profile-1"
        onViewObservationGroup={onViewObservationGroup}
      />
    );

    expect(await screen.findByText("Annual blood tests")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Annual blood tests" }));
    expect(onViewObservationGroup).toHaveBeenCalledWith("panel-1");

    expect(screen.queryByRole("option", { name: "Sleep session" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "custom" } });
    await waitFor(() => expect(observationGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: ["custom"], limit: 50, offset: 0 }),
      expect.any(AbortSignal)
    ));
    expect(await screen.findByText("No matching panels")).toBeInTheDocument();
  });

  it("appends another page and retries initial errors", async () => {
    const observationGroups = vi.spyOn(api, "observationGroups")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        items: [{ id: "panel-1", kind: "custom", label: "First", measurementCount: 1 }],
        total: 2,
        limit: 50,
        offset: 0,
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [{ id: "panel-2", kind: "custom", label: "Second", measurementCount: 2 }],
        total: 2,
        limit: 50,
        offset: 1,
        hasMore: false
      });

    render(
      <PanelsRoute
        activeProfileId="profile-1"
        onViewObservationGroup={vi.fn()}
      />
    );

    expect(await screen.findByText("We couldn't load your panels. Please try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("First")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(observationGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 50, offset: 1 }),
      expect.any(AbortSignal)
    );
  });

});
