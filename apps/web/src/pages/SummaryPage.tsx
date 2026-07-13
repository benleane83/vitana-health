import type { HealthDataDetail, HealthDataDetailEntry, HealthDataSummary, HealthDataSummaryTypeRow } from "@local-fitness-advisor/shared";
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

function compareSummaryRows(a: HealthDataSummaryTypeRow, b: HealthDataSummaryTypeRow, sort: SummarySort): number {
  if (sort === "name") return a.displayName.localeCompare(b.displayName);
  if (sort === "count") return b.counts.total - a.counts.total || a.displayName.localeCompare(b.displayName);
  if (!a.lastMeasuredAt && !b.lastMeasuredAt) return a.displayName.localeCompare(b.displayName);
  if (!a.lastMeasuredAt) return 1;
  if (!b.lastMeasuredAt) return -1;
  return b.lastMeasuredAt.localeCompare(a.lastMeasuredAt) || a.displayName.localeCompare(b.displayName);
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
  loading,
  error,
  actionBusy,
  loadMoreBusy,
  onBack,
  onDeleteObservation,
  onDeleteAll,
  onLoadMore
}: {
  detail?: HealthDataDetail;
  loading: boolean;
  error?: string;
  actionBusy: boolean;
  loadMoreBusy: boolean;
  onBack: () => void;
  onDeleteObservation: (entry: HealthDataDetailEntry) => void | Promise<void>;
  onDeleteAll: () => void | Promise<void>;
  onLoadMore: () => void | Promise<void>;
}) {
  const deleteAllCount = detail?.deletion.observationEntries ?? 0;
  const primaryTile = detail ? primaryCountTile(detail.counts) : { label: "Entries", value: 0 };

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
        <div className="summary-detail-actions">
          <button
            type="button"
            onClick={() => void onDeleteAll()}
            disabled={loading || actionBusy || deleteAllCount === 0}
            aria-label={deleteAllCount > 0 ? `Delete ${deleteAllCount} observation record(s) for ${detail?.measurement.displayName ?? "this measurement"}` : "No observations to delete"}
          >
            {actionBusy ? "Deleting…" : `Delete observations${deleteAllCount > 0 ? ` (${deleteAllCount})` : ""}`}
          </button>
          {detail && detail.deletion.observationEntries === 0 && detail.counts.total > 0 ? (
            <span className="summary-detail-hint">Only observation rows can be deleted from this screen.</span>
          ) : null}
        </div>
      </div>

      {/* Live status region */}
      <div aria-live="polite" aria-atomic="true">
        {loading ? <p className="empty" role="status">Loading detail…</p> : null}
        {error ? <p className="empty" role="alert">{error}</p> : null}
      </div>

      {detail ? (
        <>
          <div className="summary-totals summary-detail-stats">
            <Stat label={primaryTile.label} value={primaryTile.value} />
            <div className="stat" aria-label={`Latest: ${detail.measurement.lastMeasuredAt ? formatShortTimestamp(detail.measurement.lastMeasuredAt) : "—"}`}>
              <strong>
                {detail.measurement.lastMeasuredAt
                  ? formatShortTimestamp(detail.measurement.lastMeasuredAt)
                  : "—"}
              </strong>
              <span>Latest</span>
            </div>
          </div>

          {detail.counts.total === 0 ? (
            <p className="empty" role="status">No entries are currently stored for this measurement type.</p>
          ) : (
            <>
              {detail.chartPoints.length > 0 ? (
                <div className="summary-detail-chart-panel">
                  <h3>Trend</h3>
                  <DetailTrendChart detail={detail} />
                </div>
              ) : null}

              <div className="summary-detail-table">
                <h3>Entries</h3>
                <div className="query-table-scroll">
                  <table>
                    <caption className="sr-only">{detail.measurement.displayName} entries</caption>
                    <thead>
                      <tr>
                        <th scope="col">Timestamp</th>
                        <th scope="col">Kind</th>
                        <th scope="col">Value</th>
                        <th scope="col">Unit</th>
                        <th scope="col">Source / note</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.entries.map((entry) => (
                        <tr key={`${entry.kind}-${entry.id}`}>
                          <td>{formatTimestamp(entry.timestamp)}</td>
                          <td>{detailKindLabel(entry.kind)}</td>
                          <td>{formatDetailValue(entry.value)}</td>
                          <td>{entry.unit}</td>
                          <td>{renderEntryContext(entry)}</td>
                          <td>
                            {entry.canDelete ? (
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
        </>
      ) : null}
    </section>
  );
}
