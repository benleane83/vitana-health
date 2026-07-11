import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyticsSummary,
  BodyCompositionDraft,
  BodyCompositionDraftRow,
  CloudAiConsent,
  HealthDataDetail,
  HealthDataDetailEntry,
  HealthDataSummary,
  HealthStoreData,
  ManualObservationPayload,
  MeasurementType,
  Profile,
  ProfileListEntry
} from "@local-fitness-advisor/shared";
import { MANUAL_LAB_MARKER_CATALOG, safetyNotice } from "@local-fitness-advisor/shared";
import { api } from "./api.js";
import type { AiQueryResult, LlmConfig, PairedDevice, PendingPairing } from "./api.js";
import type { AppRoute, BodyCompositionEditableRow, ImportMode, ManualMarkerRow, ScanKind } from "./types.js";
import { todayIsoDate, numberOrUndefined, readFileAsBase64, isSupportedBodyCompMimeType } from "./utils.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ProfileEditDialog, ProfileManagerDialog } from "./components/ProfileDialogs.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { ImportPage } from "./pages/ImportPage.js";
import { SummaryPage, ObservationTypeDetailPage } from "./pages/SummaryPage.js";
import { QueryPage } from "./pages/QueryPage.js";
import { ExportPage } from "./pages/ExportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

