import { useRef, useState } from "react";
import type { UnitSystem } from "@local-fitness-advisor/shared";
import { api } from "../../api.js";

export function CsvImportFeature({
  units,
  onImported,
  onNotice
}: {
  units: UnitSystem;
  onImported: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File>();
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      onNotice("Select a CSV file before upload.");
      return;
    }
    setBusy(true);
    try {
      await api.importObservationCsv(file.name, await file.text());
      await onImported();
      setFile(undefined);
      if (inputRef.current) inputRef.current.value = "";
      onNotice("Observation CSV imported.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="labs-upload-form" onSubmit={submit}>
      <label htmlFor="csv-upload">Select observation CSV</label>
      <input
        id="csv-upload"
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        aria-describedby="csv-upload-help"
        onChange={(event) => setFile(event.target.files?.[0])}
      />
      <p id="csv-upload-help" className="empty">
        Use columns: observedAt, measurement, value, unit, label, sourceName.
      </p>
      <div className="labs-upload-actions">
        <button disabled={busy} type="submit">Upload CSV</button>
        <button type="button" onClick={() => downloadObservationCsvTemplate(units)}>Download CSV Template</button>
      </div>
    </form>
  );
}

function downloadObservationCsvTemplate(units: UnitSystem) {
  const template = [
    "observedAt,measurement,value,unit,label,sourceName",
    `2026-07-11T08:30:00Z,glucose,${units === "imperial" ? "95,mg/dL" : "5.3,mmol/L"},Morning check,Home lab`
  ].join("\n");
  const blob = new Blob([template], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "observation-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}