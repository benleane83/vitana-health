import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { JournalRoute } from "./JournalRoute.js";

vi.mock("../../api.js", () => ({ api: { journal: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("JournalRoute", () => {
  it("renders grouped entries and appends complete older-day pages", async () => {
    vi.mocked(api.journal)
      .mockResolvedValueOnce({
        timezone: "UTC",
        nextBeforeDate: "2026-08-02",
        days: [{
          date: "2026-08-02",
          summary: { steps: { value: 700, unit: "count", sources: ["Phone"] }, sleepDurationMinutes: 480 },
          omittedItemCount: 3,
          items: [{
            kind: "activity",
            id: "walk-1",
            occurredAt: "2026-08-02T15:00:00.000Z",
            title: "Walking",
            activityType: "walking",
            durationMinutes: 30,
            sourceLabel: "Phone"
          }, {
            kind: "sleep",
            id: "sleep-1",
            occurredAt: "2026-08-02T07:00:00.000Z",
            startAt: "2026-08-01T23:00:00.000Z",
            endAt: "2026-08-02T07:00:00.000Z",
            durationMinutes: 480,
            stageDataStatus: "available"
          }]
        }]
      })
      .mockResolvedValueOnce({
        timezone: "UTC",
        days: [{
          date: "2026-08-01",
          summary: {},
          omittedItemCount: 0,
          items: [{
            kind: "health-event",
            id: "visit-1",
            occurredAt: "2026-08-01T10:00:00.000Z",
            eventKind: "visit",
            title: "Visit or consultation",
            sourceLabel: "manual-entry"
          }]
        }]
      });

    render(<JournalRoute activeProfileId="self" />);

    expect(await screen.findByText("700 steps")).toBeInTheDocument();
    expect(screen.getByText("Walking")).toBeInTheDocument();
    expect(screen.getByText("Sleep")).toBeInTheDocument();
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
    expect(screen.queryByText("Detailed stages")).not.toBeInTheDocument();
    expect(screen.getByText("This day is unusually busy. 3 more records are not shown here to keep the Journal easy to scan.")).toBeInTheDocument();
    expect(document.querySelector(".journal-item-activity .lucide-footprints")).toBeInTheDocument();
    expect(document.querySelector(".journal-item-sleep .lucide-bed-double")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load older days" }));

    await waitFor(() => expect(api.journal).toHaveBeenLastCalledWith(
      expect.objectContaining({ beforeDate: "2026-08-02" }),
      expect.any(AbortSignal)
    ));
    expect(await screen.findByText("Visit or consultation")).toBeInTheDocument();
    expect(document.querySelector(".journal-item-health-event .lucide-clipboard-check")).toBeInTheDocument();
  });

  it("offers a retry after an error and renders the empty state", async () => {
    vi.mocked(api.journal)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ timezone: "UTC", days: [] });

    render(<JournalRoute activeProfileId="self" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load your Journal. Please try again.");
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { name: "Nothing recorded yet", level: 2 })).toBeInTheDocument();
    expect(api.journal).toHaveBeenCalledTimes(2);
  });

  it("keeps visible days in place when loading older days fails and allows a retry", async () => {
    vi.mocked(api.journal)
      .mockResolvedValueOnce({
        timezone: "UTC",
        nextBeforeDate: "2026-08-01",
        days: [{
          date: "2026-08-02",
          summary: {},
          omittedItemCount: 0,
          items: [{
            kind: "activity",
            id: "activity-1",
            occurredAt: "2026-08-02T15:00:00.000Z",
            title: "A very long imported activity title without spaces that should remain readable in the Journal timeline",
            activityType: "walking"
          }]
        }]
      })
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ timezone: "UTC", days: [] });

    render(<JournalRoute activeProfileId="self" />);

    expect(await screen.findByText(/A very long imported activity title/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load older days" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load older days. Check your connection and try again.");
    expect(screen.getByText(/A very long imported activity title/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try loading older days again" }));

    await waitFor(() => expect(api.journal).toHaveBeenCalledTimes(3));
  });
});