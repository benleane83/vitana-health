import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.js";

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error("chart domain is undefined");
  return <p>All good</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders the failure instead of unmounting the tree", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary label="Track">
        <Boom fail />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Track could not be displayed");
    expect(screen.getByText("chart domain is undefined")).toBeInTheDocument();
  });

  it("recovers when the user retries after the cause is gone", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onReset = vi.fn();

    const { rerender } = render(
      <ErrorBoundary label="Track" onReset={onReset}>
        <Boom fail />
      </ErrorBoundary>
    );
    rerender(
      <ErrorBoundary label="Track" onReset={onReset}>
        <Boom fail={false} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("passes children through untouched when nothing throws", () => {
    render(
      <ErrorBoundary label="Track">
        <Boom fail={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
