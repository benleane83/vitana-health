// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiQueryResult } from "../api.js";
import { QueryPage } from "./QueryPage.js";

const result: AiQueryResult = {
  outcome: "answered",
  question: "average heart rate last month",
  answer: "Average heart rate last month: 72.",
  limitations: ["Only imported observations are included."],
  assumptions: [],
  confidence: 0.6,
  plan: { intent: "aggregation" },
  sql: "SELECT AVG(value) FROM observations",
  rowCount: 1,
  rows: [{ value: 72 }],
  chart: null,
  debug: { attempts: 1, repaired: false }
};

describe("QueryPage", () => {
  it("keeps heuristic confidence out of the result and diagnostics collapsed", () => {
    renderPage({ result });

    expect(screen.getByText("Average heart rate last month: 72.")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    const details = screen.getByText("Technical details").closest("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("turns typed recovery suggestions into composer actions", () => {
    const onQuestionChange = vi.fn();
    renderPage({
      onQuestionChange,
      error: {
        message: "I could not understand that question well enough to query your data safely.",
        code: "QUERY_NOT_UNDERSTOOD",
        suggestions: ["Include a time range such as last month."],
        diagnostics: { attempts: 2, repaired: true, failureCategory: "json" }
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "Include a time range such as last month." }));

    expect(onQuestionChange).toHaveBeenCalledWith("Include a time range such as last month.");
    expect(screen.getByText("Technical details").closest("details")).not.toHaveAttribute("open");
  });
});

function renderPage(overrides: Partial<React.ComponentProps<typeof QueryPage>> = {}) {
  render(
    <QueryPage
      question="average heart rate last month"
      onQuestionChange={vi.fn()}
      onSubmit={(event) => event.preventDefault()}
      busy={false}
      cloudProvider="ollama"
      cloudConsentBusy={false}
      onCloudConsentChange={vi.fn()}
      {...overrides}
    />
  );
}
