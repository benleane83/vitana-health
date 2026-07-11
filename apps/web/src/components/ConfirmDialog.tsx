/**
 * Accessible confirmation dialog using the native <dialog> element.
 *
 * Features:
 * - Focus moves to the dialog on open; returns to the trigger on close.
 * - Focus is trapped within the dialog while open.
 * - Escape key and the Cancel button both cancel the action.
 * - Destructive actions are visually and semantically distinguished.
 */
import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  /** Whether the dialog is currently visible */
  open: boolean;
  /** Short title summarising the action */
  title: string;
  /** Human-readable description of what will happen */
  description: string;
  /** Label for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** Label for the confirm button (default: "Confirm") */
  confirmLabel?: string;
  /** When true, the confirm button is styled as a destructive action */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Open / close the native <dialog> element and manage focus
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      // Move focus to the safe (cancel) button
      cancelButtonRef.current?.focus();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [open]);

  // Close on native cancel event (Escape key)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCancel();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onCancel]);

  // Trap focus within the dialog
  function handleKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      onKeyDown={handleKeyDown}
    >
      <h2 id="confirm-dialog-title">{title}</h2>
      <p id="confirm-dialog-desc">{description}</p>
      <div className="confirm-dialog-actions">
        <button
          ref={cancelButtonRef}
          type="button"
          className="confirm-dialog-cancel"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={destructive ? "confirm-dialog-confirm confirm-dialog-destructive" : "confirm-dialog-confirm"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
