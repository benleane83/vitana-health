// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../api.js";
import { CareRoute } from "./CareRoute.js";

const openCareItem = {
  id: "care-1",
  title: "Annual check-up",
  kind: "routine-checkup",
  priority: "normal" as const,
  status: "open" as const,
  dueStart: "2026-08-18T14:00:00.000Z"
};

beforeEach(() => {
  vi.spyOn(api.care, "listCareItems").mockResolvedValue({
    items: [openCareItem],
    total: 1,
    offset: 0,
    limit: 20,
    hasMore: false
  });
  vi.spyOn(api.care, "listHealthEvents").mockResolvedValue({
    items: [],
    total: 0,
    offset: 0,
    limit: 20,
    hasMore: false
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CareRoute", () => {
  it("filters by care kind and completes an open item through the review panel", async () => {
    const complete = vi.spyOn(api.care, "completeCareItem").mockResolvedValue({
      careItem: { ...openCareItem, status: "completed", completedAt: "2026-07-25T09:30:00.000Z", completedHealthEventId: "event-1" },
      healthEvent: { id: "event-1", kind: "visit", status: "completed", occurredAt: "2026-07-25T09:30:00.000Z", source: "manual-entry" },
      counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 1, careItems: 1 }
    });
    const onDataChanged = vi.fn().mockResolvedValue(undefined);
    const onNotice = vi.fn();

    render(<CareRoute view="items" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={onDataChanged} onNotice={onNotice} confirm={vi.fn()} />);

    expect(await screen.findByText("Plan and track appointments, follow-ups, and other care that still needs attention.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter care item kind"), { target: { value: "routine-checkup" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(api.care.listCareItems).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "routine-checkup" })));

    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(screen.getByRole("heading", { name: "Complete Annual check-up" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kind")).toHaveValue("visit");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).not.toBe("");

    fireEvent.submit(screen.getByRole("button", { name: "Complete care item" }).closest("form")!);
    await waitFor(() => expect(complete).toHaveBeenCalledWith("care-1", expect.objectContaining({ kind: "visit" })));
    expect(complete.mock.calls[0]?.[1].occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(onDataChanged).toHaveBeenCalledOnce();
    expect(onNotice).toHaveBeenCalledWith("Annual check-up completed and added to Health events.");
  });

  it("uses direct reminder dates and only enables due-date presets when a due date exists", async () => {
    vi.spyOn(api.care, "createCareItem").mockResolvedValue({
      careItem: { ...openCareItem, id: "care-2", reminderAt: "2026-08-17T14:00:00.000Z" },
      counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 2 }
    });

    render(<CareRoute view="items" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);
    await screen.findByText("Annual check-up");
    fireEvent.click(screen.getByRole("button", { name: "Add care item" }));

    expect(screen.queryByLabelText(/occurred end/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/due end/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/originating event/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/completion event/i)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Status")).queryByRole("option", { name: "Completed" })).not.toBeInTheDocument();

    const oneDay = screen.getByRole("button", { name: "1 day before" });
    expect(oneDay).toBeDisabled();
    expect(screen.queryByText(/use reminder presets/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-08-18T15:00" } });
    expect(oneDay).toBeEnabled();
    fireEvent.click(oneDay);
    expect(screen.getByLabelText("Reminder date")).toHaveValue("2026-08-17T15:00");

    fireEvent.change(screen.getByLabelText("Reminder date"), { target: { value: "2026-08-20T09:00" } });
    expect(screen.getByLabelText("Reminder date")).toHaveValue("2026-08-20T09:00");
  });

  it("supports keyboard navigation between Care tabs", async () => {
    const onViewChange = vi.fn();
    render(<CareRoute view="items" activeProfileId="self" onViewChange={onViewChange} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);
    await screen.findByText("Annual check-up");

    const careItemsTab = screen.getByRole("tab", { name: "Care items" });
    const healthEventsTab = screen.getByRole("tab", { name: "Health events" });
    expect(careItemsTab).toHaveAttribute("aria-controls", "care-view-panel");
    expect(healthEventsTab).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(careItemsTab, { key: "ArrowRight" });
    expect(onViewChange).toHaveBeenCalledWith("health-events");
    expect(healthEventsTab).toHaveFocus();
  });

  it("keeps completed status fixed and hides the completion action", async () => {
    vi.mocked(api.care.listCareItems).mockResolvedValue({
      items: [{ ...openCareItem, status: "completed", completedAt: "2026-07-25T09:30:00.000Z", completedHealthEventId: "event-1" }],
      total: 1,
      offset: 0,
      limit: 20,
      hasMore: false
    });

    render(<CareRoute view="items" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);
    await screen.findByText("Annual check-up");

    expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Annual check-up" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByText("Completed", { selector: ".care-fixed-field strong" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });
});