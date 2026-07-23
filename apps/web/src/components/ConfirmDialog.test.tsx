import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.js";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

describe("ConfirmDialog", () => {
  it.each([
    ["confirmation", "Confirm"],
    ["cancellation", "Cancel"]
  ])("restores focus to its trigger after %s", (_, action) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const { rerender } = render(
      <ConfirmDialog
        open
        title="Reset metadata"
        description="Reset the metadata."
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: action }));
    rerender(
      <ConfirmDialog
        open={false}
        title="Reset metadata"
        description="Reset the metadata."
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});