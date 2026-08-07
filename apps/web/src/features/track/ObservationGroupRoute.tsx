import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { MeasurementType, ObservationGroupDetail, UpdateObservationGroupInput } from "@vitana/shared";
import { api } from "../../api.js";

type DraftRow = {
  id?: string;
  measurementCode: string;
  value: string;
  unit: string;
  note: string;
};

function localDateTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function groupKindLabel(kind: ObservationGroupDetail["kind"]): string {
  return kind.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function referenceContext(row: ObservationGroupDetail["observations"][number]): string {
  const range = row.referenceRange;
  const rangeText = range
    ? `${range.low === undefined ? "−∞" : range.low}–${range.high === undefined ? "∞" : range.high} ${range.unit}`
    : undefined;
  return [row.status && row.status !== "unknown" ? row.status : undefined, rangeText].filter(Boolean).join(" · ") || "—";
}

export function ObservationGroupRoute({
  groupId,
  activeProfileId,
  measurementTypes,
  onBack,
  onSelectMeasurement,
  onDataChanged,
  onNotice
}: {
  groupId: string;
  activeProfileId?: string;
  measurementTypes: MeasurementType[];
  onBack: () => void;
  onSelectMeasurement: (measurementCode: string) => void;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [group, setGroup] = useState<ObservationGroupDetail>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [collectedAt, setCollectedAt] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    setGroup(undefined);
    void api.observationGroup(groupId, controller.signal).then((loaded) => {
      if (!controller.signal.aborted) {
        setGroup(loaded);
        setLoading(false);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadError(error instanceof Error ? error.message : "Unable to load observation group.");
      }
    });
    return () => controller.abort();
  }, [groupId, activeProfileId]);

  const dirty = useMemo(() => editing && group !== undefined && (
    label !== group.label
    || collectedAt !== localDateTime(group.collectedAt)
    || removedIds.length > 0
    || rows.length !== group.observations.length
    || rows.some((row) => {
      if (!row.id) return true;
      const original = group.observations.find((entry) => entry.id === row.id);
      return !original || row.measurementCode !== original.measurementCode || row.value !== String(original.value)
        || row.unit !== original.unit || row.note !== (original.note ?? "");
    })
  ), [collectedAt, editing, group, label, removedIds, rows]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function beginEditing() {
    if (!group?.editable) return;
    setLabel(group.label);
    setCollectedAt(localDateTime(group.collectedAt));
    setRows(group.observations.map((entry) => ({
      id: entry.id,
      measurementCode: entry.measurementCode,
      value: String(entry.value),
      unit: entry.unit,
      note: entry.note ?? ""
    })));
    setRemovedIds([]);
    setSaveError(undefined);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setSaveError(undefined);
  }

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function removeRow(index: number) {
    const row = rows[index];
    if (row?.id) setRemovedIds((current) => [...current, row.id!]);
    setRows((current) => current.filter((_row, rowIndex) => rowIndex !== index));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!group || rows.length === 0) {
      setSaveError("An observation group must contain at least one observation.");
      return;
    }
    const timestamp = new Date(collectedAt);
    if (!label.trim() || !collectedAt || Number.isNaN(timestamp.getTime())) {
      setSaveError("Enter a group label and valid recorded date and time.");
      return;
    }
    const normalizedRows = rows.map((row) => ({
      ...row,
      value: Number(row.value),
      note: row.note.trim() || undefined
    }));
    if (normalizedRows.some((row) => !row.measurementCode.trim() || !row.unit.trim() || !Number.isFinite(row.value))) {
      setSaveError("Every observation needs a measurement, finite value, and unit.");
      return;
    }
    const input: UpdateObservationGroupInput = {
      expectedCollectedAt: group.collectedAt,
      label: label.trim(),
      collectedAt: timestamp.toISOString(),
      creates: normalizedRows.filter((row) => !row.id).map(({ measurementCode, value, unit, note }) => ({
        measurementCode, value, unit, note
      })),
      updates: normalizedRows.filter((row): row is typeof row & { id: string } => Boolean(row.id)).map(
        ({ id, measurementCode, value, unit, note }) => ({ id, measurementCode, value, unit, note })
      ),
      removals: removedIds
    };
    setSaving(true);
    setSaveError(undefined);
    try {
      const updated = await api.updateObservationGroup(group.id, input);
      setGroup(updated);
      setEditing(false);
      await onDataChanged();
      onNotice("Observation group updated.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save the observation group.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="observation-group-page" aria-live="polite"><p>Loading observation group…</p></section>;
  if (!group) {
    return (
      <section className="observation-group-page">
        <button type="button" onClick={onBack}>← Back to measurements</button>
        <h2>Observation group not found</h2>
        <p role="alert">{loadError ?? "This recorded group no longer exists."}</p>
      </section>
    );
  }

  return (
    <section className="observation-group-page" aria-labelledby="observation-group-title">
      <button type="button" onClick={onBack}>← Back to measurements</button>
      <header className="route-page-header">
        <div>
          <h2 id="observation-group-title">{group.label}</h2>
          <p>{groupKindLabel(group.kind)} · {group.observations.length} observation{group.observations.length === 1 ? "" : "s"}</p>
        </div>
        {!editing && group.editable ? <button type="button" onClick={beginEditing}>Edit group</button> : null}
      </header>
      <dl className="observation-group-metadata">
        <div><dt>Recorded</dt><dd>{group.collectedAt ? new Date(group.collectedAt).toLocaleString() : "Not recorded"}</dd></div>
        <div><dt>Source</dt><dd>{group.source.label}</dd></div>
        {group.source.importFileName ? <div><dt>Provenance</dt><dd>{group.source.importFileName}</dd></div> : null}
      </dl>
      {!group.editable ? <p className="summary-detail-hint" role="status">{group.readOnlyReason}</p> : null}

      {editing ? (
        <form onSubmit={(event) => void save(event)}>
          <div className="observation-group-fields">
            <label>Group label<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label>
            <label>Recorded date and time<input type="datetime-local" value={collectedAt} onChange={(event) => setCollectedAt(event.target.value)} required /></label>
          </div>
          <div className="query-table-scroll">
            <table>
              <caption className="sr-only">Edit observations in {group.label}</caption>
              <thead><tr><th>Measurement</th><th>Value</th><th>Unit</th><th>Note</th><th>Action</th></tr></thead>
              <tbody>{rows.map((row, index) => (
                <tr key={row.id ?? `new-${index}`}>
                  <td data-label="Measurement"><select value={row.measurementCode} onChange={(event) => updateRow(index, { measurementCode: event.target.value })} required>
                    <option value="">Select measurement</option>
                    {row.measurementCode && !measurementTypes.some((type) => type.code === row.measurementCode)
                      ? <option value={row.measurementCode}>{row.measurementCode}</option>
                      : null}
                    {measurementTypes.map((type) => <option key={type.code} value={type.code}>{type.display}</option>)}
                  </select></td>
                  <td data-label="Value"><input type="number" step="any" value={row.value} onChange={(event) => updateRow(index, { value: event.target.value })} required /></td>
                  <td data-label="Unit"><input value={row.unit} onChange={(event) => updateRow(index, { unit: event.target.value })} required /></td>
                  <td data-label="Note"><input value={row.note} onChange={(event) => updateRow(index, { note: event.target.value })} /></td>
                  <td data-label="Action"><button type="button" onClick={() => removeRow(index)} disabled={saving}>Remove</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <button type="button" onClick={() => setRows((current) => [...current, { measurementCode: "", value: "", unit: "", note: "" }])} disabled={saving}>Add observation</button>
          {saveError ? <p role="alert">{saveError}</p> : null}
          <div className="observation-group-actions">
            <button type="submit" disabled={saving || !dirty}>{saving ? "Saving…" : "Save changes"}</button>
            <button type="button" onClick={cancelEditing} disabled={saving}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="query-table-scroll">
          <table>
            <caption className="sr-only">Observations recorded in {group.label}</caption>
            <thead><tr><th>Measurement</th><th>Value</th><th>Status / reference</th><th>Note</th></tr></thead>
            <tbody>{group.observations.map((row) => (
              <tr key={row.id}>
                <td data-label="Measurement"><button type="button" className="link-button" onClick={() => onSelectMeasurement(row.measurementCode)}>{row.displayName}</button></td>
                <td data-label="Value">{row.value} {row.unit}</td>
                <td data-label="Status / reference">{referenceContext(row)}</td>
                <td data-label="Note">{row.note || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
