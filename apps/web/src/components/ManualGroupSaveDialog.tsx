import { useEffect, useRef } from "react";

interface ManualGroupSaveDialogProps {
  open: boolean;
  defaultGroup: string;
  rowCount: number;
  groupName: string;
  onGroupNameChange: (value: string) => void;
  onSave: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

export function ManualGroupSaveDialog({
  open,
  defaultGroup,
  rowCount,
  groupName,
  onGroupNameChange,
  onSave,
  onSkip,
  onCancel
}: ManualGroupSaveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      inputRef.current?.focus();
    } else if (dialog.open && typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }, [open]);

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

  return (
    <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="manual-group-save-title">
      <form
        className="manual-group-save-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (groupName.trim()) onSave();
        }}
      >
        <h2 id="manual-group-save-title">Save this measurement set?</h2>
        <p>
          You added {rowCount - 1} row{rowCount === 2 ? "" : "s"} to {defaultGroup}. Save it as a custom group to preload these measurements next time.
        </p>
        <div className="manual-group-save-field">
          <label htmlFor="manual-group-save-name">Custom group name</label>
          <input
            ref={inputRef}
            id="manual-group-save-name"
            value={groupName}
            onChange={(event) => onGroupNameChange(event.target.value)}
            placeholder="e.g. Weekend check-in"
          />
        </div>
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-dialog-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="confirm-dialog-cancel" onClick={onSkip}>Import without saving</button>
          <button type="submit" className="confirm-dialog-confirm" disabled={!groupName.trim()}>Save as custom group</button>
        </div>
      </form>
    </dialog>
  );
}