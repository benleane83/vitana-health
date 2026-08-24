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
  suggestedFollowUps: ["What was the highest day?"],
  debug: { attempts: 1, repaired: false }
};

describe("QueryPage", () => {
  it("keeps heuristic confidence out of the result and diagnostics collapsed", () => {
    renderPage({ turns: [{ id: "turn-1", question: result.question, status: "answered", result }] });

    expect(screen.getByText("Average heart rate last month: 72.")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    const details = screen.getByText("Technical details").closest("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("shows the query plan and SQL without execution diagnostics", () => {
    renderPage({ turns: [{ id: "turn-1", question: result.question, status: "answered", result }] });

    expect(screen.getByText(/"intent": "aggregation"/)).toBeInTheDocument();
    expect(screen.getByText("SELECT AVG(value) FROM observations")).toBeInTheDocument();
    expect(screen.queryByText(/"attempts": 1/)).not.toBeInTheDocument();
  });

  it("turns typed recovery suggestions into composer actions", () => {
    const onQuestionChange = vi.fn();
    renderPage({
      onQuestionChange,
      turns: [{
        id: "turn-1",
        question: "Could you work this out?",
        status: "error",
        error: {
          message: "I could not understand that question well enough to query your data safely.",
          code: "QUERY_NOT_UNDERSTOOD",
          suggestions: ["Include a time range such as last month."],
          diagnostics: { attempts: 2, repaired: true, failureCategory: "json" }
        }
      }]
    });

    fireEvent.click(screen.getByRole("button", { name: "Include a time range such as last month." }));

    expect(onQuestionChange).toHaveBeenCalledWith("Include a time range such as last month.");
    expect(screen.getByText("Technical details").closest("details")).not.toHaveAttribute("open");
  });

  it("prefills a supported follow-up while keeping the answer visible", () => {
    const onQuestionChange = vi.fn();
    renderPage({
      onQuestionChange,
      turns: [{ id: "turn-1", question: result.question, status: "answered", result }]
    });

    fireEvent.click(screen.getByRole("button", { name: "What was the highest day?" }));

    expect(onQuestionChange).toHaveBeenCalledWith("What was the highest day?");
    expect(screen.getByText("Average heart rate last month: 72.")).toBeInTheDocument();
  });

  it("disables the composer at the conversation turn limit", () => {
    renderPage({
      turns: Array.from({ length: 25 }, (_, index) => ({
        id: `turn-${index + 1}`,
        question: `Question ${index + 1}`,
        status: "answered" as const,
        result
      }))
    });

    expect(screen.getByRole("textbox", { name: "Ask a follow-up" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Start a new conversation to continue")).toBeInTheDocument();
    expect(screen.getByText("Start a new conversation to ask more questions.")).toBeInTheDocument();
  });
});

function renderPage(overrides: Partial<React.ComponentProps<typeof QueryPage>> = {}) {
  render(
    <QueryPage
      question="average heart rate last month"
      onQuestionChange={vi.fn()}
      onSubmit={(event) => event.preventDefault()}
      busy={false}
      turns={[]}
      maxTurns={25}
      onNewConversation={vi.fn()}
      cloudProvider="ollama"
      cloudConsentBusy={false}
      onCloudConsentChange={vi.fn()}
      {...overrides}
    />
  );
}
