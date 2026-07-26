import { useEffect, useRef, useState } from "react";
import {
  calendarDateToUtcMidnight,
  isUtcMidnightTimestamp,
  observationCalendarDate,
  usesDateOnlyObservation
} from "@vitana/shared";
import type {
  HealthDataDetailEntry,
  MeasurementType,
  UpdateObservationInput
} from "@vitana/shared";

function toLocalDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}

export function ObservationEditDialog({
  entry,
  measurementTypes,
  busy,
  onClose,
  onSave
}: {
  entry: HealthDataDetailEntry;
  measurementTypes: MeasurementType[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: UpdateObservationInput) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFocusRef = useRef<HTMLSelectElement>(null);
  const onCloseRef = useRef(onClose);
  const [measurementCode, setMeasurementCode] = useState(entry.measurementCode);
  const [unit, setUnit] = useState(entry.unit);
  const initialLocalDateTime = toLocalDateTime(entry.timestamp);
  const initialDateOnly = usesDateOnlyObservation(
    measurementTypes.find((type) => type.code === entry.measurementCode)?.aggregation
  );
  const [observedAt, setObservedAt] = useState(() => initialDateOnly
    ? observationCalendarDate(entry.timestamp)
    : initialLocalDateTime
  );
  const [preservedTime, setPreservedTime] = useState(() =>
    isUtcMidnightTimestamp(entry.timestamp) ? "00:00" : initialLocalDateTime.slice(11)
  );

  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      if (!dialog.open) dialog.setAttribute("open", "");
    }
    firstFocusRef.current?.focus();
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, []);

  const currentMeasurementIsCustom = !measurementTypes.some((type) => type.code === entry.measurementCode);
  const dateOnlyObservation = usesDateOnlyObservation(
    measurementTypes.find((type) => type.code === measurementCode)?.aggregation
  );

  return (
    <dialog ref={dialogRef} className="observation-edit-dialog" aria-labelledby="observation-edit-title">
      <div className="panel-heading-row">
        <div>
          <p className="eyebrow">Single record</p>
          <h2 id="observation-edit-title">Edit observation</h2>
        </div>
        <button type="button" className="observation-edit-close" onClick={onClose} disabled={busy}>Close</button>
      </div>
      <form
        className="observation-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const serializedObservedAt = dateOnlyObservation
            ? calendarDateToUtcMidnight(observedAt)
            : new Date(observedAt).toISOString();
          if (!serializedObservedAt) return;
          void onSave({
            measurementCode,
            observedAt: serializedObservedAt,
            value: Number(data.get("value")),
            unit: String(data.get("unit")).trim(),
            note: String(data.get("note")).trim() || undefined
          });
        }}
      >
        <label htmlFor="observation-edit-measurement">
          Measurement
          <select
            id="observation-edit-measurement"
            ref={firstFocusRef}
            value={measurementCode}
            disabled={busy}
            onChange={(event) => {
              const nextCode = event.target.value;
              const nextDateOnly = usesDateOnlyObservation(
                measurementTypes.find((type) => type.code === nextCode)?.aggregation
              );
              if (nextDateOnly && !dateOnlyObservation) {
                setPreservedTime(observedAt.slice(11) || preservedTime);
                setObservedAt(observedAt.slice(0, 10));
              } else if (!nextDateOnly && dateOnlyObservation) {
                setObservedAt(`${observedAt.slice(0, 10)}T${preservedTime}`);
              }
              setMeasurementCode(nextCode);
            }}
          >
            {currentMeasurementIsCustom ? <option value={entry.measurementCode}>{entry.displayName}</option> : null}
            {measurementTypes.map((type) => <option key={type.code} value={type.code}>{type.display}</option>)}
          </select>
        </label>

        <label htmlFor="observation-edit-timestamp">
          {dateOnlyObservation ? "Date" : "Date and time"}
          <input
            id="observation-edit-timestamp"
            name="observedAt"
            type={dateOnlyObservation ? "date" : "datetime-local"}
            value={observedAt}
            onChange={(event) => setObservedAt(event.target.value)}
            required
            disabled={busy}
          />
        </label>

        <label htmlFor="observation-edit-value">
          Value
          <input id="observation-edit-value" name="value" type="number" step="any" defaultValue={entry.value ?? ""} required disabled={busy} />
        </label>

        <label htmlFor="observation-edit-unit">
          Unit
          <input id="observation-edit-unit" name="unit" value={unit} onChange={(event) => setUnit(event.target.value)} required maxLength={40} disabled={busy} />
        </label>

        <label htmlFor="observation-edit-note" className="wide">
          Note
          <textarea id="observation-edit-note" name="note" defaultValue={entry.note ?? ""} maxLength={1000} disabled={busy} />
        </label>

        <div className="observation-edit-actions wide">
          <button type="button" className="confirm-dialog-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </dialog>
  );
}