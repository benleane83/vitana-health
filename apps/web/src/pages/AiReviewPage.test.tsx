import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Insight } from "@vitana/shared";
import { AiReviewPage } from "./AiReviewPage.js";

const insight: Insight = {
  id: "insight-test",
  createdAt: "2026-08-09T08:00:00.000Z",
  title: "Model-powered wellness review",
  body: "A concise review.",
  evidence: ["Subject: adult profile.", "Steps: average 8000 count."],
  confidence: "medium",
  model: "ollama:test-model",
  safetyNotice: "Test safety notice"
};

describe("AiReviewPage", () => {
  it("shows progress beneath the disabled generation button", () => {
    render(<AiReviewPage busy latestInsight={insight} onGenerateInsight={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Generating insights..." })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Reviewing your health data. This may take a moment.");
  });

  it("keeps the full review prompt collapsed until requested", () => {
    render(<AiReviewPage busy={false} latestInsight={insight} onGenerateInsight={vi.fn()} />);

    const summary = screen.getByText("Review input used");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("Use only the supplied evidence");
    expect(disclosure).toHaveTextContent("Subject: adult profile.");

    fireEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");
  });
});