import { useEffect, useState, type ReactNode } from "react";
import { fallbackMeasurementCode, getPreferredUnit, type MeasurementType, type UnitSystem } from "@vitana/shared";
import type { UploadEditableRow } from "../types.js";
import { MeasurementCombobox } from "./MeasurementCombobox.js";

/**
 * Generic review table for a structured-upload draft. Renders the parsed rows
 * with an include checkbox, an editable measurement/value/unit, and a
 * confidence badge — the same review pattern used across the app's import
 * flows, but driven entirely by the shared `UploadDraftRow` shape so it works
 * for structured uploads.
 */
export function ImportDraftReview({
  fileName,
  diagnostics,
  rowCount,
  truncated,
  busy,
  staleMappingWarning,
  headerAction,
  rows,
  measurementTypes,
  units,
  onRowChange,
  onRemoveRow,
  onAddRow,
  onCommit
}: {
  fileName: string;
  diagnostics: string[];
  rowCount: number;
  truncated: boolean;
  busy: boolean;
  /** Shown instead of allowing save when the mapping has changed since this draft was generated. */
  staleMappingWarning?: string;
  headerAction?: ReactNode;
  rows: UploadEditableRow[];
  measurementTypes: MeasurementType[];
  units: UnitSystem;
  onRowChange: (id: string, patch: Partial<UploadEditableRow>) => void;
  onRemoveRow: (id: string) => void;
  onAddRow: () => void;
  onCommit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const includedCount = rows.filter((row) => row.included).length;
  const [customMeasurementRows, setCustomMeasurementRows] = useState<Record<string, true>>({});
  const indexedRows = rows.map((row, originalIndex) => ({ row, originalIndex }));
  const selectedRows = indexedRows.filter(({ row }) => row.included);
  const notSelectedRows = indexedRows.filter(({ row }) => !row.included);

  useEffect(() => {
    setCustomMeasurementRows((current) => {
      const next: Record<string, true> = {};
      const rowIds = new Set(rows.map((row) => row.id));
      for (const rowId of Object.keys(current)) {
        if (rowIds.has(rowId)) {
          next[rowId] = true;
        }
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [rows]);

  const renderRow = ({ row, originalIndex }: { row: UploadEditableRow; originalIndex: number }) => {
    const rowNumber = originalIndex + 1;
    const forcedCustom = Boolean(customMeasurementRows[row.id]);
    const selectedMeasurementCode = forcedCustom ? "" : resolveKnownMeasurementSelection(row, measurementTypes);
    const showCustomFields = forcedCustom || (!row.manuallyAdded && selectedMeasurementCode === "");
    return (
      <div className="bodycomp-row" role="row" key={row.id} data-included={row.included}>
        <span role="cell" className="bodycomp-include-cell">
          <input
            type="checkbox"
            checked={row.included}
            id={`upload-include-${row.id}`}
            aria-label={`Row ${rowNumber}: save ${row.displayName}`}
            onChange={(event) => {
              if (!event.target.checked && row.manuallyAdded === true && !row.value.trim()) {
                onRemoveRow(row.id);
                return;
              }
              onRowChange(row.id, { included: event.target.checked });
            }}
          />
        </span>
        <span role="cell" className="bodycomp-measurement-cell">
          <label htmlFor={`upload-displayname-${row.id}`} className="sr-only">
            Row {rowNumber} display name
          </label>
          <label htmlFor={`upload-measurement-select-${row.id}`} className="sr-only">
            Row {rowNumber} select known measurement
          </label>
          <MeasurementCombobox
            id={`upload-measurement-select-${row.id}`}
            ariaLabel={`Row ${rowNumber} known measurement`}
            measurementTypes={measurementTypes}
            selectedCode={selectedMeasurementCode}
            autoFocus={row.manuallyAdded === true}
            customLabel="Use a custom measurement"
            onSelectCustom={(typedName) => {
              setCustomMeasurementRows((current) => ({ ...current, [row.id]: true }));
              onRowChange(row.id, {
                displayName: typedName,
                measurementCode: fallbackMeasurementCode(typedName),
                unit: "",
                generatedCode: true
              });
            }}
            onSelect={(selectedMeasurement) => {
              setCustomMeasurementRows((current) => {
                if (!(row.id in current)) return current;
                const next = { ...current };
                delete next[row.id];
                return next;
              });
              onRowChange(row.id, {
                displayName: selectedMeasurement.display,
                measurementCode: selectedMeasurement.code,
                unit: row.unit.trim() || getPreferredUnit(selectedMeasurement, units),
                confidence: "high",
                generatedCode: false,
                included: true
              });
            }}
          />
          {showCustomFields ? (
            <>
              <input
                id={`upload-displayname-${row.id}`}
                value={row.displayName}
                onChange={(event) => onRowChange(row.id, {
                  displayName: event.target.value,
                  measurementCode: fallbackMeasurementCode(event.target.value),
                  generatedCode: true
                })}
                aria-label={`Row ${rowNumber} display name`}
              />
            </>
          ) : null}
          {row.sourceText ? <em>{row.sourceText}</em> : null}
        </span>
        <span role="cell">
          <label htmlFor={`upload-value-${row.id}`} className="sr-only">
            Row {rowNumber} value
          </label>
          <input
            id={`upload-value-${row.id}`}
            inputMode="decimal"
            value={row.value}
            onChange={(event) => onRowChange(row.id, { value: event.target.value })}
            aria-label={`Row ${rowNumber} value`}
          />
        </span>
        <span role="cell">
          <label htmlFor={`upload-unit-${row.id}`} className="sr-only">
            Row {rowNumber} unit
          </label>
          <input
            id={`upload-unit-${row.id}`}
            value={row.unit}
            onChange={(event) => onRowChange(row.id, { unit: event.target.value })}
            aria-label={`Row ${rowNumber} unit`}
          />
        </span>
        <span role="cell" className="bodycomp-confidence-cell">
          <strong data-confidence={row.confidence}>{row.confidence}</strong>
          {row.generatedCode ? <small>Generated code</small> : null}
        </span>
      </div>
    );
  };

  return (
    <form className="bodycomp-review" onSubmit={onCommit}>
      <div className="bodycomp-review-header">
        <div>
          <p className="eyebrow">Review before saving</p>
          <h3>{fileName}</h3>
          <p className="empty" aria-live="polite">
            {rows.length} parsed row(s) of {rowCount} detected, {includedCount} selected for save.
            {truncated ? " Only the first 200 rows are shown." : ""}
          </p>
          <p className="bodycomp-review-hint">
            Edit or unselect readings that do not match your report.
          </p>
        </div>
        {headerAction}
      </div>

      {staleMappingWarning ? (
        <p className="upload-mapping-stale" role="alert">{staleMappingWarning}</p>
      ) : null}

      {diagnostics.length > 0 ? (
        <div className="bodycomp-diagnostics" role="status" aria-label="Parse diagnostics">
          {diagnostics.slice(0, 6).map((diagnostic) => (
            <span key={diagnostic}>{diagnostic}</span>
          ))}
        </div>
      ) : null}

      <div className="bodycomp-rows" role="table" aria-label="Parsed upload observations">
        <div className="bodycomp-row bodycomp-row-head" role="row">
          <span role="columnheader">Save</span>
          <span role="columnheader">Measurement</span>
          <span role="columnheader">Value</span>
          <span role="columnheader">Unit</span>
          <span role="columnheader">Confidence</span>
        </div>
        <div
          className="bodycomp-row-group"
          role="rowgroup"
          aria-label={`Selected for save, ${measurementCountLabel(selectedRows.length)}`}
        >
          <div className="bodycomp-row-group-heading">
            <strong>Selected for save</strong>
            <span>{selectedRows.length}</span>
          </div>
          {selectedRows.length > 0
            ? selectedRows.map(renderRow)
            : <p className="bodycomp-row-group-empty">Select at least one measurement to save it.</p>}
          <div className="bodycomp-row-group-actions">
            <button disabled={busy} type="button" onClick={onAddRow}>Add row</button>
          </div>
        </div>
        <div
          className="bodycomp-row-group"
          role="rowgroup"
          aria-label={`Not selected, ${measurementCountLabel(notSelectedRows.length)}`}
        >
          <div className="bodycomp-row-group-heading">
            <strong>Not selected</strong>
            <span>{notSelectedRows.length}</span>
          </div>
          {notSelectedRows.length > 0
            ? notSelectedRows.map(renderRow)
            : <p className="bodycomp-row-group-empty">All measurements are selected for save.</p>}
        </div>
      </div>

      <div className="labs-actions">
        <span className="empty">Only selected rows will be saved as observations.</span>
        <button disabled={busy || includedCount === 0 || Boolean(staleMappingWarning)} type="submit">
          Save approved rows
        </button>
      </div>
    </form>
  );
}

function measurementCountLabel(count: number): string {
  return `${count} ${count === 1 ? "measurement" : "measurements"}`;
}

function resolveKnownMeasurementSelection(row: UploadEditableRow, measurementTypes: MeasurementType[]): string {
  if (measurementTypes.length === 0) return "";
  const byCode = measurementTypes.find((type) => type.code === row.measurementCode.trim());
  if (byCode) return byCode.code;
  const normalizedLabel = row.displayName.trim().toLowerCase();
  if (!normalizedLabel) return "";
  const byLabel = measurementTypes.find((type) => {
    if (type.display.trim().toLowerCase() === normalizedLabel) return true;
    return type.aliases.some((alias) => alias.trim().toLowerCase() === normalizedLabel);
  });
  return byLabel?.code ?? "";
}