export function App() {
  const [store, setStore] = useState<HealthStoreData>();
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [route, setRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [importMode, setImportMode] = useState<ImportMode>(() => importModeFromPathname(window.location.pathname));
  const [summaryDetailCode, setSummaryDetailCode] = useState<string | undefined>(
    () => summaryDetailCodeFromPathname(window.location.pathname)
  );
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
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [summarySort, setSummarySort] = useState<"name" | "count" | "recency">("recency");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [scanKind, setScanKind] = useState<ScanKind>("body-composition");
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
  const [llmConfig, setLlmConfig] = useState<LlmConfig>();
  const [cloudConsentBusy, setCloudConsentBusy] = useState(false);

  const [pendingPairings, setPendingPairings] = useState<PendingPairing[]>([]);

  // Accessible confirmation dialog state (replaces window.confirm)
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const bodyCompInputRef = useRef<HTMLInputElement>(null);

  const labMeasurementTypes = useMemo(
    () =>
      (store?.measurementTypes ?? []).filter(
        (type) => type.kind === "panel-component" || type.category === "lab" || type.category === "metabolic"
      ),
    [store?.measurementTypes]
  );

  const profile = store?.profile;
  const activeProfile = profiles.find((entry) => entry.id === activeProfileId) ?? profile;
  const latestInsight = store?.insights[0];
  const density = useMemo(() => {
    const counts = analytics?.counts;
    if (!counts) return 0;
    return Math.min(100, counts.observations + counts.samples / 10 + counts.activities * 4);
  }, [analytics]);

  // Initial data load
  useEffect(() => {
    let cancelled = false;
    void refresh().catch((error: unknown) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "Unable to load local health data.");
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Popstate (browser back/forward)
  useEffect(() => {
    const onPopState = () => {
      setRoute(routeFromPathname(window.location.pathname));
      setImportMode(importModeFromPathname(window.location.pathname));
      setSummaryDetailCode(summaryDetailCodeFromPathname(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Summary route data
  useEffect(() => {
    if (route !== "summary") return;
    let cancelled = false;
    setSummaryBusy(true);
    setSummaryError(undefined);
    void api
      .summary()
      .then((nextSummary) => {
        if (cancelled) return;
        applySummary(nextSummary);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSummaryError(error instanceof Error ? error.message : "Unable to load summary.");
      })
      .finally(() => {
        if (!cancelled) setSummaryBusy(false);
      });
    return () => { cancelled = true; };
  }, [route]);

  // Summary detail data
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
        if (!cancelled) setSummaryDetail(nextDetail);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSummaryDetailError(error instanceof Error ? error.message : "Unable to load detail.");
      })
      .finally(() => {
        if (!cancelled) setSummaryDetailBusy(false);
      });
    return () => { cancelled = true; };
  }, [route, summaryDetailCode]);

  // Pairing poll when on the fitness tab
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
      if (!cancelled) timeoutId = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [route, importMode]);

  async function refresh() {
    const [nextStore, nextAnalytics, nextProfiles, nextLlmConfig] = await Promise.all([
      api.store(),
      api.analytics(),
      api.profiles.list(),
      api.llm.config().catch(() => undefined)
    ]);
    setStore(nextStore);
    setAnalytics(nextAnalytics);
    setProfiles(nextProfiles.profiles);
    setActiveProfileId(nextProfiles.activeProfileId);
    setLlmConfig(nextLlmConfig);
  }

  async function refreshForCurrentRoute() {
    await refresh();
    if (route === "summary") {
      const nextSummary = await api.summary();
      applySummary(nextSummary);
      if (summaryDetailCode) {
        setSummaryDetail(await api.healthDataDetail(summaryDetailCode));
      }
    }
  }

  function applySummary(nextSummary: HealthDataSummary) {
    setSummary(nextSummary);
    setExpandedCategories(new Set(nextSummary.categories.map((c) => c.key)));
  }

  function navigate(nextRoute: AppRoute, nextImportMode: ImportMode = importMode) {
    const routePaths: Record<AppRoute, string> = {
      dashboard: "/",
      import: importModePath(nextImportMode),
      summary: summaryPath(),
      export: "/export",
      query: "/query",
      settings: "/settings"
    };
    const nextPath = routePaths[nextRoute] ?? "/";
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    if (nextRoute === "import") setImportMode(nextImportMode);
    if (nextRoute === "summary") setSummaryDetailCode(undefined);
    setRoute(nextRoute);
  }

  function navigateSummaryDetail(measurementCode: string) {
    const nextPath = summaryPath(measurementCode);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setRoute("summary");
    setSummaryDetailCode(measurementCode);
  }

  async function downloadPdfReport() {
    setExportBusy(true);
    setExportError(undefined);
    try {
      const { blob, filename } = await api.exportPdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Unable to create the PDF report.");
    } finally {
      setExportBusy(false);
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

  function confirm(
    title: string,
    description: string,
    confirmLabel: string,
    destructive: boolean
  ): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmState({
        title,
        description,
        confirmLabel,
        destructive,
        onConfirm: () => {
          setConfirmState(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirmState(null);
          resolve(false);
        }
      });
    });
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
    const ok = await confirm(
      "Delete profile",
      `Delete profile "${target?.displayName ?? profileId}"? This removes its local encrypted store.`,
      "Delete",
      true
    );
    if (!ok) return;
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
    await run("Manual observations imported.", async () => {
      await api.importManualObservations(payload);
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
    await run("Observation CSV imported.", async () => {
      const content = await uploadFile.text();
      await api.importObservationCsv(uploadFile.name, content);
      await refresh();
      setUploadFile(undefined);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
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
      const draft = await (scanKind === "blood-test" ? api.previewBloodTestReport : api.previewBodyCompositionReport)({
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
      await (scanKind === "blood-test" ? api.commitBloodTestReport : api.commitBodyCompositionReport)({
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
      if (bodyCompInputRef.current) bodyCompInputRef.current.value = "";
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
    const cloudEnabled = store?.profile.cloudAiConsent?.enabled === true && store?.profile.cloudAiConsent?.providerScopeAccepted === true;
    if (llmConfig?.provider === "openai" && !cloudEnabled) {
      setAiError("Cloud model prompts are disabled. Enable cloud prompts in the consent panel to run this query.");
      return;
    }
    setAiBusy(true);
    setAiError(undefined);
    setAiResult(undefined);
    try {
      const result = await api.query.ai(q, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setAiResult(result);
    } catch (error) {
      const normalized = normalizeApiError(error instanceof Error ? error.message : "Query failed.");
      if (normalized.code === "CLOUD_CONSENT_REQUIRED") {
        setAiError("Cloud consent is required before off-device prompt processing. Use the consent panel above to enable cloud prompts.");
      } else {
        setAiError(normalized.message || "Query failed.");
      }
    } finally {
      setAiBusy(false);
    }
  }

  async function setCloudConsent(enabled: boolean) {
    setCloudConsentBusy(true);
    setAiError(undefined);
    try {
      const payload: CloudAiConsent = {
        enabled,
        providerScopeAccepted: enabled,
        consentVersion: "v1"
      };
      await api.cloudAiConsent.set(payload);
      await refresh();
      setMessage(enabled ? "Cloud prompt consent enabled." : "Cloud prompt consent disabled.");
    } catch (error) {
      setAiError(error instanceof Error ? normalizeApiError(error.message).message : "Could not update cloud consent.");
    } finally {
      setCloudConsentBusy(false);
    }
  }

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

  async function deleteObservationEntry(entry: HealthDataDetailEntry) {
    if (!entry.canDelete) return;
    const ok = await confirm(
      "Delete observation",
      `Delete ${entry.displayName} observation recorded on ${entry.timestamp}?`,
      "Delete",
      true
    );
    if (!ok) return;
    setSummaryDetailActionBusy(true);
    setMessage(undefined);
    try {
      await api.deleteObservation(entry.id);
      await refresh();
      const [nextSummary, nextDetail] = await Promise.all([
        api.summary(),
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
    if (!summaryDetailCode || !summaryDetail) return;
    const observationCount = summaryDetail.deletion.observationEntries;
    const ok = await confirm(
      "Delete observations",
      `Delete ${observationCount} ${summaryDetail.measurement.displayName} observation record(s)?`,
      `Delete ${observationCount}`,
      true
    );
    if (!ok) return;
    setSummaryDetailActionBusy(true);
    setMessage(undefined);
    try {
      await api.deleteObservationsByType(summaryDetailCode);
      await refresh();
      const [nextSummary, nextDetail] = await Promise.all([
        api.summary(),
        api.healthDataDetail(summaryDetailCode)
      ]);
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
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.marker !== undefined && patch.unit === undefined && !next.unit.trim()) {
          const resolvedUnit =
            findKnownCatalogMarker(patch.marker)?.unit ??
            findKnownMeasurement(patch.marker, labMeasurementTypes)?.canonicalUnit;
          if (resolvedUnit) next.unit = resolvedUnit;
        }
        return next;
      })
    );
  }

  function updateBodyCompRow(id: string, patch: Partial<BodyCompositionEditableRow>) {
    setBodyCompRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function resetManualForm() {
    setManualCollectedAt(todayIsoDate());
    setManualPanelName("Lipid panel");
    setManualLabName("");
    setManualRows(createStarterRows());
  }

  // ─── Navigation tabs ─────────────────────────────────────────────────────────

  const navTabIds: Record<AppRoute, string> = {
    dashboard: "nav-tab-dashboard",
    import: "nav-tab-import",
    summary: "nav-tab-summary",
    export: "nav-tab-export",
    query: "nav-tab-query",
    settings: "nav-tab-settings"
  };

  return (
    <main className="shell">
      {/* Navigation tablist */}
      <nav className="route-nav" aria-label="Page navigation">
        <div role="tablist" aria-label="App sections">
          {(["dashboard", "import", "summary", "export", "query", "settings"] as AppRoute[]).map((r) => {
            const labels: Record<AppRoute, string> = {
              dashboard: "Dashboard",
              import: "Import",
              summary: "Health Data Summary",
              export: "Export",
              query: "AI Query",
              settings: "⚙ Settings"
            };
            const panelId = `route-panel-${r}`;
            return (
              <button
                key={r}
                id={navTabIds[r]}
                role="tab"
                aria-selected={route === r}
                aria-controls={panelId}
                className={route === r ? "active" : ""}
                tabIndex={route === r ? 0 : -1}
                onClick={() => navigate(r)}
                aria-label={r === "settings" ? "Settings" : undefined}
              >
                {labels[r]}
              </button>
            );
          })}
        </div>
        {activeProfile ? (
          <span className="active-profile-pill">Profile: {activeProfile.displayName}</span>
        ) : null}
        <button type="button" className="manage-profiles-button" onClick={() => setProfileManagerOpen(true)}>
          Manage profiles
        </button>
      </nav>

      {/* Global status/notice — live region */}
      {message ? (
        <div className="notice" role="status" aria-live="polite" aria-atomic="true">
          {message}
        </div>
      ) : null}

      {/* Route panels */}
      <div
        id="route-panel-dashboard"
        role="tabpanel"
        aria-labelledby={navTabIds.dashboard}
        hidden={route !== "dashboard"}
      >
        {route === "dashboard" ? (
          <DashboardPage
            store={store}
            analytics={analytics}
            density={density}
            busy={busy}
            latestInsight={latestInsight}
            profile={profile}
            activeProfile={activeProfile}
            onEditProfile={() => setProfileEditorOpen(true)}
            onManageProfiles={() => setProfileManagerOpen(true)}
            onNavigateSummary={() => navigate("summary")}
            onGenerateInsight={() => { void generateInsight(); }}
          />
        ) : null}
      </div>

      <div id="route-panel-settings" role="tabpanel" aria-labelledby={navTabIds.settings} hidden={route !== "settings"}>
        {route === "settings" ? <SettingsPage /> : null}
      </div>

      <div
        id="route-panel-import"
        role="tabpanel"
        aria-labelledby={navTabIds.import}
        hidden={route !== "import"}
      >
        {route === "import" ? (
          <ImportPage
            busy={busy}
            mode={importMode}
            onModeChange={(mode) => navigate("import", mode)}
            scanKind={scanKind}
            onScanKindChange={setScanKind}
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
        ) : null}
      </div>

      <div
        id="route-panel-summary"
        role="tabpanel"
        aria-labelledby={navTabIds.summary}
        hidden={route !== "summary"}
      >
        {route === "summary" ? (
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
        ) : null}
      </div>

      <div
        id="route-panel-export"
        role="tabpanel"
        aria-labelledby={navTabIds.export}
        hidden={route !== "export"}
      >
        {route === "export" ? (
          <ExportPage
            busy={exportBusy}
            error={exportError}
            hasHealthData={Boolean(
              store && (store.observations.length || store.timeSeriesSamples.length || store.activitySessions.length)
            )}
            onDownload={() => { void downloadPdfReport(); }}
          />
        ) : null}
      </div>

      <div
        id="route-panel-query"
        role="tabpanel"
        aria-labelledby={navTabIds.query}
        hidden={route !== "query"}
      >
        {route === "query" ? (
          <QueryPage
            question={aiQuestion}
            onQuestionChange={setAiQuestion}
            onSubmit={submitAiQuery}
            busy={aiBusy}
            cloudProvider={llmConfig?.provider}
            cloudConsent={store?.profile.cloudAiConsent}
            cloudConsentBusy={cloudConsentBusy}
            onCloudConsentChange={(enabled) => {
              void setCloudConsent(enabled);
            }}
            result={aiResult}
            error={aiError}
          />
        ) : null}
      </div>

      {/* Profile dialogs */}
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
            if (activeProfileId) void deleteProfile(activeProfileId);
          }}
        />
      ) : null}

      {/* Accessible confirmation dialog — replaces window.confirm */}
      {confirmState ? (
        <ConfirmDialog
          open={true}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          destructive={confirmState.destructive}
          onConfirm={confirmState.onConfirm}
          onCancel={confirmState.onCancel}
        />
      ) : null}
    </main>
  );
}

function normalizeApiError(raw: string): { code?: string; message: string } {
  try {
    const parsed = JSON.parse(raw) as { code?: string; error?: string };
    return {
      code: parsed.code,
      message: parsed.error ?? raw
    };
  } catch {
    return { message: raw };
  }
}

// ─── Routing helpers ──────────────────────────────────────────────────────────

function routeFromPathname(pathname: string): AppRoute {
  if (pathname === "/summary" || pathname.startsWith("/summary/")) return "summary";
  if (pathname === "/import" || pathname.startsWith("/import/") || pathname === "/labs") return "import";
  if (pathname === "/query") return "query";
  if (pathname === "/export") return "export";
  if (pathname === "/settings") return "settings";
  return "dashboard";
}

function summaryDetailCodeFromPathname(pathname: string): string | undefined {
  if (!pathname.startsWith("/summary/")) return undefined;
  const raw = pathname.slice("/summary/".length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function importModeFromPathname(pathname: string): ImportMode {
  if (pathname === "/import/upload") return "upload";
  if (pathname === "/import/scan") return "scan";
  if (pathname === "/import/fitness-tracker") return "fitness";
  return "manual";
}

function importModePath(mode: ImportMode): string {
  return `/import/${mode === "fitness" ? "fitness-tracker" : mode}`;
}

function summaryPath(measurementCode?: string): string {
  return measurementCode ? `/summary/${encodeURIComponent(measurementCode)}` : "/summary";
}

// ─── Manual lab helpers ───────────────────────────────────────────────────────

function findKnownCatalogMarker(input: string): (typeof MANUAL_LAB_MARKER_CATALOG)[number] | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;
  return MANUAL_LAB_MARKER_CATALOG.find((entry) => entry.marker.toLowerCase() === normalized);
}

function findKnownMeasurement(input: string, knownMeasurements: MeasurementType[]): MeasurementType | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;
  return knownMeasurements.find((m) => {
    if (m.code.toLowerCase() === normalized || m.display.toLowerCase() === normalized) return true;
    return m.aliases.some((alias) => alias.trim().toLowerCase() === normalized);
  });
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
}): ManualObservationPayload {
  if (!collectedAt) throw new Error("Collection date is required.");
  if (!panelName.trim()) throw new Error("Panel name is required.");
  const observations = rows
    .map((row) => {
      const markerName = row.marker.trim();
      const hasRowData = markerName || row.value.trim() || row.unit.trim();
      if (!hasRowData) return undefined;
      const value = Number.parseFloat(row.value);
      if (!Number.isFinite(value)) throw new Error(`Enter a numeric value for ${markerName || "all rows"}.`);
      const known = findKnownMeasurement(markerName, knownMeasurements);
      return {
        measurementName: markerName || known?.display,
        measurementCode: known?.code,
        value,
        unit: row.unit.trim() || known?.canonicalUnit
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (observations.length === 0) throw new Error("Enter at least one observation row before import.");
  return { observedAt: collectedAt, label: panelName.trim(), sourceName: labName.trim() || undefined, observations };
}

function toEditableBodyCompRow(row: BodyCompositionDraftRow): BodyCompositionEditableRow {
  return { ...row, value: String(row.value) };
}

function toBodyCompositionDraftRow(row: BodyCompositionEditableRow): BodyCompositionDraftRow {
  const value = Number.parseFloat(row.value);
  if (!Number.isFinite(value)) throw new Error(`Enter a numeric value for ${row.displayName || row.label}.`);
  if (!row.measurementCode.trim()) throw new Error(`Measurement code is required for ${row.displayName || row.label}.`);
  if (!row.unit.trim()) throw new Error(`Unit is required for ${row.displayName || row.label}.`);
  return {
    ...row,
    measurementCode: row.measurementCode.trim(),
    displayName: row.displayName.trim() || row.label.trim(),
    value,
    unit: row.unit.trim()
  };
}

function createStarterRows(): ManualMarkerRow[] {
  return [
    createEmptyRow("HDL cholesterol", "", "mg/dL"),
    createEmptyRow("LDL cholesterol", "", "mg/dL"),
    createEmptyRow("Triglycerides", "", "mg/dL"),
    createEmptyRow("Glucose", "", "mg/dL")
  ];
}

function createEmptyRow(marker = "", value = "", unit = ""): ManualMarkerRow {
  return { id: globalThis.crypto.randomUUID(), marker, value, unit };
}
