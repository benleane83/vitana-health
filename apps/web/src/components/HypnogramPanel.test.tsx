// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SleepSessionPage } from "@vitana/shared";
import { HypnogramPanel } from "./HypnogramPanel.js";

const page: SleepSessionPage = {
  generatedAt: "2026-08-03T06:05:00.000Z",
  total: 2,
  offset: 0,
  limit: 30,
  hasMore: false,
  sessions: [{
    id: "newest",
    title: "Newest night",
    startAt: "2026-08-02T22:00:00.000Z",
    endAt: "2026-08-03T06:00:00.000Z",
    durationMinutes: 480,
    stageDataStatus: "available",
    stages: [
      { startAt: "2026-08-02T22:00:00.000Z", endAt: "2026-08-03T02:00:00.000Z", stage: "light" },
      { startAt: "2026-08-03T02:00:00.000Z", endAt: "2026-08-03T06:00:00.000Z", stage: "deep" }
    ]
  }, {
    id: "older",
    title: "Older night",
    startAt: "2026-08-01T22:00:00.000Z",
    endAt: "2026-08-02T06:00:00.000Z",
    durationMinutes: 480,
    stageDataStatus: "partial",
    stages: [{ startAt: "2026-08-01T22:00:00.000Z", endAt: "2026-08-02T06:00:00.000Z", stage: "gap" }]
  }]
};

describe("HypnogramPanel", () => {
  it("renders the stage bands for the selected imported night", () => {
    render(<HypnogramPanel page={page} busy={false} selectedSessionId="older" />);

    expect(screen.getByRole("region", { name: "Sleep stages" })).toBeInTheDocument();
  expect(screen.getByText(/Older night/)).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(document.querySelectorAll(".hypnogram-gap")).toHaveLength(1);
  });

  it("explains when a session has no stage data", () => {
    render(<HypnogramPanel page={{ ...page, sessions: [{ ...page.sessions[0]!, stageDataStatus: "unavailable", stages: [] }] }} busy={false} />);

    expect(screen.getByText("Stage data is unavailable for this night.")).toBeInTheDocument();
  });
});