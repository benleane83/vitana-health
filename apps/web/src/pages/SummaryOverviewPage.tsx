import { useEffect, useMemo, useRef, useState } from "react";
import { filterAndSortSummary } from "@vitana/shared";
import type { HealthDataSummary } from "@vitana/shared";
import { formatTimestamp } from "../utils.js";
import { isProfileDataCategory, profileDataCategories, profileDataCategoryIconPaths, type ProfileDataCategory, type SummarySort } from "../types.js";

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
  onSelectRow,
  categoryFilter,
  onClearCategoryFilter,
  onAddCategory
}: {
  summary?: HealthDataSummary;
  loading: boolean;
  error?: string;
  sort: SummarySort;
  onSortChange: (sort: SummarySort) => void;
  expandedCategories: Set<string>;
  onToggleCategory: (key: string) => void;
  onSelectRow: (measurementCode: string) => void;
  categoryFilter?: ProfileDataCategory;
  onClearCategoryFilter: () => void;
  onAddCategory: (category: ProfileDataCategory, mode: "manual" | "upload") => void;
}) {
  const [openAddMenu, setOpenAddMenu] = useState<ProfileDataCategory>();
  const [search, setSearch] = useState("");
  const addMenuRef = useRef<HTMLDivElement>(null);
  const filterLabel = profileDataCategories.find((category) => category.key === categoryFilter)?.label;
  const sortedCategories = useMemo(
    () => summary ? filterAndSortSummary(summary, search, sort, categoryFilter).categories : [],
    [categoryFilter, search, sort, summary]
  );

  useEffect(() => {
    if (!openAddMenu) return;
    const closeOnPointerDown = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setOpenAddMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenAddMenu(undefined);
    };
    window.addEventListener("mousedown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openAddMenu]);

  return (
    <section className="panel summary-panel">
      <div className="summary-header">
        <div>
          <h2>Measurements</h2>
          {filterLabel ? (
            <div className="summary-category-filter" role="status">
              <span>Showing {filterLabel}</span>
              <button type="button" onClick={onClearCategoryFilter}>Clear filter</button>
            </div>
          ) : null}
        </div>
        <div className="summary-header-actions">
          <div className="summary-search">
            <label className="sr-only" htmlFor="summary-search">Search measurements</label>
            <input
              id="summary-search"
              type="search"
              value={search}
              maxLength={100}
              placeholder="Search measurements"
              onChange={(event) => setSearch(event.target.value)}
            />
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
            {sortedCategories.length === 0 ? (
              <p className="empty" role="status">
                {search.trim()
                  ? "No matching measurements."
                  : filterLabel
                    ? `No ${filterLabel.toLowerCase()} measurements have been imported yet.`
                    : "No measurements have been imported yet."}
              </p>
            ) : null}
            {sortedCategories.map((category) => {
              const expanded = expandedCategories.has(category.key);
              const panelId = `summary-panel-${category.key}`;
              const toggleId = `summary-toggle-${category.key}`;
              const categoryConfig = profileDataCategories.find((item) => item.key === category.key);
              const iconPath = isProfileDataCategory(category.key) ? profileDataCategoryIconPaths[category.key] : undefined;
              const canImport = categoryConfig?.manualGroup && categoryConfig.uploadKind;
              return (
                <section className="summary-category" key={category.key}>
                  <div className="summary-category-heading">
                    <button
                      id={toggleId}
                      className="summary-category-toggle"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => onToggleCategory(category.key)}
                    >
                      <span className="summary-category-title">
                        {iconPath ? <img src={iconPath} alt="" aria-hidden="true" /> : null}
                        <strong>{category.label}</strong>
                      </span>
                      <span className="summary-category-counts">{category.counts.types} types / {category.counts.total} entries</span>
                    </button>
                    {canImport && categoryConfig ? (
                      <div className="summary-category-add" ref={openAddMenu === categoryConfig.key ? addMenuRef : undefined}>
                        <button
                          type="button"
                          className="summary-category-add-trigger"
                          aria-label={`Add ${categoryConfig.label} data`}
                          aria-haspopup="menu"
                          aria-expanded={openAddMenu === categoryConfig.key}
                          onClick={() => setOpenAddMenu((current) => current === categoryConfig.key ? undefined : categoryConfig.key)}
                        >
                          <span aria-hidden="true">+</span>
                        </button>
                        {openAddMenu === categoryConfig.key ? (
                          <div className="summary-category-add-menu" role="menu" aria-label={`Add ${categoryConfig.label} data`}>
                            <button type="button" role="menuitem" onClick={() => { setOpenAddMenu(undefined); onAddCategory(categoryConfig.key, "manual"); }}>Manual</button>
                            <button type="button" role="menuitem" onClick={() => { setOpenAddMenu(undefined); onAddCategory(categoryConfig.key, "upload"); }}>Upload</button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
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