import { useEffect, useId, useState } from "react";
import type { BodyCompositionDraft, MeasurementType } from "@local-fitness-advisor/shared";
import { api } from "../api.js";
import type { PairedDevice, PendingPairing } from "../api.js";
import type { BodyCompositionEditableRow, ImportMode, ManualMarkerRow, ScanKind } from "../types.js";
import { formatBytes } from "../utils.js";

// ─── Tab IDs for tablist/tabpanel ARIA wiring ─────────────────────────────────

export function ImportPage({
  busy,
  mode,
  onModeChange,
  scanKind,
  onScanKindChange,
  observationGroup,
  observationGroupOptions,
  manualMeasurementTypes,
  labName,
  collectedAt,
  rows,
  onObservationGroupChange,
  onCustomObservationGroupChange,
  onLabNameChange,
  onCollectedAtChange,
  onRowChange,
  onAddRow,
  onRemoveRow,
  onSubmitManual,
  onSubmitUpload,
  onUploadFileChange,
  uploadInputRef,
  bodyCompFile,
  bodyCompDraft,
  bodyCompRows,
  bodyCompReportDate,
  onBodyCompFileChange,
  onBodyCompReportDateChange,
  onBodyCompRowChange,
  measurementTypes,
  onPreviewBodyComp,
  onCommitBodyComp,
  bodyCompInputRef,
  pendingPairings,
  onApprovePairing,
  onDenyPairing
}: {
  busy: boolean;
  mode: ImportMode;
  onModeChange: (mode: ImportMode) => void;
  scanKind: ScanKind;
  onScanKindChange: (kind: ScanKind) => void;
  observationGroup: string;
  observationGroupOptions: string[];
  manualMeasurementTypes: MeasurementType[];
  labName: string;
  collectedAt: string;
  rows: ManualMarkerRow[];
  onObservationGroupChange: (value: string) => void;
  onCustomObservationGroupChange: (value: string) => void;
  onLabNameChange: (value: string) => void;
  onCollectedAtChange: (value: string) => void;
  onRowChange: (id: string, patch: Partial<ManualMarkerRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onSubmitManual: (event: React.FormEvent<HTMLFormElement>) => void;
  onSubmitUpload: (event: React.FormEvent<HTMLFormElement>) => void;
  onUploadFileChange: (file?: File) => void;
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
  bodyCompFile?: File;
  bodyCompDraft?: BodyCompositionDraft;
  bodyCompRows: BodyCompositionEditableRow[];
  bodyCompReportDate: string;
  onBodyCompFileChange: (file?: File) => void;
  onBodyCompReportDateChange: (value: string) => void;
  onBodyCompRowChange: (id: string, patch: Partial<BodyCompositionEditableRow>) => void;
  measurementTypes: MeasurementType[];
  onPreviewBodyComp: (event: React.FormEvent<HTMLFormElement>) => void;
  onCommitBodyComp: (event: React.FormEvent<HTMLFormElement>) => void;
  bodyCompInputRef: React.RefObject<HTMLInputElement | null>;
  pendingPairings: PendingPairing[];
  onApprovePairing: (id: string) => void;
  onDenyPairing: (id: string) => void;
}) {
  const manualTabId = "import-tab-manual";
  const uploadTabId = "import-tab-upload";
  const scanTabId = "import-tab-scan";
  const fitnessTabId = "import-tab-fitness";
  const manualPanelId = "import-panel-manual";
  const uploadPanelId = "import-panel-upload";
  const scanPanelId = "import-panel-scan";
  const fitnessPanelId = "import-panel-fitness";

  return (
    <section className="import-page">
      <div className="import-header">
        <div>
          <p className="eyebrow">Bring local data into the vault</p>
          <h1>Import</h1>
        </div>
        <p className="import-copy">
          Add observations manually, from CSV files, scans, or your fitness tracker.
        </p>
      </div>

      {/* Tab list — proper ARIA tab semantics */}
      <div className="import-tabs" role="tablist" aria-label="Import mode">
        <button
          id={manualTabId}
          role="tab"
          aria-selected={mode === "manual"}
          aria-controls={manualPanelId}
          className={mode === "manual" ? "active" : ""}
          onClick={() => onModeChange("manual")}
          tabIndex={mode === "manual" ? 0 : -1}
        >
          Manual
        </button>
        <button
          id={uploadTabId}
          role="tab"
          aria-selected={mode === "upload"}
          aria-controls={uploadPanelId}
          className={mode === "upload" ? "active" : ""}
          onClick={() => onModeChange("upload")}
          tabIndex={mode === "upload" ? 0 : -1}
        >
          Upload CSV
        </button>
        <button
          id={scanTabId}
          role="tab"
          aria-selected={mode === "scan"}
          aria-controls={scanPanelId}
          className={mode === "scan" ? "active" : ""}
          onClick={() => onModeChange("scan")}
          tabIndex={mode === "scan" ? 0 : -1}
        >
          Scan
        </button>
        <button
          id={fitnessTabId}
          role="tab"
          aria-selected={mode === "fitness"}
          aria-controls={fitnessPanelId}
          className={mode === "fitness" ? "active" : ""}
          onClick={() => onModeChange("fitness")}
          tabIndex={mode === "fitness" ? 0 : -1}
        >
          Fitness Tracker
        </button>
      </div>

      {mode === "manual" ? (
        <div id={manualPanelId} role="tabpanel" aria-labelledby={manualTabId}>
          <ManualEntryForm
            busy={busy}
            observationGroup={observationGroup}
            observationGroupOptions={observationGroupOptions}
            labName={labName}
            collectedAt={collectedAt}
            rows={rows}
            measurementTypes={manualMeasurementTypes}
            onObservationGroupChange={onObservationGroupChange}
            onCustomObservationGroupChange={onCustomObservationGroupChange}
            onLabNameChange={onLabNameChange}
            onCollectedAtChange={onCollectedAtChange}
            onRowChange={onRowChange}
            onAddRow={onAddRow}
            onRemoveRow={onRemoveRow}
            onSubmit={onSubmitManual}
          />
        </div>
      ) : mode === "upload" ? (
        <div id={uploadPanelId} role="tabpanel" aria-labelledby={uploadTabId}>
          <form className="labs-upload-form" onSubmit={onSubmitUpload}>
            <label htmlFor="csv-upload">Select observation CSV</label>
            <input id="csv-upload" ref={uploadInputRef} type="file" accept=".csv,text/csv" aria-describedby="csv-upload-help" onChange={(event) => onUploadFileChange(event.target.files?.[0])} />
            <p id="csv-upload-help" className="empty">Use columns: observedAt, measurement, value, unit, label, sourceName.</p>
            <div className="labs-upload-actions">
              <button disabled={busy} type="submit">Upload CSV</button>
              <button type="button" onClick={downloadObservationCsvTemplate}>Download CSV Template</button>
            </div>
          </form>
        </div>
      ) : mode === "scan" ? (
        <div id={scanPanelId} role="tabpanel" aria-labelledby={scanTabId}>
          <section className="panel labs-panel">
            <label htmlFor="scan-kind">Report type</label>
            <select id="scan-kind" value={scanKind} onChange={(event) => onScanKindChange(event.target.value as ScanKind)}>
              <option value="body-composition">Body composition</option>
              <option value="blood-test">Blood test</option>
            </select>
            <BodyCompositionImportPanel
              busy={busy} file={bodyCompFile} draft={bodyCompDraft} rows={bodyCompRows} reportDate={bodyCompReportDate}
              measurementTypes={measurementTypes}
              inputRef={bodyCompInputRef} onFileChange={onBodyCompFileChange} onReportDateChange={onBodyCompReportDateChange}
              onRowChange={onBodyCompRowChange} onPreview={onPreviewBodyComp} onCommit={onCommitBodyComp}
            />
          </section>
        </div>
      ) : (
        <div id={fitnessPanelId} role="tabpanel" aria-labelledby={fitnessTabId}>
          <FitnessTrackerImportPanel
            pendingPairings={pendingPairings}
            onApprove={onApprovePairing}
            onDeny={onDenyPairing}
          />
        </div>
      )}
    </section>
  );
}

function downloadObservationCsvTemplate() {
  const template = [
    "observedAt,measurement,value,unit,label,sourceName",
    "2026-07-11T08:30:00Z,glucose,95,mg/dL,Morning check,Home lab"
  ].join("\n");
  const blob = new Blob([template], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "observation-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

// ─── Manual lab entry form ────────────────────────────────────────────────────

const customObservationGroupValue = "__custom__";
const measurementCategoryLabels: Record<MeasurementType["category"], string> = {
  activity: "Activity",
  body: "Body",
  cardio: "Cardio",
  derived: "Derived",
  lab: "Lab",
  metabolic: "Metabolic",
  sleep: "Sleep"
};

function ManualEntryForm({
  busy,
  observationGroup,
  observationGroupOptions,
  labName,
  collectedAt,
  measurementTypes,
  rows,
  onObservationGroupChange,
  onCustomObservationGroupChange,
  onLabNameChange,
  onCollectedAtChange,
  onRowChange,
  onAddRow,
  onRemoveRow,
  onSubmit
}: {
  busy: boolean;
  observationGroup: string;
  observationGroupOptions: string[];
  labName: string;
  collectedAt: string;
  measurementTypes: MeasurementType[];
  rows: ManualMarkerRow[];
  onObservationGroupChange: (value: string) => void;
  onCustomObservationGroupChange: (value: string) => void;
  onLabNameChange: (value: string) => void;
  onCollectedAtChange: (value: string) => void;
  onRowChange: (id: string, patch: Partial<ManualMarkerRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [customMeasurementRows, setCustomMeasurementRows] = useState<Record<string, true>>({});
  const selectedObservationGroup = observationGroupOptions.includes(observationGroup)
    ? observationGroup
    : customObservationGroupValue;

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
    <form className="labs-manual-form" onSubmit={onSubmit}>
      <div className="labs-manual-meta">
        <div className="labs-manual-field">
          <label htmlFor="manual-collected-at">Observation date</label>
          <input
            id="manual-collected-at"
            type="date"
            value={collectedAt}
            onChange={(event) => onCollectedAtChange(event.target.value)}
          />
        </div>
        <div className="labs-manual-field">
          <label htmlFor="manual-observation-group">Observation group</label>
          <select
            id="manual-observation-group"
            value={selectedObservationGroup}
            onChange={(event) => onObservationGroupChange(
              event.target.value === customObservationGroupValue ? "" : event.target.value
            )}
          >
            {observationGroupOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
            <option value={customObservationGroupValue}>Custom group</option>
          </select>
          {selectedObservationGroup === customObservationGroupValue ? (
            <input
              id="manual-custom-observation-group"
              value={observationGroup}
              onChange={(event) => onCustomObservationGroupChange(event.target.value)}
              placeholder="Enter a custom group"
              aria-label="Custom observation group"
            />
          ) : null}
        </div>
        <div className="labs-manual-field">
          <label htmlFor="manual-lab-name">Lab name (optional)</label>
          <input
            id="manual-lab-name"
            value={labName}
            onChange={(event) => onLabNameChange(event.target.value)}
            placeholder="Quest Diagnostics"
          />
        </div>
      </div>

      <div className="labs-rows" role="table" aria-label="Manual observations">
        <div className="summary-row summary-row-head" role="row">
          <span role="columnheader">Measurement</span>
          <span role="columnheader">Value</span>
          <span role="columnheader">Unit</span>
          <span role="columnheader">Actions</span>
        </div>
        {rows.map((row, index) => (
          <ManualMeasurementRow
            key={row.id}
            row={row}
            rowIndex={index + 1}
            measurementTypes={measurementTypes}
            customMeasurement={Boolean(customMeasurementRows[row.id])}
            onSetCustomMeasurement={(enabled) => {
              setCustomMeasurementRows((current) => {
                if (enabled) {
                  return { ...current, [row.id]: true };
                }
                if (!(row.id in current)) {
                  return current;
                }
                const next = { ...current };
                delete next[row.id];
                return next;
              });
            }}
            onChange={onRowChange}
            onRemove={onRemoveRow}
          />
        ))}
      </div>

      <div className="labs-actions">
        <button type="button" onClick={onAddRow}>Add row</button>
        <button disabled={busy} type="submit">Import observations</button>
      </div>
    </form>
  );
}

function ManualMeasurementRow({
  row,
  rowIndex,
  measurementTypes,
  customMeasurement,
  onSetCustomMeasurement,
  onChange,
  onRemove
}: {
  row: ManualMarkerRow;
  rowIndex: number;
  measurementTypes: MeasurementType[];
  customMeasurement: boolean;
  onSetCustomMeasurement: (enabled: boolean) => void;
  onChange: (id: string, patch: Partial<ManualMarkerRow>) => void;
  onRemove: (id: string) => void;
}) {
  const measurementSelectId = `manual-measurement-select-${row.id}`;
  const markerInputId = `manual-measurement-input-${row.id}`;
  const codeInputId = `manual-code-input-${row.id}`;
  const valueInputId = `lab-value-${row.id}`;
  const unitInputId = `lab-unit-${row.id}`;
  const selectedMeasurementCode = customMeasurement ? "" : resolveKnownMeasurementSelectionForManual(row, measurementTypes);
  const showCustomFields = selectedMeasurementCode === "";
  const measurementGroups = groupMeasurementTypes(measurementTypes);

  return (
    <div className="summary-row labs-row" role="row">
      <span role="cell" className="labs-marker-cell">
        <label htmlFor={measurementSelectId} className="sr-only">
          Row {rowIndex}: select known measurement
        </label>
        <select
          id={measurementSelectId}
          value={selectedMeasurementCode}
          onChange={(event) => {
            const selectedCode = event.target.value;
            if (!selectedCode) {
              onSetCustomMeasurement(true);
              return;
            }
            onSetCustomMeasurement(false);
            const selectedMeasurement = measurementTypes.find((type) => type.code === selectedCode);
            if (!selectedMeasurement) {
              return;
            }
            onChange(row.id, {
              marker: selectedMeasurement.display,
              measurementCode: selectedMeasurement.code,
              unit: selectedMeasurement.canonicalUnit || row.unit
            });
          }}
        >
          <option value="">Custom / free text</option>
          {measurementGroups.length > 1
            ? measurementGroups.map(([category, types]) => (
              <optgroup key={category} label={measurementCategoryLabels[category]}>
                {types.map((type) => (
                  <option value={type.code} key={type.code}>{type.display} ({type.code})</option>
                ))}
              </optgroup>
            ))
            : measurementTypes.map((type) => (
              <option value={type.code} key={type.code}>{type.display} ({type.code})</option>
            ))}
        </select>
        {showCustomFields ? (
          <>
            <label htmlFor={markerInputId} className="sr-only">
              Row {rowIndex}: measurement name
            </label>
            <input
              id={markerInputId}
              value={row.marker}
              onChange={(event) => onChange(row.id, { marker: event.target.value, measurementCode: row.measurementCode })}
              placeholder="HDL cholesterol"
              aria-label={`Row ${rowIndex} measurement name`}
            />
            <label htmlFor={codeInputId} className="sr-only">
              Row {rowIndex}: measurement code
            </label>
            <input
              id={codeInputId}
              value={row.measurementCode ?? ""}
              onChange={(event) => onChange(row.id, { measurementCode: event.target.value })}
              placeholder="hdl_cholesterol"
              aria-label={`Row ${rowIndex} measurement code`}
            />
          </>
        ) : null}
      </span>
      <span role="cell">
        <label htmlFor={valueInputId} className="sr-only">Row {rowIndex} value</label>
        <input
          id={valueInputId}
          inputMode="decimal"
          value={row.value}
          onChange={(event) => onChange(row.id, { value: event.target.value })}
          placeholder="48"
          aria-label={`Row ${rowIndex} value`}
        />
      </span>
      <span role="cell">
        <label htmlFor={unitInputId} className="sr-only">Row {rowIndex} unit</label>
        <input
          id={unitInputId}
          value={row.unit}
          onChange={(event) => onChange(row.id, { unit: event.target.value })}
          placeholder="mg/dL"
          aria-label={`Row ${rowIndex} unit`}
        />
      </span>
      <span role="cell" className="labs-row-actions">
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          aria-label={`Remove row ${rowIndex}`}
        >
          Remove
        </button>
      </span>
    </div>
  );
}

// ─── Body composition import panel ────────────────────────────────────────────

function BodyCompositionImportPanel({
  busy,
  file,
  draft,
  rows,
  reportDate,
  measurementTypes,
  inputRef,
  onFileChange,
  onReportDateChange,
  onRowChange,
  onPreview,
  onCommit
}: {
  busy: boolean;
  file?: File;
  draft?: BodyCompositionDraft;
  rows: BodyCompositionEditableRow[];
  reportDate: string;
  measurementTypes: MeasurementType[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (file?: File) => void;
  onReportDateChange: (value: string) => void;
  onRowChange: (id: string, patch: Partial<BodyCompositionEditableRow>) => void;
  onPreview: (event: React.FormEvent<HTMLFormElement>) => void;
  onCommit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const includedCount = rows.filter((row) => row.included).length;
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
    <div className="bodycomp-import">
      <form className="labs-upload-form" onSubmit={onPreview}>
        <label htmlFor="bodycomp-file">Select report</label>
        <input
          id="bodycomp-file"
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(event) => onFileChange(event.target.files?.[0])}
        />
        <div className="bodycomp-upload-actions">
          <span aria-live="polite">
            {file ? `${file.name} / ${formatBytes(file.size)}` : "PDF, JPEG, or PNG. Parsed locally before save."}
          </span>
          <button disabled={busy || !file} type="submit">Preview scan</button>
        </div>
      </form>

      {draft ? (
        <form className="bodycomp-review" onSubmit={onCommit}>
          <div className="bodycomp-review-header">
            <div>
              <p className="eyebrow">Review before saving</p>
              <h3>{draft.fileName}</h3>
              <p className="empty" aria-live="polite">
                {rows.length} parsed row(s), {includedCount} selected for save.
              </p>
            </div>
            <label htmlFor="bodycomp-report-date">Report date</label>
            <input
              id="bodycomp-report-date"
              type="date"
              value={reportDate}
              onChange={(event) => onReportDateChange(event.target.value)}
            />
          </div>

          {draft.diagnostics.length > 0 ? (
            <div className="bodycomp-diagnostics" role="status" aria-label="Parse diagnostics">
              {draft.diagnostics.slice(0, 6).map((diagnostic) => (
                <span key={diagnostic}>{diagnostic}</span>
              ))}
            </div>
          ) : null}

          <div className="bodycomp-rows" role="table" aria-label="Parsed body composition observations">
            <div className="bodycomp-row bodycomp-row-head" role="row">
              <span role="columnheader">Save</span>
              <span role="columnheader">Measurement</span>
              <span role="columnheader">Value</span>
              <span role="columnheader">Unit</span>
              <span role="columnheader">Confidence</span>
            </div>
            {rows.map((row, index) => (
              (() => {
                const forcedCustom = Boolean(customMeasurementRows[row.id]);
                const selectedMeasurementCode = forcedCustom ? "" : resolveKnownMeasurementSelection(row, measurementTypes);
                const showCustomFields = selectedMeasurementCode === "";
                return (
              <div
                className="bodycomp-row"
                role="row"
                key={row.id}
                data-included={row.included}
              >
                <span role="cell" className="bodycomp-include-cell">
                  <input
                    type="checkbox"
                    checked={row.included}
                    id={`bodycomp-include-${row.id}`}
                    aria-label={`Row ${index + 1}: save ${row.displayName}`}
                    onChange={(event) => onRowChange(row.id, { included: event.target.checked })}
                  />
                </span>
                <span role="cell" className="bodycomp-measurement-cell">
                  <label htmlFor={`bodycomp-displayname-${row.id}`} className="sr-only">
                    Row {index + 1} display name
                  </label>
                  <label htmlFor={`bodycomp-measurement-select-${row.id}`} className="sr-only">
                    Row {index + 1} select known measurement
                  </label>
                  <select
                    id={`bodycomp-measurement-select-${row.id}`}
                    value={selectedMeasurementCode}
                    onChange={(event) => {
                      const selectedCode = event.target.value;
                      if (!selectedCode) {
                        setCustomMeasurementRows((current) => ({ ...current, [row.id]: true }));
                        return;
                      }
                      setCustomMeasurementRows((current) => {
                        if (!(row.id in current)) {
                          return current;
                        }
                        const next = { ...current };
                        delete next[row.id];
                        return next;
                      });
                      const selectedMeasurement = measurementTypes.find((type) => type.code === selectedCode);
                      if (!selectedMeasurement) {
                        return;
                      }
                      onRowChange(row.id, {
                        displayName: selectedMeasurement.display,
                        measurementCode: selectedMeasurement.code,
                        unit: selectedMeasurement.canonicalUnit || row.unit
                      });
                    }}
                    aria-label={`Row ${index + 1} known measurement`}
                  >
                    <option value="">Custom / detected text</option>
                    {measurementTypes.map((type) => (
                      <option key={type.code} value={type.code}>
                        {type.display} ({type.code})
                      </option>
                    ))}
                  </select>
                  {showCustomFields ? (
                    <>
                      <input
                        id={`bodycomp-displayname-${row.id}`}
                        value={row.displayName}
                        onChange={(event) => onRowChange(row.id, { displayName: event.target.value })}
                        aria-label={`Row ${index + 1} display name`}
                      />
                      <label htmlFor={`bodycomp-code-${row.id}`} className="sr-only">
                        Row {index + 1} measurement code
                      </label>
                      <input
                        id={`bodycomp-code-${row.id}`}
                        value={row.measurementCode}
                        onChange={(event) => onRowChange(row.id, { measurementCode: event.target.value })}
                        aria-label={`Row ${index + 1} measurement code`}
                      />
                    </>
                  ) : null}
                  {row.sourceText ? <em>{row.sourceText}</em> : null}
                </span>
                <span role="cell">
                  <label htmlFor={`bodycomp-value-${row.id}`} className="sr-only">
                    Row {index + 1} value
                  </label>
                  <input
                    id={`bodycomp-value-${row.id}`}
                    inputMode="decimal"
                    value={row.value}
                    onChange={(event) => onRowChange(row.id, { value: event.target.value })}
                    aria-label={`Row ${index + 1} value`}
                  />
                </span>
                <span role="cell">
                  <label htmlFor={`bodycomp-unit-${row.id}`} className="sr-only">
                    Row {index + 1} unit
                  </label>
                  <input
                    id={`bodycomp-unit-${row.id}`}
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
              })()
            ))}
          </div>

          <div className="labs-actions">
            <span className="empty">Only selected rows will be saved as observations.</span>
            <button disabled={busy || includedCount === 0} type="submit">Save approved observations</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ─── Fitness tracker pairing panel ────────────────────────────────────────────

function FitnessTrackerImportPanel({
  pendingPairings,
  onApprove,
  onDeny
}: {
  pendingPairings: PendingPairing[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);

  useEffect(() => {
    void api.pairing.devices().then(setPairedDevices).catch(() => setPairedDevices([]));
  }, [pendingPairings]);

  async function revokeDevice(id: string) {
    await api.pairing.revoke(id);
    setPairedDevices(await api.pairing.devices());
  }

  return (
    <section className="panel import-source-panel">
      <div>
        <p className="eyebrow">Android companion</p>
        <h2>Fitness Tracker</h2>
      </div>
      <p className="empty">
        Sync Health Connect from the Android companion app to import recent steps, heart rate, sleep,
        oxygen saturation, and other supported fitness samples into the local vault.
      </p>

      <div className="pairing-section">
        <div>
          <p className="eyebrow">Companion pairing</p>
          <strong>Scan to connect</strong>
        </div>
        <p className="empty">
          Open the companion app, tap <strong>Set Up Connection</strong>, and scan this QR code.
          The app will find this server automatically — no IP address required.
        </p>
        <PairingQr />
        <p className="empty pairing-hint">
          The QR code contains a short-lived pairing code and the server's LAN address. LAN use
          requires configured authentication and HTTPS, except for the explicit development-only HTTP mode.
        </p>
      </div>

      {pendingPairings.length > 0 ? (
        <div className="pairing-requests" aria-live="polite" aria-label="Pending pairing requests">
          <p className="eyebrow">Pairing requests</p>
          {pendingPairings.map((req) => (
            <div key={req.id} className="pairing-request-row">
              <div className="pairing-request-info">
                <strong>{req.deviceName}</strong>
                <span className="muted">Device ID: {req.deviceId.slice(0, 12)}…</span>
                <span className="muted">Requested: {new Date(req.requestedAt).toLocaleTimeString()}</span>
              </div>
              <div className="pairing-request-actions">
                <button
                  type="button"
                  onClick={() => onApprove(req.id)}
                  aria-label={`Approve pairing request from ${req.deviceName}`}
                >Approve</button>
                <button
                  type="button"
                  onClick={() => onDeny(req.id)}
                  aria-label={`Deny pairing request from ${req.deviceName}`}
                >Deny</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {pairedDevices.length > 0 ? (
        <div className="pairing-requests" aria-label="Paired devices">
          <p className="eyebrow">Paired devices</p>
          {pairedDevices.map((device) => (
            <div key={device.id} className="pairing-request-row">
              <div className="pairing-request-info">
                <strong>{device.deviceName}</strong>
                <span className="muted">
                  {device.revokedAt
                    ? `Revoked ${new Date(device.revokedAt).toLocaleString()}`
                    : device.lastUsedAt
                      ? `Last sync ${new Date(device.lastUsedAt).toLocaleString()}`
                      : "Not synced yet"}
                </span>
              </div>
              {!device.revokedAt ? (
                <button
                  type="button"
                  onClick={() => { void revokeDevice(device.id); }}
                  aria-label={`Revoke ${device.deviceName}`}
                >Revoke</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="import-guidance-grid">
        <div>
          <strong>1. Open companion app</strong>
          <span>Tap <em>Set Up Connection</em> and scan the short-lived QR code.</span>
        </div>
        <div>
          <strong>2. Approve pairing</strong>
          <span>A pairing request will appear above. Approve it to issue the companion a secure token.</span>
        </div>
        <div>
          <strong>3. Sync recent data</strong>
          <span>The app syncs automatically once paired. Token is stored on-device for future syncs.</span>
        </div>
      </div>
    </section>
  );
}

function PairingQr() {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void api.pairing
      .qr()
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to create pairing QR code.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  if (error) return <p className="empty" role="alert">{error}</p>;
  return (
    <div className="pairing-qr-wrap">
      {url ? (
        <img
          src={url}
          alt="Short-lived QR code for secure companion pairing. Scan with the Android companion app."
          width={200}
          height={200}
          className="pairing-qr"
        />
      ) : (
        <span className="empty" role="status" aria-live="polite">Creating short-lived pairing code…</span>
      )}
    </div>
  );
}

// ─── Helpers (kept local, not exported) ──────────────────────────────────────

function resolveKnownMeasurementSelectionForManual(row: ManualMarkerRow, measurementTypes: MeasurementType[]): string {
  if (measurementTypes.length === 0) {
    return "";
  }
  const explicitCode = row.measurementCode?.trim();
  if (explicitCode) {
    const byCode = measurementTypes.find((type) => type.code === explicitCode);
    if (byCode) {
      return byCode.code;
    }
  }
  const normalizedLabel = row.marker.trim().toLowerCase();
  if (!normalizedLabel) {
    return "";
  }
  const byLabel = measurementTypes.find((type) => {
    if (type.display.trim().toLowerCase() === normalizedLabel) {
      return true;
    }
    return type.aliases.some((alias) => alias.trim().toLowerCase() === normalizedLabel);
  });
  return byLabel?.code ?? "";
}

function groupMeasurementTypes(measurementTypes: MeasurementType[]): Array<[MeasurementType["category"], MeasurementType[]]> {
  const byCategory = new Map<MeasurementType["category"], MeasurementType[]>();
  for (const measurementType of measurementTypes) {
    const group = byCategory.get(measurementType.category) ?? [];
    group.push(measurementType);
    byCategory.set(measurementType.category, group);
  }
  return [...byCategory.entries()].sort(([left], [right]) =>
    measurementCategoryLabels[left].localeCompare(measurementCategoryLabels[right])
  );
}

function resolveKnownMeasurementSelection(row: BodyCompositionEditableRow, measurementTypes: MeasurementType[]): string {
  if (measurementTypes.length === 0) {
    return "";
  }
  const byCode = measurementTypes.find((type) => type.code === row.measurementCode.trim());
  if (byCode) {
    return byCode.code;
  }
  const normalizedLabel = row.displayName.trim().toLowerCase();
  if (!normalizedLabel) {
    return "";
  }
  const byLabel = measurementTypes.find((type) => {
    if (type.display.trim().toLowerCase() === normalizedLabel) {
      return true;
    }
    return type.aliases.some((alias) => alias.trim().toLowerCase() === normalizedLabel);
  });
  return byLabel?.code ?? "";
}
