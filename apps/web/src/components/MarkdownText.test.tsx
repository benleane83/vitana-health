// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./MarkdownText.js";

describe("MarkdownText", () => {
  it("renders model Markdown as semantic content", () => {
    render(
      <MarkdownText>{`**Practical observations**

- **Heart rate:** 88 bpm
- Lab values are normal

**Questions to bring to a clinician**

1. Should this be rechecked?
2. Is follow-up needed?

*Informational only.*`}</MarkdownText>
    );

    expect(screen.getByText("Practical observations").tagName).toBe("STRONG");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Heart rate:").tagName).toBe("STRONG");
    expect(screen.getByText("Informational only.").tagName).toBe("EM");
  });

  it("keeps raw HTML inert", () => {
    const { container } = render(<MarkdownText>{"<script>alert('no')</script>"}</MarkdownText>);

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert('no')</script>")).toBeInTheDocument();
  });
});
