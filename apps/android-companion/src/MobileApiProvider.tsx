import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type {
  AnalyticsSummary,
  AppBootstrap,
  CareItemListQuery,
  CreateCareItemInput,
  CreateHealthEventInput,
  HealthDataDetail,
  HealthDataSummary,
  HealthEventListQuery,
  ManualObservationPayload,
  UpdateObservationInput
} from "@vitana/shared";
import { clearConnection, clearSelectedProfileId, loadConnection } from "./endpointStore";
import type { ConnectionDetails } from "./endpointStore";
import { createCompanionApi } from "./api";
import { pinnedFetch } from "./pinnedFetch";
import { connectionStateForError, type ConnectionState } from "./connectionState";
import type {
  CompanionCareService,
  CompanionDataSource,
  CompanionLifecycleService,
  CompanionMaintenanceService,
  DetailPage
} from "./companionDataSource";
import { createDemoDataSource } from "./demoDataSource";
import { loadDemoMode, saveDemoMode } from "./demoModeStore";
import {
  loadOperatingMode,
  resolveOperatingMode,
  saveOperatingMode,
  shouldCreateStandaloneSource,
  type CompanionOperatingMode
} from "./operatingModeStore";
import type { CompanionMutationService } from "./companionDataSource";
import type { CompanionObservationMutationService } from "./companionDataSource";
import { createStandaloneDataSource } from "./standalone/standaloneDataSource";

export type { ConnectionState } from "./connectionState";

interface MobileApiContextValue {
  connection: ConnectionDetails | null;
  connectionState: ConnectionState;
  demoMode: boolean;
  operatingMode: CompanionOperatingMode;
  standaloneMode: boolean;
  bootstrap?: AppBootstrap;
  analytics?: AnalyticsSummary;
  summary?: HealthDataSummary;
  dashboardLoading: boolean;
  trackLoading: boolean;
  error?: string;
  transientRevision: number;
  reloadConnection(): Promise<void>;
  setDemoMode(enabled: boolean): Promise<void>;
  setOperatingMode(mode: CompanionOperatingMode): Promise<void>;
  refreshDashboard(): Promise<void>;
  refreshTrack(): Promise<void>;
  healthDataDetail(measurementCode: string, page?: DetailPage): Promise<HealthDataDetail>;
  importManualObservations(payload: ManualObservationPayload): Promise<unknown>;
  updateObservation(id: string, input: UpdateObservationInput): Promise<void>;
  deleteObservation(id: string): Promise<void>;
  resetStandaloneData(): Promise<void>;
  listHealthEvents(query?: HealthEventListQuery): Promise<Awaited<ReturnType<CompanionCareService["listHealthEvents"]>>>;
  createHealthEvent(payload: CreateHealthEventInput): Promise<void>;
  updateHealthEvent(id: string, payload: CreateHealthEventInput): Promise<void>;
  deleteHealthEvent(id: string): Promise<void>;
  listCareItems(query?: CareItemListQuery): Promise<Awaited<ReturnType<CompanionCareService["listCareItems"]>>>;
  createCareItem(payload: CreateCareItemInput): Promise<void>;
  updateCareItem(id: string, payload: CreateCareItemInput): Promise<void>;
  deleteCareItem(id: string): Promise<void>;
  refreshAfterImport(): Promise<void>;
  clearTransientData(): void;
  disconnect(): Promise<void>;
}

const MobileApiContext = createContext<MobileApiContextValue | undefined>(undefined);

