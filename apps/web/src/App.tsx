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
import type { AiQueryResult, AiQueryChartSeries } from "./api.js";
import { LAB_MARKER_CATALOG } from "./labMarkerCatalog.js";
import type { LabMarkerCatalogEntry } from "./labMarkerCatalog.js";

const sampleSamsungCsv = `date,type,value,unit
2026-06-25,steps,8421,count
2026-06-26,steps,9630,count
2026-06-27,steps,7102,count
2026-06-28,heart_rate,64,bpm
2026-06-29,heart_rate,61,bpm
2026-06-30,weight,82.4,kg`;

type AppRoute = "dashboard" | "summary" | "import" | "query";
type SummarySort = "name" | "count" | "recency";
type LabsMode = "manual" | "upload";
type ImportMode = "labs" | "fitness" | "samsung";

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
  const [importMode, setImportMode] = useState<ImportMode>(() => importModeFromPathname(window.location.pathname));
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
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

  const [aiQuestion, setAiQuestion] = useState("");
  const [aiResult, setAiResult] = useState<AiQueryResult | undefined>();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | undefined>();

  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(routeFromPathname(window.location.pathname));
      setImportMode(importModeFromPathname(window.location.pathname));
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
      setProfileEditorOpen(false);
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

  async function submitAiQuery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = aiQuestion.trim();
    if (!q) return;
    setAiBusy(true);
    setAiError(undefined);
    setAiResult(undefined);
    try {
      const result = await api.query.ai(q, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setAiResult(result);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Query failed.");
    } finally {
      setAiBusy(false);
    }
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

  function navigate(nextRoute: AppRoute, nextImportMode: ImportMode = importMode) {
    const routePaths: Record<AppRoute, string> = {
      dashboard: "/",
      import: importModePath(nextImportMode),
      summary: "/summary",
      query: "/query"
    };
    const nextPath = routePaths[nextRoute] ?? "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    if (nextRoute === "import") {
      setImportMode(nextImportMode);
    }
    setRoute(nextRoute);
  }

  function navigateImportMode(nextMode: ImportMode) {
    navigate("import", nextMode);
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
          const resolvedUnit = findKnownCatalogMarker(patch.marker)?.unit ?? findKnownMeasurement(patch.marker, labMeasurementTypes)?.canonicalUnit;
          if (resolvedUnit) {
            next.unit = resolvedUnit;
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
        <button className={route === "import" ? "active" : ""} onClick={() => navigate("import", importMode)}>
          Import
        </button>
        <button className={route === "summary" ? "active" : ""} onClick={() => navigate("summary")}>
          Health Data Summary
        </button>
        <button className={route === "query" ? "active" : ""} onClick={() => navigate("query")}>
          AI Query
        </button>
      </nav>

      {message ? <div className="notice">{message}</div> : null}

      {route === "dashboard" ? (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">Private health intelligence / local only</p>
              <h1>Your body data, held close.</h1>
              <p className="hero-copy">
                A local insights portal for your Android Health exports, lab markers, profile, and personal AI summaries.
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
              <div className="panel-heading-row">
                <h2>Profile context</h2>
                <button type="button" onClick={() => setProfileEditorOpen(true)}>Edit</button>
              </div>
              <dl className="profile-summary">
                <div>
                  <dt>Name</dt>
                  <dd>{profile?.displayName ?? "Local user"}</dd>
                </div>
                <div>
                  <dt>Birth year</dt>
                  <dd>{profile?.birthYear ?? "Not set"}</dd>
                </div>
                <div>
                  <dt>Sex</dt>
                  <dd>{formatProfileSex(profile?.sex)}</dd>
                </div>
                <div>
                  <dt>Height</dt>
                  <dd>{profile?.heightCm ? `${profile.heightCm} cm` : "Not set"}</dd>
                </div>
                <div>
                  <dt>Units</dt>
                  <dd>{profile?.units === "imperial" ? "Imperial" : "Metric"}</dd>
                </div>
              </dl>
              <div className="profile-goals">
                <span>Current focus</span>
                <p>{profile?.goalSummary || "Improve energy, sleep, and metabolic health."}</p>
              </div>
            </article>

            <article className="panel metrics-panel">
              <div className="panel-heading-row">
                <h2>Local analytics</h2>
                <button type="button" onClick={() => navigate("summary")}>View summary</button>
              </div>
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

          {profileEditorOpen ? (
            <ProfileEditDialog
              busy={busy}
              profile={profile}
              onClose={() => setProfileEditorOpen(false)}
              onSubmit={saveProfile}
            />
          ) : null}
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
      ) : route === "query" ? (
        <QueryPage
          question={aiQuestion}
          onQuestionChange={setAiQuestion}
          onSubmit={submitAiQuery}
          busy={aiBusy}
          result={aiResult}
          error={aiError}
        />
      ) : route === "import" ? (
        <ImportPage
          busy={busy}
          mode={importMode}
          onModeChange={navigateImportMode}
          labsMode={labsMode}
          onLabsModeChange={setLabsMode}
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
          samsungFileName={samsungFileName}
          samsungCsv={samsungCsv}
          onSamsungFileNameChange={setSamsungFileName}
          onSamsungCsvChange={setSamsungCsv}
          onImportSamsungCsv={importSamsungCsv}
        />
      ) : (
        null
      )}
    </main>
  );
}

