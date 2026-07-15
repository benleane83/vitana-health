import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppBootstrap,
  AnalyticsSummary,
  BiologicalAgeReport,
  BodyCompositionDraft,
  BodyCompositionDraftRow,
  CloudAiConsent,
  HealthDataDetail,
  HealthDataDetailEntry,
  HealthDataSummary,
  ManualObservationPayload,
  MeasurementType,
  Profile,
  ProfileListEntry,
  UpdateObservationInput
} from "@local-fitness-advisor/shared";
import { defaultMeasurementTypes, getPreferredUnit, safetyNotice } from "@local-fitness-advisor/shared";
import { api } from "./api.js";
import type { AiQueryResult, LlmConfig, PairedDevice, PendingPairing } from "./api.js";
import type { AppRoute, BodyCompositionEditableRow, ImportMode, InsightsTab, ManualMarkerRow, ScanKind } from "./types.js";
import { todayIsoDate, numberOrUndefined, readFileAsBase64, isSupportedBodyCompMimeType } from "./utils.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ManualGroupSaveDialog } from "./components/ManualGroupSaveDialog.js";
import { ProfileEditDialog, ProfileManagerDialog } from "./components/ProfileDialogs.js";
import { ObservationEditDialog } from "./components/ObservationEditDialog.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { ImportPage } from "./pages/ImportPage.js";
import { SummaryPage, ObservationTypeDetailPage } from "./pages/SummaryPage.js";
import { QueryPage } from "./pages/QueryPage.js";
import { ExportPage } from "./pages/ExportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { BiologicalAgePage } from "./pages/BiologicalAgePage.js";

const manualGroupDefaults = [
  { label: "Activity", category: "activity", measurementCode: "steps" },
  { label: "Body", category: "body", measurementCode: "weight" },
  { label: "Lab", category: "lab", measurementCode: "glucose" }
] as const;