export function MobileApiProvider({ children }: { children: React.ReactNode }) {
  const [connection, setConnection] = useState<ConnectionDetails | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [demoMode, setDemoModeState] = useState(false);
  const [operatingMode, setOperatingModeState] = useState<CompanionOperatingMode>("standalone");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [summary, setSummary] = useState<HealthDataSummary>();
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [transientRevision, setTransientRevision] = useState(0);
  const generation = useRef(0);
  const demoSource = useMemo(() => createDemoDataSource(), []);
  const standaloneSource = useMemo(
    () => shouldCreateStandaloneSource(preferencesLoaded, operatingMode, demoMode)
      ? createStandaloneDataSource()
      : undefined,
    [demoMode, operatingMode, preferencesLoaded]
  );
  const source = useMemo<CompanionDataSource | undefined>(() => {
    if (!preferencesLoaded) return undefined;
    if (demoMode) return demoSource;
    if (operatingMode === "standalone") return standaloneSource;
    return connection?.token ? createCompanionApi(connection) : undefined;
  }, [connection, demoMode, demoSource, operatingMode, preferencesLoaded, standaloneSource]);

  const clearHealthData = useCallback(() => {
    setBootstrap(undefined);
    setAnalytics(undefined);
    setSummary(undefined);
  }, []);

  const classifyError = useCallback((caught: unknown) => {
    setConnectionState(connectionStateForError(caught));
    setError(caught instanceof Error ? caught.message : "Unable to reach the paired PC.");
  }, []);

  const reloadConnection = useCallback(async () => {
    const next = await loadConnection();
    generation.current += 1;
    setConnection(next);
    clearHealthData();
    setError(undefined);
    setConnectionState(demoMode || operatingMode === "standalone" ? "online" : next?.token ? "connecting" : "unpaired");
  }, [clearHealthData, demoMode, operatingMode]);

  const setDemoMode = useCallback(async (enabled: boolean) => {
    await saveDemoMode(enabled);
    generation.current += 1;
    setDemoModeState(enabled);
    clearHealthData();
    setError(undefined);
    setConnectionState(enabled || operatingMode === "standalone" ? "online" : connection?.token ? "connecting" : "unpaired");
  }, [clearHealthData, connection, operatingMode]);

  const setOperatingMode = useCallback(async (mode: CompanionOperatingMode) => {
    if (mode === "connected" && !connection?.token) throw new Error("Pair with a PC before using Connected mode.");
    await saveOperatingMode(mode);
    generation.current += 1;
    setOperatingModeState(mode);
    clearHealthData();
    setError(undefined);
    setConnectionState(mode === "standalone" ? "online" : "connecting");
  }, [clearHealthData, connection]);

  const refreshDashboard = useCallback(async () => {
    if (!source) return;
    const requestGeneration = generation.current;
    setDashboardLoading(true);
    setError(undefined);
    try {
      const [nextBootstrap, nextAnalytics] = await Promise.all([source.bootstrap(), source.analytics()]);
      if (generation.current !== requestGeneration) return;
      setBootstrap(nextBootstrap);
      setAnalytics(nextAnalytics);
      setConnectionState("online");
    } catch (caught) {
      if (generation.current === requestGeneration) classifyError(caught);
    } finally {
      if (generation.current === requestGeneration) setDashboardLoading(false);
    }
  }, [classifyError, source]);

  const refreshTrack = useCallback(async () => {
    if (!source) return;
    const requestGeneration = generation.current;
    setTrackLoading(true);
    setError(undefined);
    try {
      const nextSummary = await source.summary();
      if (generation.current !== requestGeneration) return;
      setSummary(nextSummary);
      setConnectionState("online");
    } catch (caught) {
      if (generation.current === requestGeneration) classifyError(caught);
    } finally {
      if (generation.current === requestGeneration) setTrackLoading(false);
    }
  }, [classifyError, source]);

  const healthDataDetail = useCallback(async (measurementCode: string, page?: DetailPage) => {
    if (!source) throw new Error("Health data is unavailable while the companion is disconnected.");
    return source.healthDataDetail(measurementCode, page);
  }, [source]);

  const importManualObservations = useCallback(async (payload: ManualObservationPayload) => {
    if (!source) throw new Error("Manual import is unavailable until a data source is ready.");
    const mutations = source as Partial<CompanionMutationService>;
    if (mutations.importManualObservations) return mutations.importManualObservations(payload);
    if (!connection?.token) throw new Error("Pair with a PC before importing readings.");
    return createCompanionApi(connection).importManualObservations(payload);
  }, [connection, source]);

  const updateObservation = useCallback(async (id: string, input: UpdateObservationInput) => {
    await requireObservationMutationService(source).updateObservation(id, input);
  }, [source]);

  const deleteObservation = useCallback(async (id: string) => {
    await requireObservationMutationService(source).deleteObservation(id);
  }, [source]);

  const resetStandaloneData = useCallback(async () => {
    if (operatingMode !== "standalone" || !standaloneSource) throw new Error("Switch to Standalone mode before resetting local storage.");
    await (standaloneSource as CompanionMaintenanceService).resetLocalData();
    generation.current += 1;
    clearHealthData();
    setError(undefined);
    setConnectionState("online");
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [clearHealthData, operatingMode, refreshDashboard, refreshTrack, standaloneSource]);

  const listHealthEvents = useCallback(async (query?: HealthEventListQuery) => {
    return requireCareService(source).listHealthEvents(query);
  }, [source]);

  const createHealthEvent = useCallback(async (payload: CreateHealthEventInput) => {
    await requireCareService(source).createHealthEvent(payload);
  }, [source]);

  const updateHealthEvent = useCallback(async (id: string, payload: CreateHealthEventInput) => {
    await requireCareService(source).updateHealthEvent(id, payload);
  }, [source]);

  const deleteHealthEvent = useCallback(async (id: string) => {
    await requireCareService(source).deleteHealthEvent(id);
  }, [source]);

  const listCareItems = useCallback(async (query?: CareItemListQuery) => {
    return requireCareService(source).listCareItems(query);
  }, [source]);

  const createCareItem = useCallback(async (payload: CreateCareItemInput) => {
    await requireCareService(source).createCareItem(payload);
  }, [source]);

  const updateCareItem = useCallback(async (id: string, payload: CreateCareItemInput) => {
    await requireCareService(source).updateCareItem(id, payload);
  }, [source]);

  const deleteCareItem = useCallback(async (id: string) => {
    await requireCareService(source).deleteCareItem(id);
  }, [source]);

  const refreshAfterImport = useCallback(async () => {
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [refreshDashboard, refreshTrack]);

  const clearTransientData = useCallback(() => {
    setTransientRevision((current) => current + 1);
  }, []);

  const disconnect = useCallback(async () => {
    if (demoMode || !connection?.token) return;
    try {
      await pinnedFetch(`${connection.url.replace(/\/+$/, "")}/api/pairing/revoke-self`, connection.publicKeyHash, {
        method: "POST",
        headers: { "x-companion-token": connection.token }
      });
    } catch {
      // Local unpairing must remain available when the paired PC is offline.
    }
    generation.current += 1;
    await Promise.all([clearConnection(), clearSelectedProfileId()]);
    setConnection(null);
    setConnectionState("unpaired");
    clearHealthData();
    clearTransientData();
  }, [clearHealthData, clearTransientData, connection, demoMode]);

  useEffect(() => {
    let current = true;
    void Promise.all([loadConnection(), loadDemoMode(), loadOperatingMode()]).then(([nextConnection, nextDemoMode, storedMode]) => {
      if (!current) return;
      const nextOperatingMode = resolveOperatingMode(storedMode, Boolean(nextConnection?.token));
      generation.current += 1;
      setConnection(nextConnection);
      setDemoModeState(nextDemoMode);
      setOperatingModeState(nextOperatingMode);
      setConnectionState(nextDemoMode || nextOperatingMode === "standalone" ? "online" : nextConnection?.token ? "connecting" : "unpaired");
      setPreferencesLoaded(true);
      if (!storedMode) void saveOperatingMode(nextOperatingMode).catch(() => undefined);
    });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (source) void Promise.all([refreshDashboard(), refreshTrack()]);
  }, [source, refreshDashboard, refreshTrack]);
  useEffect(() => () => {
    void (source as Partial<CompanionLifecycleService> | undefined)?.dispose?.();
  }, [source]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") clearTransientData();
    });
    return () => subscription.remove();
  }, [clearTransientData]);

  const value = useMemo<MobileApiContextValue>(() => ({
    connection,
    connectionState,
    demoMode,
    operatingMode,
    standaloneMode: operatingMode === "standalone",
    bootstrap,
    analytics,
    summary,
    dashboardLoading,
    trackLoading,
    error,
    transientRevision,
    reloadConnection,
    setDemoMode,
    setOperatingMode,
    refreshDashboard,
    refreshTrack,
    healthDataDetail,
    importManualObservations,
    updateObservation,
    deleteObservation,
    resetStandaloneData,
    listHealthEvents,
    createHealthEvent,
    updateHealthEvent,
    deleteHealthEvent,
    listCareItems,
    createCareItem,
    updateCareItem,
    deleteCareItem,
    refreshAfterImport,
    clearTransientData,
    disconnect
  }), [
    analytics, bootstrap, clearTransientData, connection, connectionState, createCareItem, createHealthEvent,
    dashboardLoading, deleteCareItem, deleteHealthEvent, deleteObservation, demoMode, disconnect, error, healthDataDetail,
  importManualObservations, listCareItems, listHealthEvents, operatingMode, refreshAfterImport, refreshDashboard,
  refreshTrack, reloadConnection, resetStandaloneData, setDemoMode, setOperatingMode, summary, trackLoading,
  transientRevision, updateCareItem, updateHealthEvent, updateObservation
  ]);
  return <MobileApiContext.Provider value={value}>{children}</MobileApiContext.Provider>;
}

export function useMobileApi(): MobileApiContextValue {
  const value = useContext(MobileApiContext);
  if (!value) throw new Error("useMobileApi must be used inside MobileApiProvider.");
  return value;
}

function requireCareService(source: CompanionDataSource | undefined): CompanionCareService {
  const candidate = source as Partial<CompanionCareService> | undefined;
  if (
    !candidate?.listHealthEvents || !candidate.createHealthEvent || !candidate.updateHealthEvent ||
    !candidate.deleteHealthEvent || !candidate.listCareItems || !candidate.createCareItem ||
    !candidate.updateCareItem || !candidate.deleteCareItem
  ) {
    throw new Error("Switch to Connected mode to use Care.");
  }
  return candidate as CompanionCareService;
}

function requireObservationMutationService(
  source: CompanionDataSource | undefined
): CompanionObservationMutationService {
  const candidate = source as Partial<CompanionObservationMutationService> | undefined;
  if (!candidate?.updateObservation || !candidate.deleteObservation) {
    throw new Error("Observation editing is unavailable until a writable data source is ready.");
  }
  return candidate as CompanionObservationMutationService;
}