function ProfileEditDialog({
  busy,
  profile,
  onClose,
  onSubmit
}: {
  busy: boolean;
  profile?: Profile;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <div className="panel-heading-row">
          <div>
            <p className="eyebrow">Editable local context</p>
            <h2 id="profile-dialog-title">Edit profile</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={onSubmit} className="profile-form">
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
      </section>
    </div>
  );
}

function ImportPage({
  busy,
  mode,
  onModeChange,
  labsMode,
  onLabsModeChange,
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
  uploadInputRef,
  samsungFileName,
  samsungCsv,
  onSamsungFileNameChange,
  onSamsungCsvChange,
  onImportSamsungCsv
}: {
  busy: boolean;
  mode: ImportMode;
  onModeChange: (mode: ImportMode) => void;
  labsMode: LabsMode;
  onLabsModeChange: (mode: LabsMode) => void;
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
  samsungFileName: string;
  samsungCsv: string;
  onSamsungFileNameChange: (value: string) => void;
  onSamsungCsvChange: (value: string) => void;
  onImportSamsungCsv: () => void;
}) {
  return (
    <section className="import-page">
      <div className="import-header">
        <div>
          <p className="eyebrow">Bring local data into the vault</p>
          <h1>Import</h1>
        </div>
        <p className="import-copy">
          Labs, Health Connect, and Samsung exports live here so the dashboard can stay focused on review.
        </p>
      </div>
      <div className="import-tabs" role="tablist" aria-label="Import source">
        <button className={mode === "labs" ? "active" : ""} onClick={() => onModeChange("labs")}>Labs</button>
        <button className={mode === "fitness" ? "active" : ""} onClick={() => onModeChange("fitness")}>Fitness Tracker</button>
        <button className={mode === "samsung" ? "active" : ""} onClick={() => onModeChange("samsung")}>Samsung CSV</button>
      </div>

      {mode === "labs" ? (
        <LabsPage
          busy={busy}
          mode={labsMode}
          onModeChange={onLabsModeChange}
          panelName={panelName}
          labName={labName}
          collectedAt={collectedAt}
          rows={rows}
          onPanelNameChange={onPanelNameChange}
          onLabNameChange={onLabNameChange}
          onCollectedAtChange={onCollectedAtChange}
          onRowChange={onRowChange}
          onAddRow={onAddRow}
          onRemoveRow={onRemoveRow}
          onSubmitManual={onSubmitManual}
          onSubmitUpload={onSubmitUpload}
          onUploadFileChange={onUploadFileChange}
          uploadInputRef={uploadInputRef}
        />
      ) : null}

      {mode === "fitness" ? <FitnessTrackerImportPanel /> : null}

      {mode === "samsung" ? (
        <SamsungCsvImportPanel
          busy={busy}
          fileName={samsungFileName}
          csv={samsungCsv}
          onFileNameChange={onSamsungFileNameChange}
          onCsvChange={onSamsungCsvChange}
          onImport={onImportSamsungCsv}
        />
      ) : null}
    </section>
  );
}

