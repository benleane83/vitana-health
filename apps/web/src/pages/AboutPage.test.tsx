// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AboutPage } from "./AboutPage.js";

describe("AboutPage", () => {
  it("presents the approved product narrative with an accessible heading hierarchy", () => {
    render(<AboutPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Your Health. Connected." })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(9);
    expect(screen.getByRole("heading", { level: 2, name: "Why We Built Vitana" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Building the Future of Personal Health" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Lab Test Results" })).toBeInTheDocument();
    expect(screen.getByText("Vitana was created to change that.")).toBeInTheDocument();
    expect(screen.getByText("To help people understand their health, stay proactive in their care, and make better decisions through a complete, connected view of their wellbeing.")).toBeInTheDocument();
  });

  it("shows a matching illustration above each health story capability", () => {
    render(<AboutPage />);

    expect(screen.getByRole("img", { name: "Illustration of a laboratory test report and blood sample" })).toHaveAttribute(
      "src",
      "/images/about/lab-results.png",
    );
    expect(screen.getByRole("img", { name: "Illustration of a person running" })).toHaveAttribute(
      "src",
      "/images/about/activity-fitness-sleep.png",
    );
    expect(screen.getByRole("img", { name: "Illustration of body composition measurements" })).toHaveAttribute(
      "src",
      "/images/about/body-composition.png",
    );
  });
});
