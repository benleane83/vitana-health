import { useEffect, useState } from "react";
import {
  calendarDateToUtcMidnight,
  convertMeasurementValue,
  localCalendarDate,
  usesDateOnlyObservation
} from "@vitana/shared";
import type {
  HealthDataChartMode,
  HealthDataChartRange,
  HealthDataChartSeries,
  HealthDataDetail,
  HealthDataDetailEntry,
  MeasurementType,
  PersonalReferenceRangeInput,
  SleepSessionPage
} from "@vitana/shared";
import { DetailTrendChart } from "../components/Charts.js";
import { HypnogramPanel } from "../components/HypnogramPanel.js";
import { Pin } from "lucide-react";
import { formatTimestamp, formatShortTimestamp, formatDetailValue } from "../utils.js";
export { SummaryPage } from "./SummaryOverviewPage.js";

function detailKindLabel(kind: HealthDataDetailEntry["kind"]): string {
  return { observation: "Observation", sample: "Sample", activity: "Activity" }[kind];
}

function formatEntryTimestamp(entry: HealthDataDetailEntry): string {
  return entry.measurementCode === "steps"
    ? formatShortTimestamp(entry.timestamp)
    : formatTimestamp(entry.timestamp);
}

function formatReferenceRange(range: HealthDataDetail["referenceRange"]["effective"]): string {
  if (!range) return "Not set";
  if (range.low !== undefined && range.high !== undefined) {
    return `${formatDetailValue(range.low)}–${formatDetailValue(range.high)} ${range.unit}`;
  }
  if (range.high !== undefined) return `≤ ${formatDetailValue(range.high)} ${range.unit}`;
  if (range.low !== undefined) return `≥ ${formatDetailValue(range.low)} ${range.unit}`;
  return "Not set";
}

function referenceRangeSourceLabel(source: HealthDataDetail["referenceRange"]["source"]): string {
  return { personal: "Personal range", catalog: "Catalog range", none: "Not set" }[source];
}

function normalizeContextToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Compiled once at module load. Building this inside the predicate recompiled the pattern for
// every row rendered in the detail table.
const isoTimestampPattern = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z`;
const transferWindowPattern = new RegExp(
  `^${isoTimestampPattern}\\s*(?:→|->)\\s*${isoTimestampPattern}$`
);

function isTransferWindow(value: string): boolean {
  return transferWindowPattern.test(value.trim());
}

function compactSourceLabel(entry: HealthDataDetailEntry): string | undefined {
  const label = entry.sourceLabel?.trim();
  if (!label) {
    return undefined;
  }
  if (entry.sourceKind !== "health-connect") {
    return label;
  }

  const match = label.match(/^Health Connect:\s*([^:]+)(?::.+)?$/i);
  if (!match) {
    return "Health Connect";
  }
  const appLabel = match[1].trim();
  if (!appLabel) {
    return "Health Connect";
  }
  const friendlyAppLabel = appLabel.toLowerCase() === "android-companion" ? "Android" : appLabel;
  return `Health Connect · ${friendlyAppLabel}`;
}

function renderEntryContext(entry: HealthDataDetailEntry): string {
  const sourceLabel = compactSourceLabel(entry);
  if (entry.sourceKind === "manual-entry" && sourceLabel) {
    return sourceLabel;
  }
  const importFileName = entry.importFileName?.trim();
  const note = entry.note?.trim();
  const parts: string[] = [];

  if (sourceLabel) {
    parts.push(sourceLabel);
  }

  if (importFileName && entry.sourceKind !== "health-connect") {
    const normalizedImport = normalizeContextToken(importFileName);
    const normalizedSource = sourceLabel ? normalizeContextToken(sourceLabel) : "";
    const duplicatesSource =
      !!sourceLabel && (normalizedImport.includes(normalizedSource) || normalizedSource.includes(normalizedImport));
    if (!duplicatesSource) {
      parts.push(importFileName);
    }
  }

  if (note && !(entry.sourceKind === "health-connect" && isTransferWindow(note))) {
    const normalizedNote = normalizeContextToken(note);
    const duplicatesExisting = parts.some((part) => normalizeContextToken(part) === normalizedNote);
    if (!duplicatesExisting) {
      parts.push(note);
    }
  }

  return parts.join(" • ") || "—";
}

function primaryCountTile(counts: { observations: number; samples: number; activities: number; total: number }): {
  label: string;
  value: number;
} {
  if (counts.observations > 0) return { label: "Observations", value: counts.observations };
  if (counts.samples > 0) return { label: "Samples", value: counts.samples };
  if (counts.activities > 0) return { label: "Activities", value: counts.activities };
  return { label: "Entries", value: counts.total };
}

function toLocalDateTimeInput(date: Date): string {
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}

export function ObservationTypeDetailPage({
  detail,
  chartSeries,
  chartRange,
  chartMode,
  chartBusy,
  chartError,
  sleepSessions,
  sleepSessionsBusy,
  sleepSessionsError,
  loading,
  error,
  actionBusy,
  loadMoreBusy,
  onBack,
  onEditObservation,
  onDeleteObservation,
  onDeleteAll,
  onLoadMore,
  onChartRangeChange,
  onChartModeChange,
  onAddManualObservation,
  onSetPersonalReferenceRange,
  onRemovePersonalReferenceRange,
  onSetPinned,
  measurementType,
  defaultUnit
}: {
  detail?: HealthDataDetail;
  chartSeries?: HealthDataChartSeries;
  chartRange: HealthDataChartRange;
  chartMode: HealthDataChartMode;
  chartBusy: boolean;
  chartError?: string;
  sleepSessions?: SleepSessionPage;
  sleepSessionsBusy: boolean;
  sleepSessionsError?: string;
  loading: boolean;
  error?: string;
  actionBusy: boolean;
  loadMoreBusy: boolean;
  onBack: () => void;
  onEditObservation: (entry: HealthDataDetailEntry) => void;
  onDeleteObservation: (entry: HealthDataDetailEntry) => void | Promise<void>;
  onDeleteAll: () => void | Promise<void>;
  onLoadMore: () => void | Promise<void>;
  onChartRangeChange: (range: HealthDataChartRange) => void;
  onChartModeChange: (mode: HealthDataChartMode) => void;
  onAddManualObservation: (input: { observedAt: string; value: number; unit: string; note: string }) => void | Promise<void>;
  onSetPersonalReferenceRange: (input: PersonalReferenceRangeInput) => Promise<void>;
  onRemovePersonalReferenceRange: () => Promise<void>;
  onSetPinned: (isPinned: boolean) => void | Promise<void>;
  measurementType?: MeasurementType;
  defaultUnit: string;
}) {
  const dateOnlyObservation = usesDateOnlyObservation(measurementType?.aggregation);
  const [manualObservedAt, setManualObservedAt] = useState(() => {
    const now = new Date();
    return dateOnlyObservation ? localCalendarDate(now) : toLocalDateTimeInput(now);
  });
  const [manualValue, setManualValue] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [editingRange, setEditingRange] = useState(false);
  const [rangeLow, setRangeLow] = useState("");
  const [rangeHigh, setRangeHigh] = useState("");
  const [rangeUnit, setRangeUnit] = useState("");
  const [rangeError, setRangeError] = useState<string>();
  const [selectedSleepSessionId, setSelectedSleepSessionId] = useState<string>();
  const deleteAllCount = detail?.deletion.observationEntries ?? 0;
  const primaryTile = detail ? primaryCountTile(detail.counts) : { label: "Entries", value: 0 };
  const latestEntry = detail?.entries.reduce<HealthDataDetailEntry | undefined>((latest, entry) =>
    !latest || entry.timestamp > latest.timestamp ? entry : latest
  , undefined);
  const entryKinds = new Set(detail?.entries.map((entry) => entry.kind) ?? []);
  const showKind = entryKinds.size > 1;
  const rangeUnits = [...new Set([
    measurementType?.canonicalUnit,
    ...Object.values(measurementType?.preferredUnits ?? {}),
    detail?.referenceRange.effective?.unit,
    latestEntry?.unit
  ].filter((unit): unit is string => Boolean(unit)))];
  const activeSleepSessionId = sleepSessions?.sessions.some((session) => session.id === selectedSleepSessionId)
    ? selectedSleepSessionId
    : sleepSessions?.sessions[0]?.id;

  useEffect(() => {
    setManualObservedAt((current) => {
      if (dateOnlyObservation) return current.slice(0, 10);
      if (current.includes("T")) return current;
      return `${current}T${toLocalDateTimeInput(new Date()).slice(11)}`;
    });
  }, [dateOnlyObservation]);

  function beginRangeEdit() {
    const range = detail?.referenceRange.personal ?? detail?.referenceRange.effective;
    setRangeLow(range?.low === undefined ? "" : String(range.low));
    setRangeHigh(range?.high === undefined ? "" : String(range.high));
    setRangeUnit(range?.unit ?? rangeUnits[0] ?? defaultUnit);
    setRangeError(undefined);
    setEditingRange(true);
  }

  function changeRangeUnit(nextUnit: string) {
    if (!measurementType || !rangeUnit || nextUnit === rangeUnit) {
      setRangeUnit(nextUnit);
      return;
    }
    const low = rangeLow === "" ? undefined : Number(rangeLow);
    const high = rangeHigh === "" ? undefined : Number(rangeHigh);
    const convertedLow = low === undefined ? undefined : convertMeasurementValue(low, measurementType, rangeUnit, nextUnit);
    const convertedHigh = high === undefined ? undefined : convertMeasurementValue(high, measurementType, rangeUnit, nextUnit);
    if ((low !== undefined && convertedLow === undefined) || (high !== undefined && convertedHigh === undefined)) {
      setRangeError(`Values cannot be converted from ${rangeUnit} to ${nextUnit}.`);
      return;
    }
    setRangeLow(convertedLow === undefined ? "" : String(convertedLow));
    setRangeHigh(convertedHigh === undefined ? "" : String(convertedHigh));
    setRangeUnit(nextUnit);
    setRangeError(undefined);
  }

  async function submitRange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const low = rangeLow.trim() === "" ? undefined : Number(rangeLow);
    const high = rangeHigh.trim() === "" ? undefined : Number(rangeHigh);
    if (low === undefined && high === undefined) {
      setRangeError("Enter a lower bound, an upper bound, or both.");
      return;
    }
    if ((low !== undefined && !Number.isFinite(low)) || (high !== undefined && !Number.isFinite(high))) {
      setRangeError("Bounds must be finite numbers.");
      return;
    }
    if (low !== undefined && high !== undefined && low > high) {
      setRangeError("Upper bound must be greater than or equal to lower bound.");
      return;
    }
    try {
      await onSetPersonalReferenceRange({ low, high, unit: rangeUnit });
      setEditingRange(false);
      setRangeError(undefined);
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : "Unable to save the reference range.");
    }
  }

  async function removeRange() {
    try {
      await onRemovePersonalReferenceRange();
      setEditingRange(false);
      setRangeError(undefined);
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : "Unable to remove the reference range.");
    }
  }

  function submitManualObservation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number.parseFloat(manualValue);
    const observedAt = dateOnlyObservation
      ? calendarDateToUtcMidnight(manualObservedAt)
      : new Date(manualObservedAt).toISOString();
    if (!Number.isFinite(value) || !observedAt) return;
    void onAddManualObservation({
      observedAt,
      value,
      unit: manualUnit.trim() || defaultUnit,
      note: manualNote.trim()
    });
    setManualValue("");
    setManualNote("");
  }

  function selectSleepSession(sessionId: string) {
    setSelectedSleepSessionId(sessionId);
    document.getElementById("hypnogram-panel")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
  }

  return (
    <section className="panel summary-panel">
      <div className="summary-detail-header">
        <div>
          <button type="button" className="summary-back-link" onClick={onBack}>
            ← Back to summary
          </button>
          <h1>{detail?.measurement.displayName ?? "Measurement detail"}</h1>
          {detail?.measurement.description ? (
            <p className="summary-detail-description">{detail.measurement.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="summary-pin-button"
          aria-label={detail?.isPinned ? "Unpin measurement" : "Pin measurement"}
          aria-pressed={detail?.isPinned ?? false}
          title={detail?.isPinned ? "Unpin measurement" : "Pin measurement"}
          disabled={!detail || actionBusy}
          onClick={() => detail && void onSetPinned(!detail.isPinned)}
        >
          <Pin aria-hidden="true" fill={detail?.isPinned ? "currentColor" : "none"} size={20} />
        </button>
      </div>

      {/* Live status region */}
      <div aria-live="polite" aria-atomic="true">
        {loading ? <span className="sr-only" role="status">Loading detail…</span> : null}
        {error ? <p className="empty" role="alert">{error}</p> : null}
      </div>

      {loading && !detail ? (
        <div className="summary-detail-skeleton" aria-hidden="true">
          <div className="summary-detail-overview summary-detail-overview-skeleton">
            <span className="skeleton-line skeleton-value" />
            <span className="skeleton-line" />
            <span className="skeleton-line skeleton-short" />
          </div>
          <div className="skeleton-section">
            <span className="skeleton-line skeleton-heading" />
            <span className="skeleton-block" />
          </div>
          <div className="skeleton-section">
            <span className="skeleton-line skeleton-heading" />
            <span className="skeleton-block skeleton-table" />
          </div>
        </div>
      ) : null}

      {detail ? (
        <>
          <div className="summary-detail-overview" aria-label="Measurement overview">
            <div className="summary-detail-latest">
              <span>Latest reading</span>
              <strong>
                {latestEntry ? formatDetailValue(latestEntry.value) : "—"}
                {latestEntry?.unit ? <small>{latestEntry.unit}</small> : null}
              </strong>
            </div>
            <div className="summary-detail-overview-item">
              <span>Measured</span>
              <strong>{detail.measurement.lastMeasuredAt ? formatShortTimestamp(detail.measurement.lastMeasuredAt) : "—"}</strong>
            </div>
            <div className="summary-detail-overview-item">
              <span>{primaryTile.label}</span>
              <strong>{primaryTile.value}</strong>
            </div>
          </div>

          <section className="summary-reference-range" aria-labelledby="reference-range-heading">
            <div>
              <h2 id="reference-range-heading">Reference range</h2>
              {!editingRange ? (
                <>
                  <strong>{formatReferenceRange(detail.referenceRange.effective)}</strong>
                  <span>{referenceRangeSourceLabel(detail.referenceRange.source)}</span>
                </>
              ) : null}
            </div>
            {!editingRange ? (
              <button type="button" onClick={beginRangeEdit} disabled={actionBusy}>
                {detail.referenceRange.personal ? "Edit" : "Set range"}
              </button>
            ) : (
              <form className="summary-reference-range-editor" onSubmit={(event) => void submitRange(event)}>
                <label>
                  Lower bound
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={rangeLow}
                    onChange={(event) => setRangeLow(event.target.value)}
                    disabled={actionBusy}
                  />
                </label>
                <label>
                  Upper bound
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={rangeHigh}
                    onChange={(event) => setRangeHigh(event.target.value)}
                    disabled={actionBusy}
                  />
                </label>
                <label>
                  Unit
                  <select value={rangeUnit} onChange={(event) => changeRangeUnit(event.target.value)} disabled={actionBusy}>
                    {rangeUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
                <p className="summary-reference-range-copy">
                  This changes status labels and chart guides only. It does not provide medical advice.
                </p>
                {rangeError ? <p className="summary-reference-range-error" role="alert">{rangeError}</p> : null}
                <div className="summary-reference-range-actions">
                  <button type="submit" disabled={actionBusy}>{actionBusy ? "Saving…" : "Save"}</button>
                  <button type="button" onClick={() => setEditingRange(false)} disabled={actionBusy}>Cancel</button>
                  {detail.referenceRange.personal ? (
                    <button type="button" className="danger" onClick={() => void removeRange()} disabled={actionBusy}>
                      Remove personal range
                    </button>
                  ) : null}
                </div>
              </form>
            )}
          </section>

          {detail.counts.total === 0 ? (
            <p className="empty" role="status">No entries are currently stored for this measurement type.</p>
          ) : (
            <>
              {chartBusy || chartError || chartSeries?.points?.length ? (
                <div className="summary-detail-chart-panel">
                  <DetailTrendChart
                    detail={detail}
                    series={chartSeries}
                    range={chartRange}
                    mode={chartMode}
                    busy={chartBusy}
                    error={chartError}
                    onRangeChange={onChartRangeChange}
                    onModeChange={onChartModeChange}
                  />
                </div>
              ) : null}

              {detail.measurement.code === "sleep_duration" ? (
                <HypnogramPanel
                  page={sleepSessions}
                  busy={sleepSessionsBusy}
                  error={sleepSessionsError}
                  selectedSessionId={activeSleepSessionId}
                />
              ) : null}

              <div className="summary-detail-table">
                <div className="summary-detail-section-heading">
                  <div>
                    <h3>Entries</h3>
                    {detail.deletion.observationEntries === 0 && detail.counts.total > 0 ? (
                      <span className="summary-detail-hint">These records are read-only.</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="summary-delete-all"
                    onClick={() => void onDeleteAll()}
                    disabled={loading || actionBusy || deleteAllCount === 0}
                    aria-label={deleteAllCount > 0 ? `Delete ${deleteAllCount} observation record(s) for ${detail.measurement.displayName}` : "No observations to delete"}
                  >
                    {actionBusy ? "Deleting…" : `Delete observations${deleteAllCount > 0 ? ` (${deleteAllCount})` : ""}`}
                  </button>
                </div>
                <div className="query-table-scroll">
                  <table>
                    <caption className="sr-only">{detail.measurement.displayName} entries</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="summary-timestamp-column">Timestamp</th>
                        {showKind ? <th scope="col">Kind</th> : null}
                        <th scope="col" className="summary-value-column">Value</th>
                        <th scope="col">Source / note</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.entries.map((entry) => {
                        const selectableSleepSession = detail.measurement.code === "sleep_duration"
                          && entry.kind === "sample"
                          && sleepSessions?.sessions.some((session) => session.id === entry.id);
                        const selectedSleepSession = selectableSleepSession && entry.id === activeSleepSessionId;
                        return (
                        <tr
                          key={`${entry.kind}-${entry.id}`}
                          className={selectedSleepSession ? "is-selected-sleep-session" : undefined}
                          tabIndex={selectableSleepSession ? 0 : undefined}
                          aria-label={selectableSleepSession ? `Show sleep stages for ${formatEntryTimestamp(entry)}` : undefined}
                          onClick={selectableSleepSession ? () => selectSleepSession(entry.id) : undefined}
                          onKeyDown={selectableSleepSession ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              selectSleepSession(entry.id);
                            }
                          } : undefined}
                        >
                          <td data-label="Timestamp">{formatEntryTimestamp(entry)}</td>
                          {showKind ? <td data-label="Kind">{detailKindLabel(entry.kind)}</td> : null}
                          <td data-label="Value" className="summary-entry-value">
                            <strong>{formatDetailValue(entry.value)}</strong>
                            {entry.unit ? <span>{entry.unit}</span> : null}
                          </td>
                          <td data-label="Source / note" className="summary-entry-context">{renderEntryContext(entry)}</td>
                          <td data-label="Action" className="summary-entry-action">
                            {entry.canDelete ? (
                              <div className="summary-row-actions">
                                <button
                                  type="button"
                                  className="summary-row-edit"
                                  onClick={() => onEditObservation(entry)}
                                  disabled={actionBusy}
                                  aria-label={`Edit ${entry.displayName} observation from ${formatEntryTimestamp(entry)}`}
                                  title="Edit observation"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="m15.7 5.3 3 3L9 18H6v-3l9.7-9.7Zm1.4-1.4 1.2-1.2a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-1.2 1.2-3-3Z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="summary-row-delete"
                                  onClick={() => void onDeleteObservation(entry)}
                                  disabled={actionBusy}
                                  aria-label={`Delete ${entry.displayName} observation from ${formatEntryTimestamp(entry)}`}
                                  title="Delete observation"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" />
                                    <path d="M6 9h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" />
                                  </svg>
                                </button>
                              </div>
                            ) : (
                              <span className="summary-readonly">Read-only</span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="summary-detail-pagination">
                  <p>
                    Showing {Math.min(detail.pagination.loaded, detail.pagination.total)} of {detail.pagination.total} entries.
                  </p>
                  {detail.pagination.hasMore ? (
                    <button
                      type="button"
                      onClick={() => void onLoadMore()}
                      disabled={loading || actionBusy || loadMoreBusy}
                    >
                      {loadMoreBusy ? "Loading entries…" : "Load more entries"}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          )}

          <form className="summary-manual-observation" onSubmit={submitManualObservation}>
            <div>
              <h3>Add measurement</h3>
              <p>Record a new {detail.measurement.displayName.toLocaleLowerCase()} reading.</p>
            </div>
            <label>
              {dateOnlyObservation ? "Date" : "Date and time"}
              <input
                type={dateOnlyObservation ? "date" : "datetime-local"}
                aria-label={dateOnlyObservation ? "New measurement date" : "New measurement date and time"}
                value={manualObservedAt}
                onChange={(event) => setManualObservedAt(event.target.value)}
                required
              />
            </label>
            <label>
              Value
              <input
                inputMode="decimal"
                aria-label="New measurement value"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                required
              />
            </label>
            <label>
              Unit
              <input
                aria-label="New measurement unit"
                value={manualUnit || defaultUnit}
                onChange={(event) => setManualUnit(event.target.value)}
                required
              />
            </label>
            <label className="summary-manual-note">
              Note
              <input
                aria-label="New measurement note"
                value={manualNote}
                onChange={(event) => setManualNote(event.target.value)}
              />
            </label>
            <button type="submit" disabled={loading || actionBusy}>
              {actionBusy ? "Adding…" : "Add measurement"}
            </button>
          </form>
        </>
      ) : null}
    </section>
  );
}
