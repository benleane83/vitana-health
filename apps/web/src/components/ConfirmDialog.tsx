/**
 * Accessible confirmation dialog using the native <dialog> element.
 *
 * Features:
 * - Focus moves to the dialog on open; returns to the trigger on close.
 * - Focus is trapped within the dialog while open.
 * - Escape key and the Cancel button both cancel the action.
 * - Destructive actions are visually and semantically distinguished.
 */
import { useEffect, useRef, useState } from "react";

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
  /**
   * When set, the dialog renders a labelled text field and passes its value to `onConfirm`. This
   * is the replacement for `window.prompt`, which blocks the renderer and cannot be styled or
   * focus-managed.
   */
  promptLabel?: string;
  /** Input type for the prompt field. Use "password" for secrets so they are not shoulder-read. */
  promptType?: "text" | "password";
  /** Receives the prompt field value, or the empty string when the dialog has no prompt. */
  onConfirm: (value: string) => void;
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
  promptLabel,
  promptType = "text",
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [promptValue, setPromptValue] = useState("");

  // Open / close the native <dialog> element and manage focus
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!returnFocusRef.current && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        returnFocusRef.current = document.activeElement;
      }
      if (!dialog.open) dialog.showModal();
      // A prompt needs the field focused to be usable; otherwise start on the safe (cancel) button.
      if (promptLabel) promptInputRef.current?.focus();
      else cancelButtonRef.current?.focus();
    } else {
      if (dialog.open) dialog.close();
      setPromptValue("");
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }
  }, [open, promptLabel]);

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
    if (promptLabel && event.key === "Enter" && document.activeElement === promptInputRef.current) {
      event.preventDefault();
      onConfirm(promptValue);
      return;
    }
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
      {promptLabel ? (
        <label className="confirm-dialog-prompt">
          {promptLabel}
          <input
            ref={promptInputRef}
            type={promptType}
            value={promptValue}
            autoComplete="off"
            onChange={(event) => setPromptValue(event.target.value)}
          />
        </label>
      ) : null}
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
          disabled={promptLabel ? promptValue.trim().length === 0 : false}
          onClick={() => onConfirm(promptValue)}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
