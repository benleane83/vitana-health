import { useEffect, useState } from "react";
import { getPreferredUnit, type MeasurementType, type UnitSystem } from "@local-fitness-advisor/shared";
import type { UploadEditableRow } from "../types.js";
import { groupMeasurementTypes, measurementCategoryLabels } from "../utils.js";

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
  rows,
  measurementTypes,
  units,
  onRowChange,
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
  rows: UploadEditableRow[];
  measurementTypes: MeasurementType[];
  units: UnitSystem;
  onRowChange: (id: string, patch: Partial<UploadEditableRow>) => void;
  onAddRow: () => void;
  onCommit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const includedCount = rows.filter((row) => row.included).length;
  const measurementGroups = groupMeasurementTypes(measurementTypes);
  const [customMeasurementRows, setCustomMeasurementRows] = useState<Record<string, true>>({});

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
        </div>
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
        {rows.map((row, index) => {
          const forcedCustom = Boolean(customMeasurementRows[row.id]);
          const selectedMeasurementCode = forcedCustom ? "" : resolveKnownMeasurementSelection(row, measurementTypes);
          const showCustomFields = selectedMeasurementCode === "";
          return (
            <div className="bodycomp-row" role="row" key={row.id} data-included={row.included}>
              <span role="cell" className="bodycomp-include-cell">
                <input
                  type="checkbox"
                  checked={row.included}
                  id={`upload-include-${row.id}`}
                  aria-label={`Row ${index + 1}: save ${row.displayName}`}
                  onChange={(event) => onRowChange(row.id, { included: event.target.checked })}
                />
              </span>
              <span role="cell" className="bodycomp-measurement-cell">
                <label htmlFor={`upload-displayname-${row.id}`} className="sr-only">
                  Row {index + 1} display name
                </label>
                <label htmlFor={`upload-measurement-select-${row.id}`} className="sr-only">
                  Row {index + 1} select known measurement
                </label>
                <select
                  id={`upload-measurement-select-${row.id}`}
                  value={selectedMeasurementCode}
                  onChange={(event) => {
                    const selectedCode = event.target.value;
                    if (!selectedCode) {
                      setCustomMeasurementRows((current) => ({ ...current, [row.id]: true }));
                      return;
                    }
                    setCustomMeasurementRows((current) => {
                      if (!(row.id in current)) return current;
                      const next = { ...current };
                      delete next[row.id];
                      return next;
                    });
                    const selectedMeasurement = measurementTypes.find((type) => type.code === selectedCode);
                    if (!selectedMeasurement) return;
                    onRowChange(row.id, {
                      displayName: selectedMeasurement.display,
                      measurementCode: selectedMeasurement.code,
                      unit: row.unit.trim() || getPreferredUnit(selectedMeasurement, units),
                      confidence: "high",
                      generatedCode: false,
                      included: true
                    });
                  }}
                  aria-label={`Row ${index + 1} known measurement`}
                >
                  <option value="">Custom / unrecognized</option>
                  {measurementGroups.length > 1
                    ? measurementGroups.map(([category, types]) => (
                      <optgroup key={category} label={measurementCategoryLabels[category]}>
                        {types.map((type) => (
                          <option key={type.code} value={type.code}>{type.display} ({type.code})</option>
                        ))}
                      </optgroup>
                    ))
                    : measurementTypes.map((type) => (
                      <option key={type.code} value={type.code}>{type.display} ({type.code})</option>
                    ))}
                </select>
                {showCustomFields ? (
                  <>
                    <input
                      id={`upload-displayname-${row.id}`}
                      value={row.displayName}
                      onChange={(event) => onRowChange(row.id, { displayName: event.target.value })}
                      aria-label={`Row ${index + 1} display name`}
                    />
                    <label htmlFor={`upload-code-${row.id}`} className="sr-only">
                      Row {index + 1} measurement code
                    </label>
                    <input
                      id={`upload-code-${row.id}`}
                      value={row.measurementCode}
                      onChange={(event) => onRowChange(row.id, { measurementCode: event.target.value })}
                      aria-label={`Row ${index + 1} measurement code`}
                    />
                  </>
                ) : null}
                {row.sourceText ? <em>{row.sourceText}</em> : null}
              </span>
              <span role="cell">
                <label htmlFor={`upload-value-${row.id}`} className="sr-only">
                  Row {index + 1} value
                </label>
                <input
                  id={`upload-value-${row.id}`}
                  inputMode="decimal"
                  value={row.value}
                  onChange={(event) => onRowChange(row.id, { value: event.target.value })}
                  aria-label={`Row ${index + 1} value`}
                />
              </span>
              <span role="cell">
                <label htmlFor={`upload-unit-${row.id}`} className="sr-only">
                  Row {index + 1} unit
                </label>
                <input
                  id={`upload-unit-${row.id}`}
                  value={row.unit}
                  onChange={(event) => onRowChange(row.id, { unit: event.target.value })}
                  aria-label={`Row ${index + 1} unit`}
                />
              </span>
              <span role="cell" className="bodycomp-confidence-cell">
                <strong data-confidence={row.confidence}>{row.confidence}</strong>
                {row.generatedCode ? <small>Generated code</small> : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="labs-actions">
        <button disabled={busy} type="button" onClick={onAddRow}>Add row</button>
        <span className="empty">Only selected rows will be saved as observations.</span>
        <button disabled={busy || includedCount === 0 || Boolean(staleMappingWarning)} type="submit">
          Save approved observations
        </button>
      </div>
    </form>
  );
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
