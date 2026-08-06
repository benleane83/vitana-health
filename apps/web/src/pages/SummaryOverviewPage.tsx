import { useMemo } from "react";
import { compareSummaryRows } from "@vitana/shared";
import type { HealthDataSummary } from "@vitana/shared";
import { formatTimestamp } from "../utils.js";
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
  const sortedCategories = useMemo(
    () => (summary?.categories ?? []).map((category) => ({
      ...category,
      rows: [...category.rows].sort((a, b) => compareSummaryRows(a, b, sort))
    })),
    [summary, sort]
  );

  return (
    <section className="panel summary-panel">
      <div className="summary-header">
        <div>
          <h2>Measurements</h2>
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
            {sortedCategories.map((category) => {
              const expanded = expandedCategories.has(category.key);
              const panelId = `summary-panel-${category.key}`;
              const toggleId = `summary-toggle-${category.key}`;
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
                      {category.rows.map((row) => (
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