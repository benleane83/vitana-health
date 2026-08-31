// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../api.js";
import { CareRoute } from "./CareRoute.js";

const openCareItem = {
  id: "care-1",
  title: "Annual check-up",
  kind: "visit" as const,
  priority: "normal" as const,
  status: "open" as const,
  dueStart: "2026-08-18T14:00:00.000Z"
};

const healthEvent = {
  id: "event-1",
  kind: "visit" as const,
  status: "completed" as const,
  occurredAt: "2026-08-18T14:00:00.000Z",
  source: "manual-entry" as const
};

const medication = {
  id: "medication-1",
  name: "Metformin",
  activeIngredient: "Metformin hydrochloride",
  dose: 500,
  unit: "mg",
  startDate: "2026-01-10",
  createdAt: "2026-01-10T08:00:00.000Z",
  updatedAt: "2026-01-10T08:00:00.000Z"
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
  vi.spyOn(api.care, "listMedications").mockResolvedValue({
    items: [medication],
    total: 1,
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
  it("lists, filters, and edits medications without removed fields", async () => {
    const update = vi.spyOn(api.care, "updateMedication").mockResolvedValue({ medication });
    render(<CareRoute view="medications" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);

    expect(await screen.findByText("Metformin (Metformin hydrochloride)")).toBeInTheDocument();
    expect(screen.getByText("500 mg")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search medications"), { target: { value: "metformin" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(api.care.listMedications).toHaveBeenLastCalledWith(expect.objectContaining({ search: "metformin" })));
    fireEvent.change(screen.getByLabelText("Filter medication status"), { target: { value: "active" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(api.care.listMedications).toHaveBeenLastCalledWith(expect.objectContaining({ search: "metformin", status: "active" })));

    fireEvent.click(screen.getByRole("button", { name: "Edit Metformin" }));
    expect(screen.getByLabelText("Active Ingredient(s)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Route")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Schedule or instructions")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Prescriber")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "750" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("medication-1", expect.objectContaining({ dose: 750, startDate: "2026-01-10" })));
  });

  it("keeps medication filters visible while clearing a filter with no results", async () => {
    vi.mocked(api.care.listMedications).mockImplementation(async (query) => {
      const isPast = query?.status === "past";
      return {
        items: isPast ? [] : [medication],
        total: isPast ? 0 : 1,
        offset: 0,
        limit: 20,
        hasMore: false
      };
    });
    render(<CareRoute view="medications" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);

    expect(await screen.findByText("Metformin (Metformin hydrochloride)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter medication status"), { target: { value: "past" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByText("Metformin (Metformin hydrochloride)")).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Filter medication status"), { target: { value: "" } });
    expect(screen.getByLabelText("Filter medication status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Metformin (Metformin hydrochloride)")).toBeInTheDocument();
  });

  it("saves a medication without dose, unit, or dates", async () => {
    const created = { ...medication, id: "medication-2", dose: undefined, unit: undefined, startDate: undefined };
    const create = vi.spyOn(api.care, "createMedication").mockResolvedValue({ medication: created });
    render(<CareRoute view="medications" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);

    await screen.findByText("Metformin (Metformin hydrochloride)");
    fireEvent.click(screen.getByRole("button", { name: "Add medication" }));
    expect(screen.getByLabelText("Dose")).toHaveValue(null);
    expect(screen.getByLabelText("Start date")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vitamin D" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      name: "Vitamin D",
      activeIngredient: undefined,
      dose: undefined,
      unit: undefined,
      startDate: undefined,
      endDate: undefined,
      notes: undefined
    }));
  });

  it("keeps route identity outside the bounded task panel", async () => {
    const { container } = render(<CareRoute view="items" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);

    await screen.findByText("Annual check-up");
    expect(screen.getByRole("heading", { level: 1, name: "Care" }).closest(".panel")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Care items" })).toBeInTheDocument();
    expect(container.querySelector(".care-panel")).toContainElement(screen.getByRole("tabpanel", { name: "Care items" }));
  });

  it("loads and opens a care item selected from the Dashboard", async () => {
    render(
      <CareRoute
        view="items"
        activeProfileId="self"
        selectedCareItemId="care-1"
        onViewChange={vi.fn()}
        onDataChanged={vi.fn().mockResolvedValue(undefined)}
        onNotice={vi.fn()}
        confirm={vi.fn()}
      />
    );

    await waitFor(() => expect(api.care.listCareItems).toHaveBeenCalledWith(expect.objectContaining({ includeId: "care-1" })));
    expect(await screen.findByRole("heading", { name: "Annual check-up" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Annual check-up");
  });

  it("opens records directly and exposes a mobile back-to-list action", async () => {
    render(<CareRoute view="items" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Annual check-up" }));

    expect(screen.getByRole("heading", { name: "Annual check-up" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Care items" })).toHaveClass("has-editor");
    expect(screen.getByRole("button", { name: "Add care item" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to care items" }));
    expect(screen.getByRole("tabpanel", { name: "Care items" })).not.toHaveClass("has-editor");
    expect(screen.getByRole("button", { name: "Add care item" })).toBeEnabled();
  });

  it("keeps Care Item creation available while editing a Health Event", async () => {
    vi.mocked(api.care.listHealthEvents).mockResolvedValue({ items: [healthEvent], total: 1, offset: 0, limit: 20, hasMore: false });
    const props = { activeProfileId: "self", onViewChange: vi.fn(), onDataChanged: vi.fn().mockResolvedValue(undefined), onNotice: vi.fn(), confirm: vi.fn() };
    const { rerender } = render(<CareRoute {...props} view="health-events" />);

    fireEvent.click(await screen.findByRole("button", { name: /Edit Visit or consultation recorded/ }));
    expect(screen.getByRole("button", { name: "Add health event" })).toBeDisabled();

    rerender(<CareRoute {...props} view="items" />);

    expect(await screen.findByRole("button", { name: "Add care item" })).toBeEnabled();
  });

  it("keeps Health Event creation available while editing a Care Item", async () => {
    const props = { activeProfileId: "self", onViewChange: vi.fn(), onDataChanged: vi.fn().mockResolvedValue(undefined), onNotice: vi.fn(), confirm: vi.fn() };
    const { rerender } = render(<CareRoute {...props} view="items" />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Annual check-up" }));
    expect(screen.getByRole("button", { name: "Add care item" })).toBeDisabled();

    rerender(<CareRoute {...props} view="health-events" />);

    expect(await screen.findByRole("button", { name: "Add health event" })).toBeEnabled();
  });

  it("guides an empty Care view into the real creation workflow", async () => {
    vi.mocked(api.care.listCareItems).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20, hasMore: false });

    render(<CareRoute view="items" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Nothing needs your attention" })).toBeInTheDocument();
    expect(screen.getByText(/Completed care is recorded in Health events/)).toBeInTheDocument();
    expect(screen.queryByText("Select a record to edit it, or add a new one.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search care items")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View all statuses" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add care item" }));
    expect(screen.getByRole("heading", { name: "Care item" })).toBeInTheDocument();
  });

  it("distinguishes filtered empty results and clears them", async () => {
    vi.mocked(api.care.listCareItems).mockImplementation(async (query) => ({
      items: query?.kind ? [] : [openCareItem],
      total: query?.kind ? 0 : 1,
      offset: 0,
      limit: 20,
      hasMore: false
    }));

    render(<CareRoute view="items" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);
    await screen.findByText("Annual check-up");
    fireEvent.change(screen.getByLabelText("Filter care item type"), { target: { value: "visit" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByRole("heading", { name: "No matches found" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Annual check-up")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter care item type")).toHaveValue("");
  });

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
    fireEvent.change(screen.getByLabelText("Filter care item type"), { target: { value: "visit" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(api.care.listCareItems).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "visit" })));

    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(screen.getByRole("heading", { name: "Complete Annual check-up" })).toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toHaveValue("visit");
    expect(screen.getByLabelText("Date")).toHaveAttribute("type", "date");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    fireEvent.submit(screen.getByRole("button", { name: "Complete care item" }).closest("form")!);
    await waitFor(() => expect(complete).toHaveBeenCalledWith("care-1", expect.objectContaining({ kind: "visit" })));
    expect(complete.mock.calls[0]?.[1].occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(onDataChanged).toHaveBeenCalledOnce();
    expect(onNotice).toHaveBeenCalledWith("Annual check-up completed and added to Health events.");
  });

  it("completes monitoring without offering or claiming a Health Event", async () => {
    const monitoringItem = { ...openCareItem, id: "care-monitoring", title: "Review blood pressure", kind: "monitoring" as const };
    vi.mocked(api.care.listCareItems).mockResolvedValue({ items: [monitoringItem], total: 1, offset: 0, limit: 20, hasMore: false });
    const complete = vi.spyOn(api.care, "completeCareItem").mockResolvedValue({
      careItem: { ...monitoringItem, status: "completed", completedAt: "2026-07-25T09:30:00.000Z" },
      counts: { imports: 0, observations: 0, samples: 0, activities: 0, healthEvents: 0, careItems: 1 }
    });
    const onNotice = vi.fn();

    render(<CareRoute view="items" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={onNotice} confirm={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));
    expect(screen.getByText("Record when this monitoring item was completed.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Type")).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole("button", { name: "Complete care item" }).closest("form")!);
    await waitFor(() => expect(complete).toHaveBeenCalledWith("care-monitoring", expect.objectContaining({ kind: undefined })));
    expect(onNotice).toHaveBeenCalledWith("Review blood pressure completed.");
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
    expect(within(screen.getByLabelText("Status")).queryByRole("option", { name: "Skipped" })).not.toBeInTheDocument();

    const oneDay = screen.getByRole("button", { name: "1 day before" });
    expect(oneDay).toBeDisabled();
    expect(screen.queryByText(/use reminder presets/i)).not.toBeInTheDocument();

    expect(screen.getByLabelText("Due date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Reminder date")).toHaveAttribute("type", "date");
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-08-18" } });
    expect(oneDay).toBeEnabled();
    fireEvent.click(oneDay);
    expect(screen.getByLabelText("Reminder date")).toHaveValue("2026-08-17");

    fireEvent.change(screen.getByLabelText("Reminder date"), { target: { value: "2026-08-20" } });
    expect(screen.getByLabelText("Reminder date")).toHaveValue("2026-08-20");
  });

  it("uses a date-only control for health events", async () => {
    render(<CareRoute view="health-events" activeProfileId="self" onViewChange={vi.fn()} onDataChanged={vi.fn().mockResolvedValue(undefined)} onNotice={vi.fn()} confirm={vi.fn()} />);
    await screen.findByText("Record care, symptoms, tests, treatments, and other health moments that have already happened.");
    fireEvent.click(screen.getByRole("button", { name: "Add health event" }));

    expect(screen.getByLabelText("Type")).toHaveValue("other");
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter health event status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveAttribute("type", "date");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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