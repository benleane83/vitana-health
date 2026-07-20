import { useRef, useState } from "react";
import type {
  BodyCompositionDraft,
  BodyCompositionDraftRow,
  MeasurementType,
  UnitSystem,
  UploadColumnMappingOverride,
  UploadDraftRow,
  UploadImportDraft
} from "@local-fitness-advisor/shared";
import { api } from "../../api.js";
import { ImportDraftReview } from "../../components/ImportDraftReview.js";
import type { UploadEditableRow } from "../../types.js";
import {
  isSupportedBodyCompMimeType,
  readFileAsBase64,
  todayIsoDate
} from "../../utils.js";

const MAX_STRUCTURED_UPLOAD_BYTES = 2_000_000; // 2 MB structured file (CSV/TSV) limit
const MAX_REPORT_UPLOAD_BYTES = 15_000_000;

type UploadKind = "structured" | "body-composition" | "blood-test";

export function UploadImportFeature(props: {
  measurementTypes: MeasurementType[];
  units: UnitSystem;
  onImported: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [uploadKind, setUploadKind] = useState<UploadKind>("body-composition");

  return (
    <>
      <section className="panel labs-panel">
        <div className="labs-upload-form">
          <label htmlFor="upload-kind">Upload type</label>
          <select
            id="upload-kind"
            value={uploadKind}
            onChange={(event) => setUploadKind(event.target.value as UploadKind)}
          >
            <option value="body-composition">Body composition report</option>
            <option value="blood-test">Lab results report</option>
            <option value="structured">CSV or TSV observations</option>
          </select>
        </div>
      </section>
      {uploadKind === "structured" ? (
        <StructuredUploadFeature {...props} />
      ) : (
        <ReportUploadFeature key={uploadKind} reportKind={uploadKind} {...props} />
      )}
    </>
  );
}

function StructuredUploadFeature({
  measurementTypes,
  units,
  onImported,
  onNotice
}: {
  measurementTypes: MeasurementType[];
  units: UnitSystem;
  onImported: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<UploadImportDraft>();
  const [mapping, setMapping] = useState<UploadColumnMappingOverride>({});
  const [appliedMappingSignature, setAppliedMappingSignature] = useState<string>();
  const [rows, setRows] = useState<UploadEditableRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const mappingDirty = draft !== undefined && JSON.stringify(mapping) !== appliedMappingSignature;

  function resetDraftState() {
    setDraft(undefined);
    setMapping({});
    setAppliedMappingSignature(undefined);
    setRows([]);
  }

  function selectFile(nextFile: File | undefined) {
    setFile(nextFile);
    // Selecting a different file invalidates any existing draft/mapping —
    // never carry a mapping computed against a previous file into a new one.
    resetDraftState();
  }

  async function runPreview(overrideMapping: UploadColumnMappingOverride) {
    if (!file) {
      onNotice("Select a CSV or TSV file before preview.");
      return;
    }
    if (file.size === 0) {
      onNotice("The selected file is empty.");
      return;
    }
    if (file.size > MAX_STRUCTURED_UPLOAD_BYTES) {
      onNotice("The selected file is too large for local preview. Use a file smaller than 2 MB.");
      return;
    }
    setBusy(true);
    try {
      const content = await file.text();
      const nextDraft = await api.previewStructuredUpload({
        fileName: file.name,
        content,
        mapping: overrideMapping
      });
      setDraft(nextDraft);
      setMapping(nextDraft.mapping);
      setAppliedMappingSignature(JSON.stringify(nextDraft.mapping));
      setRows(nextDraft.rows.map(toEditableRow));
      onNotice("Upload parsed for review.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  async function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runPreview(mapping);
  }

  async function updateMapping() {
    await runPreview(mapping);
  }

  async function commit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) {
      onNotice("Preview a file before saving.");
      return;
    }
    if (mappingDirty) {
      onNotice("Update the mapping preview before saving.");
      return;
    }
    let approvedRows: UploadDraftRow[];
    try {
      approvedRows = rows.filter((row) => row.included).map(toDraftRow);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Invalid parsed observation.");
      return;
    }
    if (approvedRows.length === 0) {
      onNotice("Include at least one parsed row before saving.");
      return;
    }
    setBusy(true);
    try {
      await api.commitStructuredUpload({
        fileName: draft.fileName,
        format: draft.format,
        checksum: draft.checksum,
        rows: approvedRows
      });
      await onImported();
      onNotice("Approved upload observations saved.");
      setFile(undefined);
      resetDraftState();
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel labs-panel bodycomp-import">
      <form className="labs-upload-form" onSubmit={preview}>
        <UploadEntryIntro fileDescription="a CSV or TSV file" />
        <label htmlFor="upload-file">Select observation file</label>
        <input
          id="upload-file"
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          aria-describedby="upload-file-help"
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
        <p id="upload-file-help" className="empty">
          CSV and TSV files are detected automatically. Include measurement and value columns; observedAt and unit are optional.
        </p>
        <div className="labs-upload-actions">
          <button disabled={busy || !file} type="submit">Preview upload</button>
        </div>
      </form>

      {draft ? (
        <div className="upload-mapping">
          <p className="eyebrow">Column mapping</p>
          <LongFormatMappingEditor
            columns={draft.columns}
            mapping={mapping}
            onChange={setMapping}
          />
          <div className="upload-mapping-actions">
            <button disabled={busy} type="button" onClick={() => void updateMapping()}>
              Update mapping preview
            </button>
            {mappingDirty ? (
              <span className="upload-mapping-stale" role="status">
                Mapping changed — update the preview to apply it.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {draft ? (
        <ImportDraftReview
          fileName={draft.fileName}
          diagnostics={draft.diagnostics}
          rowCount={draft.rowCount}
          truncated={draft.truncated}
          busy={busy}
          staleMappingWarning={mappingDirty ? "Update the mapping preview above before saving." : undefined}
          rows={rows}
          measurementTypes={measurementTypes}
          units={units}
          onRowChange={(id, patch) => setRows((current) =>
            current.map((row) => row.id === id ? { ...row, ...patch } : row))}
          onAddRow={() => setRows((current) => [...current, createEditableRow()])}
          onCommit={commit}
        />
      ) : null}
    </section>
  );
}

function ReportUploadFeature({
  reportKind,
  measurementTypes,
  units,
  onImported,
  onNotice
}: {
  reportKind: Exclude<UploadKind, "structured">;
  measurementTypes: MeasurementType[];
  units: UnitSystem;
  onImported: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<BodyCompositionDraft>();
  const [rows, setRows] = useState<UploadEditableRow[]>([]);
  const [reportDate, setReportDate] = useState(todayIsoDate());
  const inputRef = useRef<HTMLInputElement>(null);
  const reportLabel = reportKind === "blood-test" ? "lab results" : "body composition";

  function selectFile(nextFile: File | undefined) {
    setFile(nextFile);
    setDraft(undefined);
    setRows([]);
  }

  async function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      onNotice("Select a PDF or image before preview.");
      return;
    }
    const mimeType = file.type;
    if (!isSupportedBodyCompMimeType(mimeType)) {
      onNotice("Use a PDF, JPEG, or PNG report.");
      return;
    }
    if (file.size === 0) {
      onNotice("The selected report is empty.");
      return;
    }
    if (file.size > MAX_REPORT_UPLOAD_BYTES) {
      onNotice("The selected report is too large for local preview. Use a file smaller than 15 MB.");
      return;
    }
    setBusy(true);
    try {
      const contentBase64 = await readFileAsBase64(file);
      const nextDraft = await (reportKind === "blood-test"
        ? api.previewBloodTestReport
        : api.previewBodyCompositionReport)({
        fileName: file.name,
        mimeType,
        contentBase64
      });
      setDraft(nextDraft);
      setRows(nextDraft.rows.map(toEditableRow));
      setReportDate(nextDraft.reportDate?.slice(0, 10) ?? todayIsoDate());
      onNotice(`${reportLabel} report parsed for review.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  async function commit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) {
      onNotice("Preview a report before saving.");
      return;
    }
    let approvedRows: BodyCompositionDraftRow[];
    try {
      approvedRows = rows.filter((row) => row.included).map(toDraftRow);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Invalid parsed observation.");
      return;
    }
    if (approvedRows.length === 0) {
      onNotice("Include at least one parsed row before saving.");
      return;
    }
    setBusy(true);
    try {
      await (reportKind === "blood-test"
        ? api.commitBloodTestReport
        : api.commitBodyCompositionReport)({
        fileName: draft.fileName,
        reportDate,
        sourceText: draft.sourceText,
        sourceChecksum: draft.checksum,
        rows: approvedRows
      });
      await onImported();
      onNotice(`Approved ${reportLabel} observations saved.`);
      selectFile(undefined);
      setReportDate(todayIsoDate());
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel labs-panel bodycomp-import">
      <form className="labs-upload-form" onSubmit={preview}>
        <UploadEntryIntro fileDescription="a report" />
        <label htmlFor="report-upload-file">Select {reportLabel} report</label>
        <input
          id="report-upload-file"
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
        <p className="empty">PDF, JPEG, or PNG. Parsed locally before save.</p>
        <div className="labs-upload-actions">
          <button disabled={busy || !file} type="submit">Preview report</button>
        </div>
      </form>

      {draft ? (
        <ImportDraftReview
          fileName={draft.fileName}
          diagnostics={draft.diagnostics}
          rowCount={draft.rows.length}
          truncated={false}
          busy={busy}
          headerAction={(
            <label className="bodycomp-review-date" htmlFor="report-upload-date">
              Report date
              <input
                id="report-upload-date"
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
              />
            </label>
          )}
          rows={rows}
          measurementTypes={measurementTypes}
          units={units}
          onRowChange={(id, patch) => setRows((current) =>
            current.map((row) => row.id === id ? { ...row, ...patch } : row))}
          onAddRow={() => setRows((current) => [...current, createEditableRow()])}
          onCommit={commit}
        />
      ) : null}
    </section>
  );
}

function UploadEntryIntro({ fileDescription }: { fileDescription: string }) {
  return (
    <div className="upload-entry-intro">
      <h2>Check before you save</h2>
      <p>Choose {fileDescription}, review the readings we find, then save only what you want to keep. Your file is parsed locally.</p>
    </div>
  );
}

// ─── Long-format mapping editor ────────────────────────────────────────────────

type LongFormatColumnKey =
  | "dateColumn"
  | "measurementColumn"
  | "measurementCodeColumn"
  | "valueColumn"
  | "unitColumn"
  | "labelColumn"
  | "sourceNameColumn"
  | "noteColumn";

function LongFormatMappingEditor({
  columns,
  mapping,
  onChange
}: {
  columns: string[];
  mapping: UploadColumnMappingOverride;
  onChange: (mapping: UploadColumnMappingOverride) => void;
}) {
  const roles: Array<{ key: LongFormatColumnKey; label: string }> = [
    { key: "dateColumn", label: "Observed at / date column" },
    { key: "measurementColumn", label: "Measurement name column" },
    { key: "measurementCodeColumn", label: "Measurement code column" },
    { key: "valueColumn", label: "Value column" },
    { key: "unitColumn", label: "Unit column" },
    { key: "labelColumn", label: "Label / group column" },
    { key: "sourceNameColumn", label: "Source name column" },
    { key: "noteColumn", label: "Note column" }
  ];
  return (
    <div className="upload-mapping-grid">
      {roles.map(({ key, label }) => (
        <div className="upload-mapping-row" key={key}>
          <label htmlFor={`upload-mapping-${key}`}>{label}</label>
          <select
            id={`upload-mapping-${key}`}
            value={mapping[key] ?? ""}
            onChange={(event) => onChange({ ...mapping, [key]: event.target.value })}
          >
            <option value="">None</option>
            {columns.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

// ─── Editable row helpers ───────────────────────────────────────────────────────

function toEditableRow(row: UploadDraftRow): UploadEditableRow {
  return { ...row, value: String(row.value) };
}

function toDraftRow(row: UploadEditableRow): UploadDraftRow {
  const value = Number.parseFloat(row.value);
  if (!Number.isFinite(value)) throw new Error(`Enter a numeric value for ${row.displayName || row.label}.`);
  if (!row.measurementCode.trim()) throw new Error(`Measurement code is required for ${row.displayName || row.label}.`);
  if (!row.unit.trim()) throw new Error(`Unit is required for ${row.displayName || row.label}.`);
  return {
    ...row,
    measurementCode: row.measurementCode.trim(),
    displayName: row.displayName.trim() || row.label.trim(),
    value,
    unit: row.unit.trim()
  };
}

function createEditableRow(): UploadEditableRow {
  return {
    id: globalThis.crypto.randomUUID(),
    label: "",
    measurementCode: "",
    displayName: "",
    value: "",
    unit: "",
    confidence: "low",
    included: true,
    generatedCode: true
  };
}
