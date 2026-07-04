import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyticsSummary,
  HealthDataSummary,
  HealthDataSummaryTypeRow,
  HealthStoreData,
  Insight,
  ManualLabEntryPayload,
  MeasurementType,
  Profile
} from "@local-fitness-advisor/shared";
import { safetyNotice } from "@local-fitness-advisor/shared";
import { api } from "./api.js";
import { LAB_MARKER_CATALOG } from "./labMarkerCatalog.js";

const sampleSamsungCsv = `date,type,value,unit
2026-06-25,steps,8421,count
2026-06-26,steps,9630,count
2026-06-27,steps,7102,count
2026-06-28,heart_rate,64,bpm
2026-06-29,heart_rate,61,bpm
2026-06-30,weight,82.4,kg`;

type AppRoute = "dashboard" | "summary" | "labs";
type SummarySort = "name" | "count" | "recency";
type LabsMode = "manual" | "upload";

interface ManualMarkerRow {
  id: string;
  marker: string;
  value: string;
  unit: string;
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

export function App() {
  const [store, setStore] = useState<HealthStoreData>();
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [samsungFileName, setSamsungFileName] = useState("samsung-health-sample.csv");
  const [samsungCsv, setSamsungCsv] = useState(sampleSamsungCsv);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [route, setRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [summary, setSummary] = useState<HealthDataSummary>();
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string>();
  const [summarySort, setSummarySort] = useState<SummarySort>("recency");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [labsMode, setLabsMode] = useState<LabsMode>("manual");
  const [manualCollectedAt, setManualCollectedAt] = useState(todayIsoDate());
  const [manualPanelName, setManualPanelName] = useState("Lipid panel");
  const [manualLabName, setManualLabName] = useState("");
  const [manualRows, setManualRows] = useState<ManualMarkerRow[]>(() => createStarterRows());
  const [uploadFile, setUploadFile] = useState<File>();

  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(routeFromPathname(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (route !== "summary") {
      return;
    }
    let cancelled = false;
    setSummaryBusy(true);
    setSummaryError(undefined);
    void api
      .summary()
      .then((nextSummary) => {
        if (cancelled) {
          return;
        }
        setSummary(nextSummary);
        setExpandedCategories(new Set(nextSummary.categories.map((category) => category.key)));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setSummaryError(error instanceof Error ? error.message : "Unable to load summary.");
      })
      .finally(() => {
        if (!cancelled) {
          setSummaryBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route]);

  const profile = store?.profile;
  const latestInsight = store?.insights[0];
  const density = useMemo(() => {
    const counts = analytics?.counts;
    if (!counts) return 0;
    return Math.min(100, counts.observations + counts.samples / 10 + counts.labMarkers * 8);
  }, [analytics]);

  const labMeasurementTypes = useMemo(
    () =>
      (store?.measurementTypes ?? []).filter(
        (type) => type.kind === "panel-component" || type.category === "lab" || type.category === "metabolic"
      ),
    [store?.measurementTypes]
  );

  async function refresh() {
    const [nextStore, nextAnalytics] = await Promise.all([api.store(), api.analytics()]);
    setStore(nextStore);
    setAnalytics(nextAnalytics);
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run("Profile saved locally.", async () => {
      await api.saveProfile({
        displayName: String(form.get("displayName") || "Local user"),
        birthYear: numberOrUndefined(form.get("birthYear")),
        sex: String(form.get("sex") || "not-specified") as Profile["sex"],
        heightCm: numberOrUndefined(form.get("heightCm")),
        goalSummary: String(form.get("goalSummary") || ""),
        units: String(form.get("units") || "metric") as Profile["units"]
      });
      await refresh();
    });
  }

  async function importSamsungCsv() {
    await run("Samsung Health import processed into the encrypted local store.", async () => {
      await api.importSamsung(samsungFileName, samsungCsv);
      await refresh();
    });
  }

  async function submitManualLabs(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = toManualPayload({
      collectedAt: manualCollectedAt,
      panelName: manualPanelName,
      labName: manualLabName,
      rows: manualRows,
      knownMeasurements: labMeasurementTypes
    });

    await run("Manual lab panel imported.", async () => {
      await api.importManualLabEntry(payload);
      await refresh();
      resetManualForm();
    });
  }

  async function submitCsvUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) {
      setMessage("Select a CSV file before upload.");
      return;
    }

    await run("Blood test CSV imported.", async () => {
      const content = await uploadFile.text();
      await api.importBloodTest(uploadFile.name, content);
      await refresh();
      setUploadFile(undefined);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    });
  }

  async function generateInsight() {
    await run("Insight generated from local data.", async () => {
      await api.generateInsight();
      await refresh();
    });
  }

  async function run(success: string, task: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await task();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  function resetManualForm() {
    setManualCollectedAt(todayIsoDate());
    setManualPanelName("Lipid panel");
    setManualLabName("");
    setManualRows(createStarterRows());
  }

  function navigate(nextRoute: AppRoute) {
    const nextPath = nextRoute === "summary" ? "/summary" : nextRoute === "labs" ? "/labs" : "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setRoute(nextRoute);
  }

  function toggleCategory(key: string) {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function addManualRow() {
    setManualRows((current) => [...current, createEmptyRow()]);
  }

  function removeManualRow(id: string) {
    setManualRows((current) => (current.length <= 1 ? current : current.filter((row) => row.id !== id)));
  }

  function updateManualRow(id: string, patch: Partial<ManualMarkerRow>) {
    setManualRows((current) =>
      current.map((row) => {
        if (row.id !== id) {
          return row;
        }
        const next = { ...row, ...patch };
        if (patch.marker !== undefined && patch.unit === undefined && !next.unit.trim()) {
          const matchedUnit = findKnownCatalogMarker(patch.marker)?.unit ?? findKnownMeasurement(patch.marker, labMeasurementTypes)?.canonicalUnit;
          if (matchedUnit) {
            next.unit = matchedUnit;
          }
        }
        return next;
      })
    );
  }

  return (
    <main className="shell">
      <nav className="route-nav" aria-label="Page navigation">
        <button className={route === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")}>
          Dashboard
        </button>
        <button className={route === "labs" ? "active" : ""} onClick={() => navigate("labs")}>
          Labs
        </button>
        <button className={route === "summary" ? "active" : ""} onClick={() => navigate("summary")}>
          Health Data Summary
        </button>
      </nav>

      {message ? <div className="notice">{message}</div> : null}

      {route === "dashboard" ? (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">Private health intelligence / localhost only</p>
              <h1>Your body data, held close.</h1>
              <p className="hero-copy">
                A local analytics cockpit for Samsung Health exports, lab markers, profile context, and guarded AI summaries.
              </p>
            </div>
            <div className="privacy-card">
              <span className="pulse" />
              <strong>Encrypted local vault</strong>
              <p>{store?.sourceImports.length ?? 0} imports. Raw files stay off cloud services.</p>
              <div className="density"><span style={{ width: `${density}%` }} /></div>
            </div>
          </section>

          <section className="grid">
            <article className="panel profile-panel">
              <h2>Profile context</h2>
              <form onSubmit={saveProfile} className="profile-form">
                <label>
                  Name
                  <input name="displayName" defaultValue={profile?.displayName ?? "Local user"} />
                </label>
                <label>
                  Birth year
                  <input name="birthYear" type="number" defaultValue={profile?.birthYear ?? ""} />
                </label>
                <label>
                  Sex
                  <select name="sex" defaultValue={profile?.sex ?? "not-specified"}>
                    <option value="not-specified">Prefer not to say</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="intersex">Intersex</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label>
                  Height cm
                  <input name="heightCm" type="number" step="0.1" defaultValue={profile?.heightCm ?? ""} />
                </label>
                <label>
                  Units
                  <select name="units" defaultValue={profile?.units ?? "metric"}>
                    <option value="metric">Metric</option>
                    <option value="imperial">Imperial</option>
                  </select>
                </label>
                <label className="wide">
                  Goals
                  <textarea name="goalSummary" defaultValue={profile?.goalSummary ?? "Improve energy, sleep, and metabolic health."} />
                </label>
                <button disabled={busy}>Save profile</button>
              </form>
            </article>

            <article className="panel import-panel">
              <h2>Import console</h2>
              <p className="empty">Samsung Health CSV import stays on the dashboard. Use Labs for Blood test entry and upload.</p>
              <input value={samsungFileName} onChange={(event) => setSamsungFileName(event.target.value)} />
              <textarea className="csv-box" value={samsungCsv} onChange={(event) => setSamsungCsv(event.target.value)} />
              <button disabled={busy} onClick={importSamsungCsv}>Process into vault</button>
            </article>

            <article className="panel metrics-panel">
              <h2>Local analytics</h2>
              <div className="stat-row">
                <Stat label="Imports" value={analytics?.counts.imports ?? 0} />
                <Stat label="Observations" value={analytics?.counts.observations ?? 0} />
                <Stat label="Samples" value={analytics?.counts.samples ?? 0} />
                <Stat label="Labs" value={analytics?.counts.labMarkers ?? 0} />
              </div>
              <div className="metric-list">
                {analytics?.latestMetrics.length ? analytics.latestMetrics.map((metric) => (
                  <div className="metric" key={metric.code}>
                    <span>{metric.label}</span>
                    <strong>{metric.value} {metric.unit}</strong>
                    <em data-status={metric.status}>{metric.status}</em>
                  </div>
                )) : <p className="empty">Import data to populate latest metrics.</p>}
              </div>
            </article>

            <article className="panel trends-panel">
              <h2>Trend traces</h2>
              {analytics?.trendCards.length ? analytics.trendCards.map((card) => (
                <div className="trend" key={card.code}>
                  <div>
                    <strong>{card.label}</strong>
                    <span>{card.summary}</span>
                  </div>
                  <MiniChart points={card.points} />
                </div>
              )) : <p className="empty">Two or more dated readings are needed for trend traces.</p>}
            </article>

            <article className="panel insight-panel">
              <h2>Guarded AI review</h2>
              <p className="safety">{safetyNotice}</p>
              <button disabled={busy} onClick={generateInsight}>Generate local insight</button>
              <InsightCard insight={latestInsight} />
            </article>

            <article className="panel alerts-panel">
              <h2>Lab range review</h2>
              {analytics?.labAlerts.length ? analytics.labAlerts.map((alert) => (
                <div className="alert" key={`${alert.marker}-${alert.value}`}>
                  <span>{alert.marker}</span>
                  <strong>{alert.value} {alert.unit}</strong>
                  <em>{alert.flag}{alert.reference ? ` / ref ${alert.reference}` : ""}</em>
                </div>
              )) : <p className="empty">No out-of-range lab markers yet.</p>}
            </article>
          </section>
        </>
      ) : route === "summary" ? (
        <SummaryPage
          summary={summary}
          loading={summaryBusy}
          error={summaryError}
          sort={summarySort}
          onSortChange={setSummarySort}
          expandedCategories={expandedCategories}
          onToggleCategory={toggleCategory}
        />
      ) : (
        <LabsPage
          busy={busy}
          mode={labsMode}
          onModeChange={setLabsMode}
          panelName={manualPanelName}
          labName={manualLabName}
          collectedAt={manualCollectedAt}
          rows={manualRows}
          onPanelNameChange={setManualPanelName}
          onLabNameChange={setManualLabName}
          onCollectedAtChange={setManualCollectedAt}
          onRowChange={updateManualRow}
          onAddRow={addManualRow}
          onRemoveRow={removeManualRow}
          onSubmitManual={submitManualLabs}
          onSubmitUpload={submitCsvUpload}
          onUploadFileChange={setUploadFile}
          uploadInputRef={uploadInputRef}
        />
      )}
    </main>
  );
}

function LabsPage({
  busy,
  mode,
  onModeChange,
  panelName,
  labName,
  collectedAt,
  rows,
  onPanelNameChange,
  onLabNameChange,
  onCollectedAtChange,
  onRowChange,
  onAddRow,
  onRemoveRow,
  onSubmitManual,
  onSubmitUpload,
  onUploadFileChange,
  uploadInputRef
}: {
  busy: boolean;
  mode: LabsMode;
  onModeChange: (mode: LabsMode) => void;
  panelName: string;
  labName: string;
  collectedAt: string;
  rows: ManualMarkerRow[];
  onPanelNameChange: (value: string) => void;
  onLabNameChange: (value: string) => void;
  onCollectedAtChange: (value: string) => void;
  onRowChange: (id: string, patch: Partial<ManualMarkerRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onSubmitManual: (event: React.FormEvent<HTMLFormElement>) => void;
  onSubmitUpload: (event: React.FormEvent<HTMLFormElement>) => void;
  onUploadFileChange: (file?: File) => void;
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="panel labs-panel">
      <div className="labs-header">
        <div>
          <p className="eyebrow">Lab intake workflow</p>
          <h2>Labs</h2>
        </div>
        <div className="segmented" role="tablist" aria-label="Labs mode">
          <button className={mode === "manual" ? "active" : ""} onClick={() => onModeChange("manual")}>
            Manual entry
          </button>
          <button className={mode === "upload" ? "active" : ""} onClick={() => onModeChange("upload")}>
            Upload CSV
          </button>
        </div>
      </div>

      {mode === "manual" ? (
        <form className="labs-manual-form" onSubmit={onSubmitManual}>
          <div className="labs-manual-meta">
            <label>
              Collection date
              <input type="date" value={collectedAt} onChange={(event) => onCollectedAtChange(event.target.value)} />
            </label>
            <label>
              Panel name
              <input value={panelName} onChange={(event) => onPanelNameChange(event.target.value)} placeholder="Lipid panel" />
            </label>
            <label>
              Lab name (optional)
              <input value={labName} onChange={(event) => onLabNameChange(event.target.value)} placeholder="Quest Diagnostics" />
            </label>
          </div>

          <div className="labs-rows" role="table" aria-label="Manual lab markers">
            <div className="summary-row summary-row-head" role="row">
              <span role="columnheader">Marker</span>
              <span role="columnheader">Value</span>
              <span role="columnheader">Unit</span>
              <span role="columnheader">Actions</span>
            </div>
            {rows.map((row) => (
              <div className="summary-row labs-row" role="row" key={row.id}>
                <span role="cell" className="labs-marker-cell">
                  <select
                    value={selectedMarkerOption(row.marker)}
                    onChange={(event) => {
                      const selectedMarker = event.target.value;
                      const knownMarker = findKnownCatalogMarker(selectedMarker);
                      onRowChange(row.id, {
                        marker: selectedMarker,
                        unit: knownMarker?.unit ?? row.unit
                      });
                    }}
                  >
                    <option value="">Custom marker</option>
                    {LAB_MARKER_CATALOG.map((entry) => (
                      <option value={entry.marker} key={entry.marker}>
                        {entry.marker}
                      </option>
                    ))}
                  </select>
                  <input
                    value={row.marker}
                    onChange={(event) => onRowChange(row.id, { marker: event.target.value })}
                    placeholder="HDL cholesterol"
                  />
                </span>
                <span role="cell">
                  <input
                    inputMode="decimal"
                    value={row.value}
                    onChange={(event) => onRowChange(row.id, { value: event.target.value })}
                    placeholder="48"
                  />
                </span>
                <span role="cell">
                  <input value={row.unit} onChange={(event) => onRowChange(row.id, { unit: event.target.value })} placeholder="mg/dL" />
                </span>
                <span role="cell" className="labs-row-actions">
                  <button type="button" onClick={() => onRemoveRow(row.id)}>Remove</button>
                </span>
              </div>
            ))}
          </div>

          <div className="labs-actions">
            <button type="button" onClick={onAddRow}>Add row</button>
            <button disabled={busy} type="submit">Import manual panel</button>
          </div>
        </form>
      ) : (
        <form className="labs-upload-form" onSubmit={onSubmitUpload}>
          <label>
            Select blood-test CSV
            <input
              ref={uploadInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => onUploadFileChange(event.target.files?.[0])}
            />
          </label>
          <button disabled={busy} type="submit">Upload CSV</button>
        </form>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SummaryPage({
  summary,
  loading,
  error,
  sort,
  onSortChange,
  expandedCategories,
  onToggleCategory
}: {
  summary?: HealthDataSummary;
  loading: boolean;
  error?: string;
  sort: SummarySort;
  onSortChange: (sort: SummarySort) => void;
  expandedCategories: Set<string>;
  onToggleCategory: (key: string) => void;
}) {
  return (
    <section className="panel summary-panel">
      <div className="summary-header">
        <div>
          <p className="eyebrow">Loaded health data by type</p>
          <h2>Health Data Summary</h2>
        </div>
        <div className="summary-controls" role="group" aria-label="Sort summary rows">
          <button className={sort === "recency" ? "active" : ""} onClick={() => onSortChange("recency")}>Most recent</button>
          <button className={sort === "count" ? "active" : ""} onClick={() => onSortChange("count")}>Entry count</button>
          <button className={sort === "name" ? "active" : ""} onClick={() => onSortChange("name")}>Name</button>
        </div>
      </div>

      {loading ? <p className="empty">Loading summary...</p> : null}
      {error ? <p className="empty">{error}</p> : null}

      {summary ? (
        <>
          <div className="summary-totals">
            <Stat label="Types" value={summary.totals.types} />
            <Stat label="Entries" value={summary.totals.total} />
            <Stat label="Observations" value={summary.totals.observations} />
            <Stat label="Samples" value={summary.totals.samples} />
            <Stat label="Labs" value={summary.totals.labMarkers} />
          </div>

          <div className="summary-generated">Generated {formatTimestamp(summary.generatedAt)}</div>

          <div className="summary-categories">
            {summary.categories.length === 0 ? <p className="empty">No measurements have been imported yet.</p> : null}
            {summary.categories.map((category) => {
              const expanded = expandedCategories.has(category.key);
              const sortedRows = [...category.rows].sort((a, b) => compareSummaryRows(a, b, sort));
              return (
                <section className="summary-category" key={category.key}>
                  <button className="summary-category-toggle" onClick={() => onToggleCategory(category.key)}>
                    <strong>{category.label}</strong>
                    <span>{category.counts.types} types / {category.counts.total} entries</span>
                  </button>
                  {expanded ? (
                    <div className="summary-table" role="table" aria-label={`${category.label} summary`}>
                      <div className="summary-row summary-row-head" role="row">
                        <span role="columnheader">Data type</span>
                        <span role="columnheader">Entries</span>
                        <span role="columnheader">Last measurement</span>
                      </div>
                      {sortedRows.map((row) => (
                        <div className="summary-row" role="row" key={row.code}>
                          <span role="cell">{row.displayName}</span>
                          <span role="cell">{row.counts.total}</span>
                          <span role="cell">{row.lastMeasuredAt ? formatTimestamp(row.lastMeasuredAt) : "—"}</span>
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

function compareSummaryRows(a: HealthDataSummaryTypeRow, b: HealthDataSummaryTypeRow, sort: SummarySort): number {
  if (sort === "name") {
    return a.displayName.localeCompare(b.displayName);
  }
  if (sort === "count") {
    return b.counts.total - a.counts.total || a.displayName.localeCompare(b.displayName);
  }
  if (!a.lastMeasuredAt && !b.lastMeasuredAt) {
    return a.displayName.localeCompare(b.displayName);
  }
  if (!a.lastMeasuredAt) {
    return 1;
  }
  if (!b.lastMeasuredAt) {
    return -1;
  }
  return b.lastMeasuredAt.localeCompare(a.lastMeasuredAt) || a.displayName.localeCompare(b.displayName);
}

function routeFromPathname(pathname: string): AppRoute {
  if (pathname === "/summary") {
    return "summary";
  }
  if (pathname === "/labs") {
    return "labs";
  }
  return "dashboard";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return timestampFormatter.format(date);
}

function MiniChart({ points }: { points: Array<{ date: string; value: number }> }) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 100 - ((point.value - min) / range) * 80 - 10;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="Trend sparkline">
      <path d={path} />
    </svg>
  );
}

function InsightCard({ insight }: { insight?: Insight }) {
  if (!insight) {
    return <p className="empty">Generate an insight after importing data.</p>;
  }
  return (
    <div className="insight">
      <span>{insight.model} / confidence {insight.confidence}</span>
      <h3>{insight.title}</h3>
      <p>{insight.body}</p>
    </div>
  );
}

function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toManualPayload({
  collectedAt,
  panelName,
  labName,
  rows,
  knownMeasurements
}: {
  collectedAt: string;
  panelName: string;
  labName: string;
  rows: ManualMarkerRow[];
  knownMeasurements: MeasurementType[];
}): ManualLabEntryPayload {
  if (!collectedAt) {
    throw new Error("Collection date is required.");
  }
  if (!panelName.trim()) {
    throw new Error("Panel name is required.");
  }

  const markers = rows
    .map((row) => {
      const markerName = row.marker.trim();
      const hasRowData = markerName || row.value.trim() || row.unit.trim();
      if (!hasRowData) {
        return undefined;
      }
      const value = Number.parseFloat(row.value);
      if (!Number.isFinite(value)) {
        throw new Error(`Enter a numeric value for ${markerName || "all rows"}.`);
      }
      const known = findKnownMeasurement(markerName, knownMeasurements);
      return {
        markerName: markerName || known?.display,
        markerCode: known?.code,
        value,
        unit: row.unit.trim() || known?.canonicalUnit
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (markers.length === 0) {
    throw new Error("Enter at least one marker row before import.");
  }

  return {
    collectedAt,
    panelName: panelName.trim(),
    labName: labName.trim() || undefined,
    markers
  };
}

function findKnownMeasurement(input: string, knownMeasurements: MeasurementType[]): MeasurementType | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return knownMeasurements.find((measurement) => {
    if (measurement.code.toLowerCase() === normalized || measurement.display.toLowerCase() === normalized) {
      return true;
    }
    return measurement.aliases.some((alias) => alias.trim().toLowerCase() === normalized);
  });
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function createStarterRows(): ManualMarkerRow[] {
  return [
    createEmptyRow("HDL cholesterol", "", "mg/dL"),
    createEmptyRow("LDL cholesterol", "", "mg/dL"),
    createEmptyRow("Triglycerides", "", "mg/dL"),
    createEmptyRow("Glucose", "", "mg/dL")
  ];
}

function selectedMarkerOption(marker: string): string {
  return findKnownCatalogMarker(marker)?.marker ?? "";
}

function findKnownCatalogMarker(input: string) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return LAB_MARKER_CATALOG.find((entry) => entry.marker.toLowerCase() === normalized);
}

function createEmptyRow(marker = "", value = "", unit = ""): ManualMarkerRow {
  return {
    id: globalThis.crypto.randomUUID(),
    marker,
    value,
    unit
  };
}
