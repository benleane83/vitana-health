import { useState } from "react";
import { compareSummaryRows } from "@local-fitness-advisor/shared";
import type {
  HealthDataChartMode,
  HealthDataChartRange,
  HealthDataChartSeries,
  HealthDataDetail,
  HealthDataDetailEntry,
  HealthDataSummary
} from "@local-fitness-advisor/shared";
import { DetailTrendChart } from "../components/Charts.js";
import { formatTimestamp, formatShortTimestamp, formatDetailValue } from "../utils.js";
import type { SummarySort } from "../types.js";

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" className="stat" onClick={onClick}>
        <strong aria-label={`${label}: ${value}`}>{value}</strong>
        <span>{label}</span>
      </button>
    );
  }
  return (
    <div className="stat">
      <strong aria-label={`${label}: ${value}`}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function detailKindLabel(kind: HealthDataDetailEntry["kind"]): string {
  return { observation: "Observation", sample: "Sample", activity: "Activity" }[kind];
}

function normalizeContextToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
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
  return appLabel ? `Health Connect (${appLabel})` : "Health Connect";
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

  if (importFileName) {
    const normalizedImport = normalizeContextToken(importFileName);
    const normalizedSource = sourceLabel ? normalizeContextToken(sourceLabel) : "";
    const duplicatesSource =
      !!sourceLabel && (normalizedImport.includes(normalizedSource) || normalizedSource.includes(normalizedImport));
    if (!duplicatesSource) {
      parts.push(importFileName);
    }
  }

  if (note) {
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

export function SummaryPage({
  summary,
  loading,
  error,
  sort,
  onSortChange,
  expandedCategories,
  onToggleCategory,
  onSelectRow
}: {
  summary?: HealthDataSummary;
  loading: boolean;
  error?: string;
  sort: SummarySort;
  onSortChange: (sort: SummarySort) => void;
  expandedCategories: Set<string>;
  onToggleCategory: (key: string) => void;
  onSelectRow: (measurementCode: string) => void;
}) {
  return (
    <section className="panel summary-panel">
      <div className="summary-header">
        <div>
          <p className="eyebrow">Loaded health data by type</p>
          <h2>Track health data</h2>
        </div>
        <div className="summary-controls" role="group" aria-label="Sort summary rows">
          <button
            className={sort === "recency" ? "active" : ""}
            aria-pressed={sort === "recency"}
            onClick={() => onSortChange("recency")}
          >Most recent</button>
          <button
            className={sort === "count" ? "active" : ""}
            aria-pressed={sort === "count"}
            onClick={() => onSortChange("count")}
          >Entry count</button>
          <button
            className={sort === "name" ? "active" : ""}
            aria-pressed={sort === "name"}
            onClick={() => onSortChange("name")}
          >Name</button>
        </div>
      </div>

      {/* Live region for loading/error */}
      <div aria-live="polite" aria-atomic="true">
        {loading ? <p className="empty" role="status">Loading summary…</p> : null}
        {error ? <p className="empty" role="alert">{error}</p> : null}
      </div>

      {summary ? (
        <>
          <div className="summary-totals">
            <Stat label="Types" value={summary.totals.types} />
            <Stat label="Entries" value={summary.totals.total} />
            <Stat label="Observations" value={summary.totals.observations} />
            <Stat label="Samples" value={summary.totals.samples} />
            <Stat label="Activities" value={summary.totals.activities} onClick={() => onSelectRow("activity_sessions")} />
          </div>

          <div className="summary-generated" aria-label={`Summary generated ${formatTimestamp(summary.generatedAt)}`}>
            Generated {formatTimestamp(summary.generatedAt)}
          </div>

          <div className="summary-categories">
            {summary.categories.length === 0 ? (
              <p className="empty" role="status">No measurements have been imported yet.</p>
            ) : null}
            {summary.categories.map((category) => {
              const expanded = expandedCategories.has(category.key);
              const panelId = `summary-panel-${category.key}`;
              const toggleId = `summary-toggle-${category.key}`;
              const sortedRows = [...category.rows].sort((a, b) => compareSummaryRows(a, b, sort));
              return (
                <section className="summary-category" key={category.key}>
                  <button
                    id={toggleId}
                    className="summary-category-toggle"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => onToggleCategory(category.key)}
                  >
                    <strong>{category.label}</strong>
                    <span>{category.counts.types} types / {category.counts.total} entries</span>
                  </button>
                  {expanded ? (
                    <div
                      id={panelId}
                      className="summary-table"
                      role="table"
                      aria-label={`${category.label} summary`}
                      aria-labelledby={toggleId}
                    >
                      <div className="summary-row summary-row-head" role="row">
                        <span role="columnheader">Data type</span>
                        <span role="columnheader">Entries</span>
                        <span role="columnheader">Last measurement</span>
                      </div>
                      {sortedRows.map((row) => (
                        <div className="summary-row summary-row-button" role="row" key={row.code}>
                          <button
                            type="button"
                            className="summary-row-cell-button"
                            role="cell"
                            onClick={() => onSelectRow(row.code)}
                            aria-label={`View details for ${row.displayName}, ${row.counts.total} entries`}
                          >
                            <span>{row.displayName}</span>
                            <span>{row.counts.total}</span>
                            <span>{row.lastMeasuredAt ? formatTimestamp(row.lastMeasuredAt) : "—"}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function ObservationTypeDetailPage({
  detail,
  chartSeries,
  chartRange,
  chartMode,
  chartBusy,
  chartError,
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
  defaultUnit
}: {
  detail?: HealthDataDetail;
  chartSeries?: HealthDataChartSeries;
  chartRange: HealthDataChartRange;
  chartMode: HealthDataChartMode;
  chartBusy: boolean;
  chartError?: string;
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
  defaultUnit: string;
}) {
  const [manualObservedAt, setManualObservedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualValue, setManualValue] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [manualNote, setManualNote] = useState("");
  const deleteAllCount = detail?.deletion.observationEntries ?? 0;
  const primaryTile = detail ? primaryCountTile(detail.counts) : { label: "Entries", value: 0 };
  const latestEntry = detail?.entries.reduce<HealthDataDetailEntry | undefined>((latest, entry) =>
    !latest || entry.timestamp > latest.timestamp ? entry : latest
  , undefined);
  const entryKinds = new Set(detail?.entries.map((entry) => entry.kind) ?? []);
  const showKind = entryKinds.size > 1;

  function submitManualObservation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number.parseFloat(manualValue);
    if (!Number.isFinite(value)) return;
    void onAddManualObservation({
      observedAt: manualObservedAt,
      value,
      unit: manualUnit.trim() || defaultUnit,
      note: manualNote.trim()
    });
    setManualValue("");
    setManualNote("");
  }

  return (
    <section className="panel summary-panel">
      <div className="summary-detail-header">
        <div>
          <button type="button" className="summary-back-link" onClick={onBack}>
            ← Back to summary
          </button>
          <p className="eyebrow">Loaded health data by type</p>
          <h2>{detail?.measurement.displayName ?? "Measurement detail"}</h2>
          <p className="summary-detail-code">{detail?.measurement.code ?? "Loading…"}</p>
        </div>
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

          {detail.counts.total === 0 ? (
            <p className="empty" role="status">No entries are currently stored for this measurement type.</p>
          ) : (
            <>
              {chartBusy || chartError || chartSeries?.points.length ? (
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
                      {detail.entries.map((entry) => (
                        <tr key={`${entry.kind}-${entry.id}`}>
                          <td data-label="Timestamp">{formatTimestamp(entry.timestamp)}</td>
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
                                  aria-label={`Edit ${entry.displayName} observation from ${formatTimestamp(entry.timestamp)}`}
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
                                  aria-label={`Delete ${entry.displayName} observation from ${formatTimestamp(entry.timestamp)}`}
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
                      ))}
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
              Date
              <input
                type="date"
                aria-label="New measurement date"
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