export function App() {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [biologicalAge, setBiologicalAge] = useState<BiologicalAgeReport>();
  const [biologicalAgeBusy, setBiologicalAgeBusy] = useState(false);
  const [biologicalAgeError, setBiologicalAgeError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [route, setRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [insightsTab, setInsightsTab] = useState<InsightsTab>(() => insightsTabFromPathname(window.location.pathname));
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
  const [observationBeingEdited, setObservationBeingEdited] = useState<HealthDataDetailEntry>();
  const [summaryDetailLoadMoreBusy, setSummaryDetailLoadMoreBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [summarySort, setSummarySort] = useState<"name" | "count" | "recency">("recency");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [scanKind, setScanKind] = useState<ScanKind>("body-composition");
  const [manualCollectedAt, setManualCollectedAt] = useState(todayIsoDate());
  const [manualObservationGroup, setManualObservationGroup] = useState("Activity");
  const [manualLabName, setManualLabName] = useState("");
  const [manualRows, setManualRows] = useState<ManualMarkerRow[]>(() => [createEmptyRow("Steps", "steps", "", "count")]);
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  // Accessible confirmation dialog state (replaces window.confirm)
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);
  const [manualGroupSaveDialog, setManualGroupSaveDialog] = useState<{ groupName: string } | null>(null);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const bodyCompInputRef = useRef<HTMLInputElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const recordedMeasurementTypes = useMemo(() => {
    const measurementTypes = bootstrap?.measurementTypes?.length
      ? bootstrap.measurementTypes
      : defaultMeasurementTypes;
    return [...measurementTypes].sort((left, right) => left.display.localeCompare(right.display));
  }, [bootstrap?.measurementTypes]);
  const manualGroupTemplates = useMemo(() => {
    const defaultLabels = new Set(manualGroupDefaults.map((group) => normalizeManualGroupLabel(group.label)));
    return (bootstrap?.manualObservationGroupTemplates ?? [])
      .filter((group) => !defaultLabels.has(group.normalizedLabel))
      .map((group) => ({
        ...group,
        measurements: [...group.measurements].sort((left, right) => left.marker.localeCompare(right.marker))
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [bootstrap?.manualObservationGroupTemplates]);
  const observationGroupOptions = useMemo(() => {
    return [...manualGroupDefaults.map((group) => group.label), ...manualGroupTemplates.map((group) => group.label)];
  }, [manualGroupTemplates]);
  const selectedManualGroupDefault = manualGroupDefaults.find((group) => group.label === manualObservationGroup);
  const selectedManualGroupTemplate = manualGroupTemplates.find(
    (group) => group.normalizedLabel === normalizeManualGroupLabel(manualObservationGroup)
  );
  const allowedManualMeasurementTypes = useMemo(() => {
    if (selectedManualGroupDefault) {
      return recordedMeasurementTypes.filter((type) => type.category === selectedManualGroupDefault.category);
    }
    if (selectedManualGroupTemplate) {
      const measurementCodes = new Set(selectedManualGroupTemplate.measurements.map((measurement) => measurement.measurementCode));
      return recordedMeasurementTypes.filter((type) => measurementCodes.has(type.code));
    }
    return recordedMeasurementTypes;
  }, [recordedMeasurementTypes, selectedManualGroupDefault, selectedManualGroupTemplate]);

  const profile = bootstrap?.profile;
  const activeProfile = profiles.find((entry) => entry.id === activeProfileId) ?? profile;
  const latestInsight = bootstrap?.latestInsight;
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
      setInsightsTab(insightsTabFromPathname(window.location.pathname));
      setImportMode(importModeFromPathname(window.location.pathname));
      setSummaryDetailCode(summaryDetailCodeFromPathname(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [profileMenuOpen]);

  // Summary route data
  useEffect(() => {
    if (route !== "track") return;
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

  useEffect(() => {
    if (route !== "insights" || insightsTab !== "biological-age") return;
    let cancelled = false;
    setBiologicalAgeBusy(true);
    setBiologicalAgeError(undefined);
    void api.biologicalAge()
      .then((report) => { if (!cancelled) setBiologicalAge(report); })
      .catch((error: unknown) => {
        if (!cancelled) setBiologicalAgeError(error instanceof Error ? error.message : "Unable to calculate biological age.");
      })
      .finally(() => { if (!cancelled) setBiologicalAgeBusy(false); });
    return () => { cancelled = true; };
  }, [route, insightsTab]);

  // Summary detail data
  useEffect(() => {
    if (route !== "track" || !summaryDetailCode) {
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
    const [nextBootstrap, nextAnalytics, nextProfiles, nextLlmConfig] = await Promise.all([
      api.bootstrap(),
      api.analytics(),
      api.profiles.list(),
      api.llm.config().catch(() => undefined)
    ]);
    setBootstrap(nextBootstrap);
    setAnalytics(nextAnalytics);
    setProfiles(nextProfiles.profiles);
    setActiveProfileId(nextProfiles.activeProfileId);
    setLlmConfig(nextLlmConfig);
  }

  async function refreshForCurrentRoute() {
    await refresh();
    if (route === "track") {
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
      track: trackPath(),
      insights: insightsPath(insightsTab),
      export: "/export",
      settings: "/settings"
    };
    const nextPath = routePaths[nextRoute] ?? "/";
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    if (nextRoute === "import") setImportMode(nextImportMode);
    if (nextRoute === "track") setSummaryDetailCode(undefined);
    setRoute(nextRoute);
  }

  function navigateInsights(nextTab: InsightsTab) {
    const nextPath = insightsPath(nextTab);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setInsightsTab(nextTab);
    setRoute("insights");
  }

  function navigateSummaryDetail(measurementCode: string) {
    const nextPath = trackPath(measurementCode);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setRoute("track");
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

  async function run(success: string, task: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setMessage(undefined);
    try {
      await task();
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected local error.");
      return false;
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
    const units = String(form.get("units") || "metric") as Profile["units"];
    const height = numberOrUndefined(form.get("height"));
    await run("Profile saved locally.", async () => {
      await api.saveProfile({
        displayName: String(form.get("displayName") || "Local user"),
        subjectKind: String(form.get("subjectKind") || "adult") as NonNullable<Profile["subjectKind"]>,
        birthDate: String(form.get("birthDate") || "") || undefined,
        sex: String(form.get("sex") || "not-specified") as Profile["sex"],
        heightCm: height === undefined ? undefined : units === "imperial" ? height * 2.54 : height,
        bloodType: String(form.get("bloodType") || "unknown") as Profile["bloodType"],
        goalSummary: String(form.get("goalSummary") || ""),
        pet: String(form.get("subjectKind")) === "pet" ? {
          species: String(form.get("petSpecies") || ""),
          breed: String(form.get("petBreed") || "") || undefined,
          microchipId: String(form.get("petMicrochipId") || "") || undefined
        } : undefined,
        units
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

  async function editProfile(profileId: string) {
    if (profileId !== activeProfileId) {
      const switched = await run("Profile switched.", async () => {
        await api.profiles.setActive(profileId);
        await refreshForCurrentRoute();
      });
      if (!switched) return;
    }
    setProfileManagerOpen(false);
    setProfileEditorOpen(true);
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
    const isDefaultGroup = manualGroupDefaults.some((group) => group.label === manualObservationGroup);
    if (isDefaultGroup && manualRows.length > 1) {
      setManualGroupSaveDialog({ groupName: "" });
      return;
    }
    await importManualObservations(manualObservationGroup);
  }

  async function importManualObservations(observationGroup: string) {
    const payload = toManualPayload({
      collectedAt: manualCollectedAt,
      observationGroup,
      labName: manualLabName,
      rows: manualRows,
      knownMeasurements: recordedMeasurementTypes
    });
    await run("Manual observations imported.", async () => {
      const imported = await api.importManualObservations(payload);
      const nextAnalytics = await api.analytics();
      setBootstrap(await api.bootstrap());
      setAnalytics(nextAnalytics);
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
    const cloudEnabled = bootstrap?.profile.cloudAiConsent?.enabled === true && bootstrap?.profile.cloudAiConsent?.providerScopeAccepted === true;
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

  async function approvePairing(id: string, profileId: string) {
    try {
      await api.pairing.approve(id, profileId);
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
      const deleted = await api.deleteObservation(entry.id);
      const [nextAnalytics, nextSummary, nextDetail] = await Promise.all([
        api.analytics(),
        api.summary(),
        summaryDetailCode ? api.healthDataDetail(summaryDetailCode) : Promise.resolve(undefined)
      ]);
      setBootstrap(await api.bootstrap());
      setAnalytics(nextAnalytics);
      applySummary(nextSummary);
      setSummaryDetail(nextDetail);
      setMessage("Observation deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setSummaryDetailActionBusy(false);
    }
  }

  async function updateObservationEntry(input: UpdateObservationInput) {
    if (!observationBeingEdited) return;
    setSummaryDetailActionBusy(true);
    setMessage(undefined);
    try {
      await api.updateObservation(observationBeingEdited.id, input);
      const [nextBootstrap, nextAnalytics, nextSummary, nextDetail] = await Promise.all([
        api.bootstrap(),
        api.analytics(),
        api.summary(),
        api.healthDataDetail(input.measurementCode)
      ]);
      setBootstrap(nextBootstrap);
      setAnalytics(nextAnalytics);
      applySummary(nextSummary);
      setSummaryDetail(nextDetail);
      setObservationBeingEdited(undefined);
      if (summaryDetailCode !== input.measurementCode) navigateSummaryDetail(input.measurementCode);
      setMessage("Observation updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setSummaryDetailActionBusy(false);
    }
  }

  async function loadMoreSummaryDetail() {
    if (!summaryDetailCode || !summaryDetail?.pagination.hasMore) return;
    setSummaryDetailLoadMoreBusy(true);
    setSummaryDetailError(undefined);
    try {
      const nextPage = await api.healthDataDetail(summaryDetailCode, {
        limit: summaryDetail.pagination.limit,
        offset: summaryDetail.pagination.loaded
      });
      setSummaryDetail((current) => {
        if (!current) return nextPage;
        return {
          ...nextPage,
          entries: [...current.entries, ...nextPage.entries],
          chartPoints: [...current.chartPoints, ...nextPage.chartPoints].sort(
            (left, right) => left.timestamp.localeCompare(right.timestamp) || left.kind.localeCompare(right.kind)
          )
        };
      });
    } catch (error) {
      setSummaryDetailError(error instanceof Error ? error.message : "Unable to load more entries.");
    } finally {
      setSummaryDetailLoadMoreBusy(false);
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
      const deleted = await api.deleteObservationsByType(summaryDetailCode);
      const [nextAnalytics, nextSummary, nextDetail] = await Promise.all([
        api.analytics(),
        api.summary(),
        api.healthDataDetail(summaryDetailCode)
      ]);
      setBootstrap(await api.bootstrap());
      setAnalytics(nextAnalytics);
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

  function selectManualObservationGroup(label: string) {
    setManualObservationGroup(label);
    const defaultGroup = manualGroupDefaults.find((group) => group.label === label);
    if (defaultGroup) {
      const measurement = recordedMeasurementTypes.find((type) => type.code === defaultGroup.measurementCode);
      setManualRows([createEmptyRow(
        measurement?.display ?? defaultGroup.measurementCode,
        defaultGroup.measurementCode,
        "",
        measurement ? getPreferredUnit(measurement, profile?.units ?? "metric") : ""
      )]);
      return;
    }

    const template = manualGroupTemplates.find(
      (group) => group.normalizedLabel === normalizeManualGroupLabel(label)
    );
    setManualRows(template?.measurements.length
      ? template.measurements.map((measurement) => createEmptyRow(measurement.marker, measurement.measurementCode, "", measurement.unit))
      : [createEmptyRow()]);
  }

  function updateCustomManualObservationGroup(label: string) {
    setManualObservationGroup(label);
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
          const measurement = findKnownMeasurement(patch.marker, recordedMeasurementTypes);
          const resolvedUnit = measurement && getPreferredUnit(measurement, profile?.units ?? "metric");
          if (resolvedUnit) next.unit = resolvedUnit;
        }
        return next;
      })
    );
  }

  function updateBodyCompRow(id: string, patch: Partial<BodyCompositionEditableRow>) {
    setBodyCompRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addBodyCompRow() {
    setBodyCompRows((current) => [...current, {
      id: globalThis.crypto.randomUUID(),
      label: "",
      measurementCode: "",
      displayName: "",
      value: "",
      unit: "",
      confidence: "low",
      included: true,
      generatedCode: true
    }]);
  }

  function resetManualForm() {
    setManualCollectedAt(todayIsoDate());
    setManualObservationGroup("Activity");
    setManualLabName("");
    const steps = recordedMeasurementTypes.find((type) => type.code === "steps");
    setManualRows([createEmptyRow(steps?.display ?? "Steps", "steps", "", steps ? getPreferredUnit(steps, profile?.units ?? "metric") : "count")]);
  }

  // ─── Navigation tabs ─────────────────────────────────────────────────────────

  const navTabIds: Record<AppRoute, string> = {
    dashboard: "nav-tab-dashboard",
    import: "nav-tab-import",
    track: "nav-tab-track",
    insights: "nav-tab-insights",
    export: "nav-tab-export",
    settings: "nav-tab-settings"
  };

  return (
    <main className="shell">
      {/* Navigation tablist */}
      <nav className="route-nav" aria-label="Page navigation">
        <div className="route-nav-main" role="tablist" aria-label="App sections">
          {(["dashboard", "import", "track", "insights", "export"] as AppRoute[]).map((r) => {
            const labels: Record<AppRoute, string> = {
              dashboard: "Dashboard",
              import: "Import",
              track: "Track",
              insights: "Insights",
              export: "Export",
              settings: "Settings"
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
                onClick={() => {
                  setProfileMenuOpen(false);
                  navigate(r);
                }}
              >
                {labels[r]}
              </button>
            );
          })}
        </div>
        <div className="route-nav-actions">
          <button
            type="button"
            id={navTabIds.settings}
            className={route === "settings" ? "active settings-button" : "settings-button"}
            aria-label="Settings"
            aria-pressed={route === "settings"}
            onClick={() => {
              setProfileMenuOpen(false);
              navigate("settings");
            }}
          >
            <span aria-hidden="true">⚙</span>
          </button>
          <div className="profile-menu" ref={profileMenuRef}>
          <button
            type="button"
            className="active-profile-pill profile-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
          >
            <span className="profile-menu-label">{activeProfile?.displayName ?? "Profile"}</span>
            <span className="profile-menu-chevron" aria-hidden="true">▾</span>
          </button>
          {profileMenuOpen ? (
            <div className="profile-menu-popover" role="menu" aria-label="Profile actions">
              <p className="profile-menu-title">Switch profile</p>
              {profiles.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={entry.id === activeProfileId}
                  className={`profile-menu-item ${entry.id === activeProfileId ? "active" : ""}`}
                  onClick={() => {
                    setProfileMenuOpen(false);
                    if (entry.id !== activeProfileId) {
                      void switchProfile(entry.id);
                    }
                  }}
                >
                  {entry.displayName}
                </button>
              ))}
              <div className="profile-menu-divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="profile-menu-item"
                onClick={() => {
                  setProfileMenuOpen(false);
                  setProfileManagerOpen(true);
                }}
              >
                Manage profiles
              </button>
            </div>
          ) : null}
          </div>
        </div>
      </nav>

      {/* Global status/notice — live region */}
      {message ? (
        <div className="notice">
          <span className="notice-message" role="status" aria-live="polite" aria-atomic="true">
            {message}
          </span>
          <button
            className="notice-dismiss"
            type="button"
            aria-label="Dismiss notification"
            title="Dismiss notification"
            onClick={() => setMessage(undefined)}
          >
            <span aria-hidden="true">×</span>
          </button>
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
              importCount={bootstrap?.counts.imports ?? 0}
            analytics={analytics}
            density={density}
            busy={busy}
            latestInsight={latestInsight}
            profile={profile}
            activeProfile={activeProfile}
            onEditProfile={() => setProfileEditorOpen(true)}
            onManageProfiles={() => setProfileManagerOpen(true)}
            onNavigateSummary={() => navigate("track")}
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
            observationGroup={manualObservationGroup}
            observationGroupOptions={observationGroupOptions}
            manualMeasurementTypes={allowedManualMeasurementTypes}
            labName={manualLabName}
            collectedAt={manualCollectedAt}
            rows={manualRows}
            onObservationGroupChange={selectManualObservationGroup}
            onCustomObservationGroupChange={updateCustomManualObservationGroup}
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
            onBodyCompAddRow={addBodyCompRow}
            measurementTypes={recordedMeasurementTypes}
            onPreviewBodyComp={previewBodyCompositionReport}
            onCommitBodyComp={commitBodyCompositionReport}
            bodyCompInputRef={bodyCompInputRef}
            pendingPairings={pendingPairings}
            profiles={profiles}
            activeProfileId={profile?.id}
            onApprovePairing={approvePairing}
            onDenyPairing={denyPairing}
            units={profile?.units ?? "metric"}
          />
        ) : null}
      </div>

      <div
        id="route-panel-track"
        role="tabpanel"
        aria-labelledby={navTabIds.track}
        hidden={route !== "track"}
      >
        {route === "track" ? (
          summaryDetailCode ? (
            <ObservationTypeDetailPage
              detail={summaryDetail}
              loading={summaryDetailBusy}
              error={summaryDetailError}
              actionBusy={summaryDetailActionBusy}
              loadMoreBusy={summaryDetailLoadMoreBusy}
              onBack={() => navigate("track")}
              onEditObservation={setObservationBeingEdited}
              onDeleteObservation={deleteObservationEntry}
              onDeleteAll={deleteObservationsByType}
              onLoadMore={loadMoreSummaryDetail}
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

      {observationBeingEdited ? (
        <ObservationEditDialog
          entry={observationBeingEdited}
          measurementTypes={recordedMeasurementTypes}
          busy={summaryDetailActionBusy}
          onClose={() => setObservationBeingEdited(undefined)}
          onSave={updateObservationEntry}
        />
      ) : null}

      <div id="route-panel-insights" role="tabpanel" aria-labelledby={navTabIds.insights} hidden={route !== "insights"}>
        {route === "insights" ? (
          <section className="insights-shell">
            <div className="insights-header">
              <div>
                <p className="eyebrow">Health analysis tools</p>
                <h1>Insights</h1>
              </div>
              <div className="insights-tabs" role="tablist" aria-label="Insight tools">
                <button type="button" role="tab" aria-selected={insightsTab === "biological-age"} className={insightsTab === "biological-age" ? "active" : ""} onClick={() => navigateInsights("biological-age")}>Biological Age</button>
                <button type="button" role="tab" aria-selected={insightsTab === "ai-query"} className={insightsTab === "ai-query" ? "active" : ""} onClick={() => navigateInsights("ai-query")}>AI Query</button>
              </div>
            </div>
            {insightsTab === "biological-age" ? (
              <BiologicalAgePage report={biologicalAge} loading={biologicalAgeBusy} error={biologicalAgeError} />
            ) : (
              <QueryPage question={aiQuestion} onQuestionChange={setAiQuestion} onSubmit={submitAiQuery} busy={aiBusy} cloudProvider={llmConfig?.provider} cloudConsent={bootstrap?.profile.cloudAiConsent} cloudConsentBusy={cloudConsentBusy} onCloudConsentChange={(enabled) => { void setCloudConsent(enabled); }} result={aiResult} error={aiError} />
            )}
          </section>
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
              bootstrap && (bootstrap.counts.observations || bootstrap.counts.samples || bootstrap.counts.activities)
            )}
            onDownload={() => { void downloadPdfReport(); }}
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
          onEditProfile={(profileId) => { void editProfile(profileId); }}
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

      {manualGroupSaveDialog ? (
        <ManualGroupSaveDialog
          open={true}
          defaultGroup={manualObservationGroup}
          rowCount={manualRows.length}
          groupName={manualGroupSaveDialog.groupName}
          onGroupNameChange={(groupName) => setManualGroupSaveDialog({ groupName })}
          onSave={() => {
            const groupName = manualGroupSaveDialog.groupName.trim();
            if (!groupName) return;
            setManualGroupSaveDialog(null);
            void importManualObservations(groupName);
          }}
          onSkip={() => {
            setManualGroupSaveDialog(null);
            void importManualObservations(manualObservationGroup);
          }}
          onCancel={() => setManualGroupSaveDialog(null)}
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
  if (pathname === "/insights" || pathname.startsWith("/insights/")) return "insights";
  if (pathname === "/track" || pathname.startsWith("/track/")) return "track";
  if (pathname === "/import" || pathname.startsWith("/import/") || pathname === "/labs") return "import";
  if (pathname === "/export") return "export";
  if (pathname === "/settings") return "settings";
  return "dashboard";
}

function insightsTabFromPathname(pathname: string): InsightsTab {
  if (pathname === "/insights/ai-query") return "ai-query";
  return "biological-age";
}

function summaryDetailCodeFromPathname(pathname: string): string | undefined {
  const prefix = pathname.startsWith("/track/") ? "/track/" : undefined;
  if (!prefix) return undefined;
  const raw = pathname.slice(prefix.length);
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

function insightsPath(tab: InsightsTab): string {
  return `/insights/${tab}`;
}

function trackPath(measurementCode?: string): string {
  return measurementCode ? `/track/${encodeURIComponent(measurementCode)}` : "/track";
}

// ─── Manual lab helpers ───────────────────────────────────────────────────────

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
  observationGroup,
  labName,
  rows,
  knownMeasurements
}: {
  collectedAt: string;
  observationGroup: string;
  labName: string;
  rows: ManualMarkerRow[];
  knownMeasurements: MeasurementType[];
}): ManualObservationPayload {
  if (!collectedAt) throw new Error("Collection date is required.");
  if (!observationGroup.trim()) throw new Error("Observation group is required.");
  const observations = rows
    .map((row) => {
      const markerName = row.marker.trim();
      const hasRowData = markerName || row.value.trim() || row.unit.trim();
      if (!hasRowData) return undefined;
      const value = Number.parseFloat(row.value);
      if (!Number.isFinite(value)) throw new Error(`Enter a numeric value for ${markerName || "all rows"}.`);
      const known =
        findKnownMeasurement(row.measurementCode?.trim() || "", knownMeasurements) ??
        findKnownMeasurement(markerName, knownMeasurements);
      return {
        measurementName: markerName || known?.display,
        measurementCode: row.measurementCode?.trim() || known?.code,
        value,
        unit: row.unit.trim() || known?.canonicalUnit
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (observations.length === 0) throw new Error("Enter at least one observation row before import.");
  return { observedAt: collectedAt, label: observationGroup.trim(), sourceName: labName.trim() || undefined, observations };
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

function createEmptyRow(marker = "", measurementCode = "", value = "", unit = ""): ManualMarkerRow {
  return { id: globalThis.crypto.randomUUID(), marker, measurementCode, value, unit };
}

function normalizeManualGroupLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
