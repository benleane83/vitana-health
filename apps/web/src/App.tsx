import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyticsSummary,
  BodyCompositionDraft,
  BodyCompositionDraftRow,
  HealthDataDetail,
  HealthDataDetailEntry,
  HealthDataSummary,
  HealthDataSummaryTypeRow,
  HealthStoreData,
  Insight,
  ManualLabEntryPayload,
  MeasurementType,
  Profile,
  ProfileListEntry
} from "@local-fitness-advisor/shared";
import { MANUAL_LAB_MARKER_CATALOG, safetyNotice } from "@local-fitness-advisor/shared";
import { api } from "./api.js";
import type { AiQueryResult, AiQueryChartSeries, PairedDevice, PendingPairing } from "./api.js";

type AppRoute = "dashboard" | "summary" | "import" | "query";
type SummarySort = "name" | "count" | "recency";
type LabsMode = "manual" | "upload" | "bodycomp";
type ImportMode = "labs" | "fitness";

interface ManualMarkerRow {
  id: string;
  marker: string;
  value: string;
  unit: string;
}

interface BodyCompositionEditableRow {
  id: string;
  label: string;
  measurementCode: string;
  displayName: string;
  value: string;
  unit: string;
  observedAt?: string;
  confidence: BodyCompositionDraftRow["confidence"];
  sourceText?: string;
  included: boolean;
  generatedCode?: boolean;
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
const flatChartPaddingRatio = 0.05;
const minimumFlatChartPadding = 1;

export function App() {
  const [store, setStore] = useState<HealthStoreData>();
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [route, setRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [importMode, setImportMode] = useState<ImportMode>(() => importModeFromPathname(window.location.pathname));
  const [summaryDetailCode, setSummaryDetailCode] = useState<string | undefined>(() => summaryDetailCodeFromPathname(window.location.pathname));
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileListEntry[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>();
  const [newProfileName, setNewProfileName] = useState("");
  const [summary, setSummary] = useState<HealthDataSummary>();
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string>();
  const [summaryDetail, setSummaryDetail] = useState<HealthDataDetail>();
  const [summaryDetailBusy, setSummaryDetailBusy] = useState(false);
  const [summaryDetailError, setSummaryDetailError] = useState<string>();
  const [summaryDetailActionBusy, setSummaryDetailActionBusy] = useState(false);
  const [summarySort, setSummarySort] = useState<SummarySort>("recency");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [labsMode, setLabsMode] = useState<LabsMode>("manual");
  const [manualCollectedAt, setManualCollectedAt] = useState(todayIsoDate());
  const [manualPanelName, setManualPanelName] = useState("Lipid panel");
  const [manualLabName, setManualLabName] = useState("");
  const [manualRows, setManualRows] = useState<ManualMarkerRow[]>(() => createStarterRows());
  const [uploadFile, setUploadFile] = useState<File>();
  const [bodyCompFile, setBodyCompFile] = useState<File>();
  const [bodyCompDraft, setBodyCompDraft] = useState<BodyCompositionDraft>();
  const [bodyCompRows, setBodyCompRows] = useState<BodyCompositionEditableRow[]>([]);
  const [bodyCompReportDate, setBodyCompReportDate] = useState(todayIsoDate());

  const [aiQuestion, setAiQuestion] = useState("");
  const [aiResult, setAiResult] = useState<AiQueryResult | undefined>();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | undefined>();

  const [pendingPairings, setPendingPairings] = useState<PendingPairing[]>([]);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const bodyCompInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void refresh().catch((error: unknown) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "Unable to load local health data.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(routeFromPathname(window.location.pathname));
      setImportMode(importModeFromPathname(window.location.pathname));
      setSummaryDetailCode(summaryDetailCodeFromPathname(window.location.pathname));
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
    void loadSummary()
      .then((nextSummary) => {
        if (cancelled) {
          return;
        }
        applySummary(nextSummary);
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

  useEffect(() => {
    if (route !== "summary" || !summaryDetailCode) {
      setSummaryDetail(undefined);
      setSummaryDetailError(undefined);
      setSummaryDetailBusy(false);
      return;
    }
    let cancelled = false;
    setSummaryDetailBusy(true);
    setSummaryDetailError(undefined);
    void api
      .healthDataDetail(summaryDetailCode)
      .then((nextDetail) => {
        if (!cancelled) {
          setSummaryDetail(nextDetail);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSummaryDetailError(error instanceof Error ? error.message : "Unable to load detail.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSummaryDetailBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route, summaryDetailCode]);

  const profile = store?.profile;
  const activeProfile = profiles.find((entry) => entry.id === activeProfileId) ?? profile;
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
    const [nextStore, nextAnalytics, nextProfiles] = await Promise.all([api.store(), api.analytics(), api.profiles.list()]);
    setStore(nextStore);
    setAnalytics(nextAnalytics);
    setProfiles(nextProfiles.profiles);
    setActiveProfileId(nextProfiles.activeProfileId);
  }

  async function refreshForCurrentRoute() {
    await refresh();
    if (route === "summary") {
      const nextSummary = await loadSummary();
      applySummary(nextSummary);
      if (summaryDetailCode) {
        setSummaryDetail(await api.healthDataDetail(summaryDetailCode));
      }
    }
  }

  async function loadSummary() {
    return api.summary();
  }

  function applySummary(nextSummary: HealthDataSummary) {
    setSummary(nextSummary);
    setExpandedCategories(new Set(nextSummary.categories.map((category) => category.key)));
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
      await refreshForCurrentRoute();
      setProfileEditorOpen(false);
    });
  }

  async function switchProfile(profileId: string) {
    if (profileId === activeProfileId) {
      setProfileManagerOpen(false);
      return;
    }
    await run("Profile switched.", async () => {
      await api.profiles.setActive(profileId);
      await refreshForCurrentRoute();
      setProfileManagerOpen(false);
    });
  }

  async function createProfile() {
    const displayName = newProfileName.trim();
    if (!displayName) {
      setMessage("Enter a profile name first.");
      return;
    }
    await run("Profile created.", async () => {
      const created = await api.profiles.create(displayName);
      setNewProfileName("");
      await api.profiles.setActive(created.id);
      await refreshForCurrentRoute();
    });
  }

  async function deleteProfile(profileId: string) {
    const target = profiles.find((entry) => entry.id === profileId);
    const confirmed = window.confirm(`Delete profile ${target?.displayName ?? profileId}? This removes its local encrypted store.`);
    if (!confirmed) {
      return;
    }
    await run("Profile deleted.", async () => {
      await api.profiles.remove(profileId);
      await refreshForCurrentRoute();
      setProfileManagerOpen(false);
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

  async function previewBodyCompositionReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bodyCompFile) {
      setMessage("Select a PDF or image before preview.");
      return;
    }
    if (!isSupportedBodyCompMimeType(bodyCompFile.type)) {
      setMessage("Use a PDF, JPEG, or PNG body composition report.");
      return;
    }

    await run("Body composition scan parsed for review.", async () => {
      const contentBase64 = await readFileAsBase64(bodyCompFile);
      const draft = await api.previewBodyCompositionReport({
        fileName: bodyCompFile.name,
        mimeType: bodyCompFile.type,
        contentBase64
      });
      setBodyCompDraft(draft);
      setBodyCompReportDate(draft.reportDate?.slice(0, 10) ?? todayIsoDate());
      setBodyCompRows(draft.rows.map(toEditableBodyCompRow));
    });
  }

  async function commitBodyCompositionReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bodyCompDraft) {
      setMessage("Preview a body composition report before saving.");
      return;
    }
    const rows = bodyCompRows.map(toBodyCompositionDraftRow);
    const includedRows = rows.filter((row) => row.included);
    if (includedRows.length === 0) {
      setMessage("Include at least one parsed row before saving.");
      return;
    }

    await run("Approved body composition observations saved.", async () => {
      await api.commitBodyCompositionReport({
        fileName: bodyCompDraft.fileName,
        reportDate: bodyCompReportDate,
        sourceText: bodyCompDraft.sourceText,
        sourceChecksum: bodyCompDraft.checksum,
        rows
      });
      await refresh();
      setBodyCompDraft(undefined);
      setBodyCompRows([]);
      setBodyCompFile(undefined);
      setBodyCompReportDate(todayIsoDate());
      if (bodyCompInputRef.current) {
        bodyCompInputRef.current.value = "";
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

  useEffect(() => {
    if (route !== "import" || importMode !== "fitness") return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function poll() {
      if (cancelled) return;
      try {
        const result = await api.pairing.pending();
        if (!cancelled) setPendingPairings(result);
      } catch {
        // silently ignore — pairing is optional
      }
      if (!cancelled) {
        timeoutId = setTimeout(poll, 5000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [route, importMode]);

  async function approvePairing(id: string) {
    try {
      await api.pairing.approve(id);
      const result = await api.pairing.pending();
      setPendingPairings(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not approve pairing request.");
    }
  }

  async function denyPairing(id: string) {
    try {
      await api.pairing.deny(id);
      const result = await api.pairing.pending();
      setPendingPairings(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not deny pairing request.");
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
      summary: summaryPath(),
      query: "/query"
    };
    const nextPath = routePaths[nextRoute] ?? "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    if (nextRoute === "import") {
      setImportMode(nextImportMode);
    }
    if (nextRoute === "summary") {
      setSummaryDetailCode(undefined);
    }
    setRoute(nextRoute);
  }

  function navigateImportMode(nextMode: ImportMode) {
    navigate("import", nextMode);
  }

  function navigateSummaryDetail(measurementCode: string) {
    const nextPath = summaryPath(measurementCode);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setRoute("summary");
    setSummaryDetailCode(measurementCode);
  }

  async function deleteObservationEntry(entry: HealthDataDetailEntry) {
    if (!entry.canDelete) {
      return;
    }
    const confirmation = window.confirm(
      `Delete ${entry.displayName} observation?\n\n${formatTimestamp(entry.timestamp)}\n${formatDetailValue(entry.value)} ${entry.unit}`
    );
    if (!confirmation) {
      return;
    }
    setSummaryDetailActionBusy(true);
    setMessage(undefined);
    try {
      await api.deleteObservation(entry.id);
      await refresh();
      const [nextSummary, nextDetail] = await Promise.all([
        loadSummary(),
        summaryDetailCode ? api.healthDataDetail(summaryDetailCode) : Promise.resolve(undefined)
      ]);
      applySummary(nextSummary);
      setSummaryDetail(nextDetail);
      setMessage("Observation deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setSummaryDetailActionBusy(false);
    }
  }

  async function deleteObservationsByType() {
    if (!summaryDetailCode || !summaryDetail) {
      return;
    }
    const observationCount = summaryDetail.deletion.observationEntries;
    const confirmation = window.confirm(
      `Delete ${observationCount} ${summaryDetail.measurement.displayName} observation record(s)?`
    );
    if (!confirmation) {
      return;
    }
    setSummaryDetailActionBusy(true);
    setMessage(undefined);
    try {
      await api.deleteObservationsByType(summaryDetailCode);
      await refresh();
      const [nextSummary, nextDetail] = await Promise.all([loadSummary(), api.healthDataDetail(summaryDetailCode)]);
      applySummary(nextSummary);
      setSummaryDetail(nextDetail);
      setMessage(observationCount === 1 ? "1 observation deleted." : `${observationCount} observations deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setSummaryDetailActionBusy(false);
    }
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

  function updateBodyCompRow(id: string, patch: Partial<BodyCompositionEditableRow>) {
    setBodyCompRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
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
        {activeProfile ? <span className="active-profile-pill">Profile: {activeProfile.displayName}</span> : null}
        <button type="button" className="manage-profiles-button" onClick={() => setProfileManagerOpen(true)}>
          Manage profiles
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

          {profileManagerOpen ? (
            <ProfileManagerDialog
              busy={busy}
              profiles={profiles}
              activeProfile={activeProfile}
              activeProfileId={activeProfileId}
              newProfileName={newProfileName}
              onNewProfileNameChange={setNewProfileName}
              onClose={() => setProfileManagerOpen(false)}
              onSwitchProfile={(profileId) => { void switchProfile(profileId); }}
              onCreateProfile={() => { void createProfile(); }}
              onDeleteActive={() => {
                if (activeProfileId) {
                  void deleteProfile(activeProfileId);
                }
              }}
            />
          ) : null}
        </>
      ) : route === "summary" ? (
        summaryDetailCode ? (
          <ObservationTypeDetailPage
            detail={summaryDetail}
            loading={summaryDetailBusy}
            error={summaryDetailError}
            actionBusy={summaryDetailActionBusy}
            onBack={() => navigate("summary")}
            onDeleteObservation={deleteObservationEntry}
            onDeleteAll={deleteObservationsByType}
          />
        ) : (
          <SummaryPage
            summary={summary}
            loading={summaryBusy}
            error={summaryError}
            sort={summarySort}
            onSortChange={setSummarySort}
            expandedCategories={expandedCategories}
            onToggleCategory={toggleCategory}
            onSelectRow={navigateSummaryDetail}
          />
        )
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
          bodyCompFile={bodyCompFile}
          bodyCompDraft={bodyCompDraft}
          bodyCompRows={bodyCompRows}
          bodyCompReportDate={bodyCompReportDate}
          onBodyCompFileChange={setBodyCompFile}
          onBodyCompReportDateChange={setBodyCompReportDate}
          onBodyCompRowChange={updateBodyCompRow}
          onPreviewBodyComp={previewBodyCompositionReport}
          onCommitBodyComp={commitBodyCompositionReport}
          bodyCompInputRef={bodyCompInputRef}
          pendingPairings={pendingPairings}
          onApprovePairing={approvePairing}
          onDenyPairing={denyPairing}
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

function ProfileManagerDialog({
  busy,
  profiles,
  activeProfile,
  activeProfileId,
  newProfileName,
  onNewProfileNameChange,
  onClose,
  onSwitchProfile,
  onCreateProfile,
  onDeleteActive
}: {
  busy: boolean;
  profiles: ProfileListEntry[];
  activeProfile?: ProfileListEntry | Profile;
  activeProfileId?: string;
  newProfileName: string;
  onNewProfileNameChange: (value: string) => void;
  onClose: () => void;
  onSwitchProfile: (profileId: string) => void;
  onCreateProfile: () => void;
  onDeleteActive: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-manager-title">
        <div className="panel-heading-row">
          <div>
            <p className="eyebrow">Profile-scoped local data</p>
            <h2 id="profile-manager-title">Manage profiles</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        <p className="profile-dialog-active" title={activeProfile?.id}>
          Active profile: <strong>{activeProfile?.displayName ?? "Local user"}</strong>
        </p>

        <div className="profile-switcher-row">
          <label>
            Switch profile
            <select value={activeProfileId} disabled={busy} onChange={(event) => onSwitchProfile(event.target.value)}>
              {profiles.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.displayName}
                </option>
              ))}
            </select>
          </label>

          <div className="profile-create-form">
            <label>
              Create profile
              <input value={newProfileName} onChange={(event) => onNewProfileNameChange(event.target.value)} placeholder="New profile name" maxLength={80} />
            </label>
            <button type="button" disabled={busy} onClick={onCreateProfile}>Create</button>
          </div>
        </div>

        <div className="profile-dialog-actions">
          <button type="button" disabled={busy || profiles.length <= 1} onClick={onDeleteActive}>
            Delete active profile
          </button>
        </div>
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
  bodyCompFile,
  bodyCompDraft,
  bodyCompRows,
  bodyCompReportDate,
  onBodyCompFileChange,
  onBodyCompReportDateChange,
  onBodyCompRowChange,
  onPreviewBodyComp,
  onCommitBodyComp,
  bodyCompInputRef,
  pendingPairings,
  onApprovePairing,
  onDenyPairing
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
  bodyCompFile?: File;
  bodyCompDraft?: BodyCompositionDraft;
  bodyCompRows: BodyCompositionEditableRow[];
  bodyCompReportDate: string;
  onBodyCompFileChange: (file?: File) => void;
  onBodyCompReportDateChange: (value: string) => void;
  onBodyCompRowChange: (id: string, patch: Partial<BodyCompositionEditableRow>) => void;
  onPreviewBodyComp: (event: React.FormEvent<HTMLFormElement>) => void;
  onCommitBodyComp: (event: React.FormEvent<HTMLFormElement>) => void;
  bodyCompInputRef: React.RefObject<HTMLInputElement | null>;
  pendingPairings: PendingPairing[];
  onApprovePairing: (id: string) => void;
  onDenyPairing: (id: string) => void;
}) {
  return (
    <section className="import-page">
      <div className="import-header">
        <div>
          <p className="eyebrow">Bring local data into the vault</p>
          <h1>Import</h1>
        </div>
        <p className="import-copy">
          Labs and Health Connect imports live here so the dashboard can stay focused on review.
        </p>
      </div>
      <div className="import-tabs" role="tablist" aria-label="Import source">
        <button className={mode === "labs" ? "active" : ""} onClick={() => onModeChange("labs")}>Labs</button>
        <button className={mode === "fitness" ? "active" : ""} onClick={() => onModeChange("fitness")}>Fitness Tracker</button>
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
          bodyCompFile={bodyCompFile}
          bodyCompDraft={bodyCompDraft}
          bodyCompRows={bodyCompRows}
          bodyCompReportDate={bodyCompReportDate}
          onBodyCompFileChange={onBodyCompFileChange}
          onBodyCompReportDateChange={onBodyCompReportDateChange}
          onBodyCompRowChange={onBodyCompRowChange}
          onPreviewBodyComp={onPreviewBodyComp}
          onCommitBodyComp={onCommitBodyComp}
          bodyCompInputRef={bodyCompInputRef}
        />
      ) : null}

      {mode === "fitness" ? (
        <FitnessTrackerImportPanel
          pendingPairings={pendingPairings}
          onApprove={onApprovePairing}
          onDeny={onDenyPairing}
        />
      ) : null}
    </section>
  );
}

function FitnessTrackerImportPanel({
  pendingPairings,
  onApprove,
  onDeny
}: {
  pendingPairings: PendingPairing[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);

  useEffect(() => {
    void api.pairing.devices().then(setPairedDevices).catch(() => setPairedDevices([]));
  }, [pendingPairings]);

  async function revokeDevice(id: string) {
    await api.pairing.revoke(id);
    setPairedDevices(await api.pairing.devices());
  }

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

      <div className="pairing-section">
        <div>
          <p className="eyebrow">Companion pairing</p>
          <strong>Scan to connect</strong>
        </div>
        <p className="empty">
          Open the companion app, tap <strong>Set Up Connection</strong>, and scan this QR code. The app will find this
          server automatically — no IP address required.
        </p>
        <PairingQr />
        <p className="empty pairing-hint">
          The QR code contains a short-lived pairing code and the server's LAN address. LAN use requires configured
          authentication and HTTPS, except for the explicit development-only HTTP mode.
        </p>
      </div>

      {pendingPairings.length > 0 ? (
        <div className="pairing-requests">
          <p className="eyebrow">Pairing requests</p>
          {pendingPairings.map((req) => (
            <div key={req.id} className="pairing-request-row">
              <div className="pairing-request-info">
                <strong>{req.deviceName}</strong>
                <span className="muted">Device ID: {req.deviceId.slice(0, 12)}…</span>
                <span className="muted">Requested: {new Date(req.requestedAt).toLocaleTimeString()}</span>
              </div>
              <div className="pairing-request-actions">
                <button type="button" onClick={() => onApprove(req.id)}>Approve</button>
                <button type="button" onClick={() => onDeny(req.id)}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {pairedDevices.length > 0 ? (
        <div className="pairing-requests">
          <p className="eyebrow">Paired devices</p>
          {pairedDevices.map((device) => (
            <div key={device.id} className="pairing-request-row">
              <div className="pairing-request-info">
                <strong>{device.deviceName}</strong>
                <span className="muted">
                  {device.revokedAt
                    ? `Revoked ${new Date(device.revokedAt).toLocaleString()}`
                    : device.lastUsedAt
                      ? `Last sync ${new Date(device.lastUsedAt).toLocaleString()}`
                      : "Not synced yet"}
                </span>
              </div>
              {!device.revokedAt ? (
                <button type="button" onClick={() => { void revokeDevice(device.id); }}>Revoke</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="import-guidance-grid">
        <div>
          <strong>1. Open companion app</strong>
          <span>Tap <em>Set Up Connection</em> and scan the short-lived QR code.</span>
        </div>
        <div>
          <strong>2. Approve pairing</strong>
          <span>A pairing request will appear above. Approve it to issue the companion a secure token.</span>
        </div>
        <div>
          <strong>3. Sync recent data</strong>
          <span>The app syncs automatically once paired. Token is stored on-device for future syncs.</span>
        </div>
      </div>
    </section>
  );
}

function PairingQr() {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void api.pairing.qr()
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to create pairing QR code.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  if (error) return <p className="empty">{error}</p>;
  return (
    <div className="pairing-qr-wrap">
      {url ? (
        <img
          src={url}
          alt="Short-lived QR code for secure companion pairing"
          width={200}
          height={200}
          className="pairing-qr"
        />
      ) : <span className="empty">Creating short-lived pairing code…</span>}
    </div>
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
  uploadInputRef,
  bodyCompFile,
  bodyCompDraft,
  bodyCompRows,
  bodyCompReportDate,
  onBodyCompFileChange,
  onBodyCompReportDateChange,
  onBodyCompRowChange,
  onPreviewBodyComp,
  onCommitBodyComp,
  bodyCompInputRef
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
  bodyCompFile?: File;
  bodyCompDraft?: BodyCompositionDraft;
  bodyCompRows: BodyCompositionEditableRow[];
  bodyCompReportDate: string;
  onBodyCompFileChange: (file?: File) => void;
  onBodyCompReportDateChange: (value: string) => void;
  onBodyCompRowChange: (id: string, patch: Partial<BodyCompositionEditableRow>) => void;
  onPreviewBodyComp: (event: React.FormEvent<HTMLFormElement>) => void;
  onCommitBodyComp: (event: React.FormEvent<HTMLFormElement>) => void;
  bodyCompInputRef: React.RefObject<HTMLInputElement | null>;
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
          <button className={mode === "bodycomp" ? "active" : ""} onClick={() => onModeChange("bodycomp")}>
            Body comp scan
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
                    {MANUAL_LAB_MARKER_CATALOG.map((entry) => (
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
      ) : mode === "upload" ? (
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
      ) : (
        <BodyCompositionImportPanel
          busy={busy}
          file={bodyCompFile}
          draft={bodyCompDraft}
          rows={bodyCompRows}
          reportDate={bodyCompReportDate}
          inputRef={bodyCompInputRef}
          onFileChange={onBodyCompFileChange}
          onReportDateChange={onBodyCompReportDateChange}
          onRowChange={onBodyCompRowChange}
          onPreview={onPreviewBodyComp}
          onCommit={onCommitBodyComp}
        />
      )}
    </section>
  );
}

function BodyCompositionImportPanel({
  busy,
  file,
  draft,
  rows,
  reportDate,
  inputRef,
  onFileChange,
  onReportDateChange,
  onRowChange,
  onPreview,
  onCommit
}: {
  busy: boolean;
  file?: File;
  draft?: BodyCompositionDraft;
  rows: BodyCompositionEditableRow[];
  reportDate: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (file?: File) => void;
  onReportDateChange: (value: string) => void;
  onRowChange: (id: string, patch: Partial<BodyCompositionEditableRow>) => void;
  onPreview: (event: React.FormEvent<HTMLFormElement>) => void;
  onCommit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const includedCount = rows.filter((row) => row.included).length;
  return (
    <div className="bodycomp-import">
      <form className="labs-upload-form" onSubmit={onPreview}>
        <label>
          Select body composition report
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(event) => onFileChange(event.target.files?.[0])}
          />
        </label>
        <div className="bodycomp-upload-actions">
          <span>{file ? `${file.name} / ${formatBytes(file.size)}` : "PDF, JPEG, or PNG. Parsed locally before save."}</span>
          <button disabled={busy || !file} type="submit">Preview scan</button>
        </div>
      </form>

      {draft ? (
        <form className="bodycomp-review" onSubmit={onCommit}>
          <div className="bodycomp-review-header">
            <div>
              <p className="eyebrow">Review before saving</p>
              <h3>{draft.fileName}</h3>
              <p className="empty">{rows.length} parsed row(s), {includedCount} selected for save.</p>
            </div>
            <label>
              Report date
              <input type="date" value={reportDate} onChange={(event) => onReportDateChange(event.target.value)} />
            </label>
          </div>

          {draft.diagnostics.length > 0 ? (
            <div className="bodycomp-diagnostics" role="status">
              {draft.diagnostics.slice(0, 6).map((diagnostic) => <span key={diagnostic}>{diagnostic}</span>)}
            </div>
          ) : null}

          <div className="bodycomp-rows" role="table" aria-label="Parsed body composition observations">
            <div className="bodycomp-row bodycomp-row-head" role="row">
              <span role="columnheader">Save</span>
              <span role="columnheader">Measurement</span>
              <span role="columnheader">Value</span>
              <span role="columnheader">Unit</span>
              <span role="columnheader">Confidence</span>
            </div>
            {rows.map((row) => (
              <div className="bodycomp-row" role="row" key={row.id} data-included={row.included}>
                <span role="cell" className="bodycomp-include-cell">
                  <input
                    type="checkbox"
                    checked={row.included}
                    aria-label={`Save ${row.displayName}`}
                    onChange={(event) => onRowChange(row.id, { included: event.target.checked })}
                  />
                </span>
                <span role="cell" className="bodycomp-measurement-cell">
                  <input value={row.displayName} onChange={(event) => onRowChange(row.id, { displayName: event.target.value })} />
                  <input value={row.measurementCode} onChange={(event) => onRowChange(row.id, { measurementCode: event.target.value })} />
                  {row.sourceText ? <em>{row.sourceText}</em> : null}
                </span>
                <span role="cell">
                  <input inputMode="decimal" value={row.value} onChange={(event) => onRowChange(row.id, { value: event.target.value })} />
                </span>
                <span role="cell">
                  <input value={row.unit} onChange={(event) => onRowChange(row.id, { unit: event.target.value })} />
                </span>
                <span role="cell" className="bodycomp-confidence-cell">
                  <strong data-confidence={row.confidence}>{row.confidence}</strong>
                  {row.generatedCode ? <small>Generated code</small> : null}
                </span>
              </div>
            ))}
          </div>

          <div className="labs-actions">
            <span className="empty">Only selected rows will be saved as observations.</span>
            <button disabled={busy || includedCount === 0} type="submit">Save approved observations</button>
          </div>
        </form>
      ) : null}
    </div>
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

function ObservationTypeDetailPage({
  detail,
  loading,
  error,
  actionBusy,
  onBack,
  onDeleteObservation,
  onDeleteAll
}: {
  detail?: HealthDataDetail;
  loading: boolean;
  error?: string;
  actionBusy: boolean;
  onBack: () => void;
  onDeleteObservation: (entry: HealthDataDetailEntry) => void | Promise<void>;
  onDeleteAll: () => void | Promise<void>;
}) {
  return (
    <section className="panel summary-panel">
      <div className="summary-detail-header">
        <div>
          <button type="button" className="summary-back-link" onClick={onBack}>
            ← Back to summary
          </button>
          <p className="eyebrow">Loaded health data by type</p>
          <h2>{detail?.measurement.displayName ?? "Measurement detail"}</h2>
          <p className="summary-detail-code">{detail?.measurement.code ?? "Loading code..."}</p>
        </div>
        <div className="summary-detail-actions">
          <button
            type="button"
            onClick={() => void onDeleteAll()}
            disabled={loading || actionBusy || (detail?.deletion.observationEntries ?? 0) === 0}
          >
            {actionBusy ? "Deleting..." : "Delete observations"}
          </button>
          {detail && detail.deletion.observationEntries === 0 && detail.counts.total > 0 ? (
            <span className="summary-detail-hint">Only observation rows can be deleted from this screen.</span>
          ) : null}
        </div>
      </div>

      {loading ? <p className="empty">Loading detail...</p> : null}
      {error ? <p className="empty">{error}</p> : null}

      {detail ? (
        <>
          <div className="summary-totals summary-detail-stats">
            <Stat label="Entries" value={detail.counts.total} />
            <Stat label="Observations" value={detail.counts.observations} />
            <Stat label="Samples" value={detail.counts.samples} />
            <Stat label="Labs" value={detail.counts.labMarkers} />
            <div className="stat-card">
              <span>Latest</span>
              <strong>{detail.measurement.lastMeasuredAt ? formatShortTimestamp(detail.measurement.lastMeasuredAt) : "—"}</strong>
            </div>
          </div>

          {detail.counts.total === 0 ? (
            <p className="empty">No entries are currently stored for this measurement type.</p>
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
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Kind</th>
                        <th>Value</th>
                        <th>Unit</th>
                        <th>Source / note</th>
                        <th>Action</th>
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
              </div>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

function DetailTrendChart({ detail }: { detail: HealthDataDetail }) {
  const points = detail.chartPoints;
  if (points.length === 0) {
    return <p className="empty">No numeric points are available for charting.</p>;
  }
  const timestamps = points.map((point) => new Date(point.timestamp).getTime());
  const values = points.map((point) => point.value);
  const xMin = Math.min(...timestamps);
  const xMax = Math.max(...timestamps);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const flatPadding = rawMin === rawMax ? Math.max(Math.abs(rawMin) * flatChartPaddingRatio, minimumFlatChartPadding) : 0;
  const yMin = rawMin - flatPadding;
  const yMax = rawMax + flatPadding;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const unitLabel = [...new Set(points.map((point) => point.unit).filter(Boolean))].join(", ");
  const path = points
    .map((point, index) => {
      const time = new Date(point.timestamp).getTime();
      const x = 24 + ((time - xMin) / xRange) * 272;
      const y = 108 - ((point.value - yMin) / yRange) * 84;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const axisTimes = [xMin, xMin + xRange / 2, xMax];

  return (
    <div className="summary-detail-chart">
      <svg viewBox="0 0 320 150" role="img" aria-label={`${detail.measurement.displayName} trend`} className="summary-detail-chart-svg">
        <line x1="24" y1="24" x2="24" y2="108" className="summary-detail-axis" />
        <line x1="24" y1="108" x2="296" y2="108" className="summary-detail-axis" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" className="summary-detail-chart-line" />
        {points.map((point) => {
          const time = new Date(point.timestamp).getTime();
          const x = 24 + ((time - xMin) / xRange) * 272;
          const y = 108 - ((point.value - yMin) / yRange) * 84;
          return (
            <circle key={`${point.kind}-${point.timestamp}-${point.value}`} cx={x} cy={y} r="3.5" className="summary-detail-chart-dot">
              <title>{`${detailKindLabel(point.kind)} • ${formatTimestamp(point.timestamp)} • ${formatDetailValue(point.value)} ${point.unit}`}</title>
            </circle>
          );
        })}
        <text x="12" y="28" className="summary-detail-y-label">{formatDetailValue(yMax)}</text>
        <text x="12" y="112" className="summary-detail-y-label">{formatDetailValue(yMin)}</text>
      </svg>
      <div className="summary-detail-chart-meta">
        <span>{unitLabel || "Value"}</span>
        <div className="summary-detail-chart-labels">
          {axisTimes.map((time, index) => (
            <span key={`${time}-${index}`}>{formatChartTimestamp(time, xRange)}</span>
          ))}
        </div>
      </div>
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
                        <button className="summary-row summary-row-button" role="row" key={row.code} type="button" onClick={() => onSelectRow(row.code)}>
                          <span role="cell">{row.displayName}</span>
                          <span role="cell">{row.counts.total}</span>
                          <span role="cell">{row.lastMeasuredAt ? formatTimestamp(row.lastMeasuredAt) : "—"}</span>
                        </button>
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
  if (pathname === "/summary" || pathname.startsWith("/summary/")) {
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

function summaryDetailCodeFromPathname(pathname: string): string | undefined {
  if (!pathname.startsWith("/summary/")) {
    return undefined;
  }
  const raw = pathname.slice("/summary/".length);
  if (!raw) {
    return undefined;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function importModeFromPathname(pathname: string): ImportMode {
  if (pathname === "/import/fitness-tracker") {
    return "fitness";
  }
  return "labs";
}

function importModePath(mode: ImportMode): string {
  if (mode === "fitness") {
    return "/import/fitness-tracker";
  }
  return "/import/labs";
}

function summaryPath(measurementCode?: string): string {
  return measurementCode ? `/summary/${encodeURIComponent(measurementCode)}` : "/summary";
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

function formatShortTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatChartTimestamp(timestamp: number, rangeMs: number): string {
  const options: Intl.DateTimeFormatOptions =
    rangeMs <= 24 * 60 * 60 * 1000
      ? { hour: "2-digit", minute: "2-digit" }
      : rangeMs <= 90 * 24 * 60 * 60 * 1000
        ? { month: "short", day: "numeric" }
        : rangeMs <= 365 * 24 * 60 * 60 * 1000
          ? { month: "short", year: "numeric" }
          : { year: "numeric" };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

function detailKindLabel(kind: HealthDataDetailEntry["kind"]): string {
  return {
    observation: "Observation",
    sample: "Sample",
    "lab-marker": "Lab marker"
  }[kind];
}

function renderEntryContext(entry: HealthDataDetailEntry): string {
  return [entry.sourceLabel, entry.importFileName, entry.note].filter(Boolean).join(" • ") || "—";
}

function formatDetailValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, "");
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

function toEditableBodyCompRow(row: BodyCompositionDraftRow): BodyCompositionEditableRow {
  return {
    ...row,
    value: String(row.value)
  };
}

function toBodyCompositionDraftRow(row: BodyCompositionEditableRow): BodyCompositionDraftRow {
  const value = Number.parseFloat(row.value);
  if (!Number.isFinite(value)) {
    throw new Error(`Enter a numeric value for ${row.displayName || row.label}.`);
  }
  if (!row.measurementCode.trim()) {
    throw new Error(`Measurement code is required for ${row.displayName || row.label}.`);
  }
  if (!row.unit.trim()) {
    throw new Error(`Unit is required for ${row.displayName || row.label}.`);
  }
  return {
    ...row,
    measurementCode: row.measurementCode.trim(),
    displayName: row.displayName.trim() || row.label.trim(),
    value,
    unit: row.unit.trim()
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read selected file."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function isSupportedBodyCompMimeType(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function findKnownCatalogMarker(input: string): (typeof MANUAL_LAB_MARKER_CATALOG)[number] | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return MANUAL_LAB_MARKER_CATALOG.find((entry) => entry.marker.toLowerCase() === normalized);
}

function createEmptyRow(marker = "", value = "", unit = ""): ManualMarkerRow {
  return {
    id: globalThis.crypto.randomUUID(),
    marker,
    value,
    unit
  };
}