function FitnessTrackerImportPanel() {
  return (
    <section className="panel import-source-panel">
      <div>
        <p className="eyebrow">Android companion</p>
        <h2>Fitness Tracker</h2>
      </div>
      <p className="empty">
        Sync Health Connect from the Android companion app to import recent steps, heart rate, sleep, oxygen saturation,
        and other supported fitness samples into the local vault.
      </p>
      <div className="import-guidance-grid">
        <div>
          <strong>1. Open companion app</strong>
          <span>Use the Android Companion to read Health Connect on-device.</span>
        </div>
        <div>
          <strong>2. Confirm local API</strong>
          <span>Point it at the local API server running on your development machine.</span>
        </div>
        <div>
          <strong>3. Sync recent data</strong>
          <span>The API receives the batch and stores it alongside your other local measurements.</span>
        </div>
      </div>
    </section>
  );
}

function SamsungCsvImportPanel({
  busy,
  fileName,
  csv,
  onFileNameChange,
  onCsvChange,
  onImport
}: {
  busy: boolean;
  fileName: string;
  csv: string;
  onFileNameChange: (value: string) => void;
  onCsvChange: (value: string) => void;
  onImport: () => void;
}) {
  return (
    <section className="panel import-source-panel">
      <div>
        <p className="eyebrow">Samsung Health export</p>
        <h2>Samsung CSV</h2>
      </div>
      <p className="empty">Paste a Samsung Health CSV export or keep the sample data to test the local import pipeline.</p>
      <label>
        File name
        <input value={fileName} onChange={(event) => onFileNameChange(event.target.value)} />
      </label>
      <label>
        CSV content
        <textarea className="csv-box" value={csv} onChange={(event) => onCsvChange(event.target.value)} />
      </label>
      <button disabled={busy} onClick={onImport}>Process into vault</button>
    </section>
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
                    value={getCatalogMarkerOrEmpty(row.marker)}
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

function QueryPage({
  question,
  onQuestionChange,
  onSubmit,
  busy,
  result,
  error
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  result?: AiQueryResult;
  error?: string;
}) {
  return (
    <section className="panel query-panel">
      <div>
        <p className="eyebrow">AI-powered natural language query</p>
        <h2>Ask your health data</h2>
      </div>
      <p className="safety">{safetyNotice}</p>

      <form className="query-form" onSubmit={onSubmit}>
        <label>
          Question
          <input
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="e.g. average heart rate last month"
            disabled={busy}
          />
        </label>
        <button disabled={busy || !question.trim()} type="submit">
          {busy ? "Querying…" : "Ask"}
        </button>
      </form>

      <div className="query-examples">
        <span>Try: </span>
        {[
          "max daily steps this month",
          "average heart rate last month",
          "top exercises this month"
        ].map((example) => (
          <button
            key={example}
            className="query-example-chip"
            type="button"
            onClick={() => onQuestionChange(example)}
          >
            {example}
          </button>
        ))}
      </div>

      {error ? <p className="empty">{error}</p> : null}

      {result ? <QueryResult result={result} /> : null}
    </section>
  );
}

function QueryResult({ result }: { result: AiQueryResult }) {
  const confidencePct = Math.round(result.confidence * 100);
  const confidenceLabel =
    result.confidence >= 0.8 ? "high" :
    result.confidence >= 0.5 ? "medium" :
    "low";

  return (
    <div className="query-result">
      <div className="query-answer">
        <h3>Answer</h3>
        <p>{result.answer}</p>
        {result.suggestedRephrase ? (
          <p className="query-rephrase"><em>Suggestion: {result.suggestedRephrase}</em></p>
        ) : null}
      </div>

      <div className="query-meta">
        <span>Confidence: <strong data-level={confidenceLabel}>{confidencePct}%</strong></span>
        {result.resolvedTimeRange ? (
          <span>Time range: <strong>{result.resolvedTimeRange.label}</strong></span>
        ) : null}
        {result.rowCount !== undefined ? (
          <span>Rows: <strong>{result.rowCount}</strong></span>
        ) : null}
      </div>

      {result.chart && result.chart.series.length > 0 ? (
        <div className="query-chart">
          <h3>Chart</h3>
          <QueryChart chart={result.chart} />
        </div>
      ) : null}

      {result.rows.length > 0 ? (
        <div className="query-table">
          <h3>Data preview</h3>
          <div className="query-table-scroll">
            <table>
              <thead>
                <tr>
                  {Object.keys(result.rows[0]).map((key) => (
                    <th key={key}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 20).map((row, idx) => (
                  <tr key={idx}>
                    {Object.values(row).map((cell, cidx) => (
                      <td key={cidx}>{cell === null || cell === undefined ? "—" : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {result.sql ? (
        <details className="query-sql">
          <summary>Generated SQL</summary>
          <pre>{result.sql}</pre>
        </details>
      ) : null}

      {result.limitations.length > 0 ? (
        <details className="query-limitations" open>
          <summary>Limitations &amp; notes</summary>
          <ul>
            {result.limitations.map((lim, idx) => <li key={idx}>{lim}</li>)}
          </ul>
          {result.assumptions.length > 0 ? (
            <ul>
              {result.assumptions.map((a, idx) => <li key={idx}>Assumed: {a}</li>)}
            </ul>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function QueryChart({ chart }: { chart: { type: string; series: AiQueryChartSeries[] } }) {
  const values = chart.series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  if (chart.type === "line" && chart.series.length > 1) {
    const path = chart.series
      .map((point, index) => {
        const x = (index / Math.max(1, chart.series.length - 1)) * 280;
        const y = 80 - ((point.value - min) / range) * 70;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
    return (
      <div className="query-chart-container">
        <svg viewBox="0 0 280 90" role="img" aria-label="Query result chart" className="query-chart-svg">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <div className="query-chart-labels">
          <span>{chart.series[0].label}</span>
          <span>{chart.series[chart.series.length - 1].label}</span>
        </div>
      </div>
    );
  }

  // Bar chart
  return (
    <div className="query-chart-bars">
      {chart.series.slice(0, 15).map((point) => {
        const pct = range > 0 ? ((point.value - min) / range) * 100 : 50;
        return (
          <div key={point.label} className="query-bar-item">
            <span className="query-bar-label">{point.label}</span>
            <div className="query-bar-track">
              <div className="query-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <span className="query-bar-value">{typeof point.value === "number" ? point.value.toFixed(1) : point.value}</span>
          </div>
        );
      })}
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
  if (pathname === "/import" || pathname.startsWith("/import/") || pathname === "/labs") {
    return "import";
  }
  if (pathname === "/query") {
    return "query";
  }
  return "dashboard";
}

function importModeFromPathname(pathname: string): ImportMode {
  if (pathname === "/import/fitness-tracker") {
    return "fitness";
  }
  if (pathname === "/import/samsung-csv") {
    return "samsung";
  }
  return "labs";
}

function importModePath(mode: ImportMode): string {
  if (mode === "fitness") {
    return "/import/fitness-tracker";
  }
  if (mode === "samsung") {
    return "/import/samsung-csv";
  }
  return "/import/labs";
}

function formatProfileSex(value?: Profile["sex"]): string {
  if (!value || value === "not-specified") {
    return "Prefer not to say";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function getCatalogMarkerOrEmpty(marker: string): string {
  return findKnownCatalogMarker(marker)?.marker ?? "";
}

function findKnownCatalogMarker(input: string): LabMarkerCatalogEntry | undefined {
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
