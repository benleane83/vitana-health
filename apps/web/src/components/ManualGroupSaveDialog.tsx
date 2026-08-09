import { useEffect, useRef } from "react";

interface ManualGroupSaveDialogProps {
  open: boolean;
  defaultGroup: string;
  rowCount: number;
  groupName: string;
  namingRequired?: boolean;
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
  namingRequired = false,
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
        <h2 id="manual-group-save-title">
          {namingRequired ? "Name this custom group" : "Save this measurement set?"}
        </h2>
        <p>{namingRequired
          ? "Enter a name for this group before importing its measurements."
          : `You are adding ${rowCount} ${defaultGroup} row${rowCount === 1 ? "" : "s"}. Save it as a custom group to preload these measurements next time.`}
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
          {!namingRequired ? (
            <button type="button" className="confirm-dialog-cancel" onClick={onSkip}>Import without saving</button>
          ) : null}
          <button type="submit" className="confirm-dialog-confirm" disabled={!groupName.trim()}>
            {namingRequired ? "Import observations" : "Save as custom group"}
          </button>
        </div>
      </form>
    </dialog>
  );
}