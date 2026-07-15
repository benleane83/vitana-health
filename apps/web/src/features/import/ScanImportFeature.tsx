import { useRef, useState } from "react";
import type { BodyCompositionDraft, BodyCompositionDraftRow, MeasurementType, UnitSystem } from "@local-fitness-advisor/shared";
import { api } from "../../api.js";
import { BodyCompositionImportPanel } from "../../pages/ImportPage.js";
import type { BodyCompositionEditableRow, ScanKind } from "../../types.js";
import { isSupportedBodyCompMimeType, readFileAsBase64, todayIsoDate } from "../../utils.js";

export function ScanImportFeature({
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
  const [busy, setBusy] = useState(false);
  const [scanKind, setScanKind] = useState<ScanKind>("body-composition");
  const [file, setFile] = useState<File>();
  const [draft, setDraft] = useState<BodyCompositionDraft>();
  const [rows, setRows] = useState<BodyCompositionEditableRow[]>([]);
  const [reportDate, setReportDate] = useState(todayIsoDate());
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(success: string, task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
      onNotice(success);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  async function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      onNotice("Select a PDF or image before preview.");
      return;
    }
    if (!isSupportedBodyCompMimeType(file.type)) {
      onNotice("Use a PDF, JPEG, or PNG body composition report.");
      return;
    }
    await run("Body composition scan parsed for review.", async () => {
      const contentBase64 = await readFileAsBase64(file);
      const nextDraft = await (scanKind === "blood-test" ? api.previewBloodTestReport : api.previewBodyCompositionReport)({
        fileName: file.name,
        mimeType: file.type,
        contentBase64
      });
      setDraft(nextDraft);
      setReportDate(nextDraft.reportDate?.slice(0, 10) ?? todayIsoDate());
      setRows(nextDraft.rows.map(toEditableRow));
    });
  }

  async function commit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) {
      onNotice("Preview a body composition report before saving.");
      return;
    }
    let approvedRows: BodyCompositionDraftRow[];
    try {
      approvedRows = rows.map(toDraftRow);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Invalid parsed observation.");
      return;
    }
    if (!approvedRows.some((row) => row.included)) {
      onNotice("Include at least one parsed row before saving.");
      return;
    }
    await run("Approved body composition observations saved.", async () => {
      await (scanKind === "blood-test" ? api.commitBloodTestReport : api.commitBodyCompositionReport)({
        fileName: draft.fileName,
        reportDate,
        sourceText: draft.sourceText,
        sourceChecksum: draft.checksum,
        rows: approvedRows
      });
      await onImported();
      setDraft(undefined);
      setRows([]);
      setFile(undefined);
      setReportDate(todayIsoDate());
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <section className="panel labs-panel">
      <label htmlFor="scan-kind">Report type</label>
      <select id="scan-kind" value={scanKind} onChange={(event) => setScanKind(event.target.value as ScanKind)}>
        <option value="body-composition">Body composition</option>
        <option value="blood-test">Lab results</option>
      </select>
      <BodyCompositionImportPanel
        busy={busy}
        file={file}
        draft={draft}
        rows={rows}
        reportDate={reportDate}
        measurementTypes={measurementTypes}
        units={units}
        inputRef={inputRef}
        onFileChange={setFile}
        onReportDateChange={setReportDate}
        onRowChange={(id, patch) => setRows((current) =>
          current.map((row) => row.id === id ? { ...row, ...patch } : row))}
        onAddRow={() => setRows((current) => [...current, createEditableRow()])}
        onPreview={preview}
        onCommit={commit}
      />
    </section>
  );
}

function toEditableRow(row: BodyCompositionDraftRow): BodyCompositionEditableRow {
  return { ...row, value: String(row.value) };
}

function toDraftRow(row: BodyCompositionEditableRow): BodyCompositionDraftRow {
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

function createEditableRow(): BodyCompositionEditableRow {
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