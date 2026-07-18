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
  HealthEventListQuery
} from "@local-fitness-advisor/shared";
import { clearConnection, clearSelectedProfileId, loadConnection } from "./endpointStore";
import type { ConnectionDetails } from "./endpointStore";
import { createCompanionApi } from "./api";
import { pinnedFetch } from "./pinnedFetch";
import { connectionStateForError, type ConnectionState } from "./connectionState";
import type { CompanionDataSource, DetailPage } from "./companionDataSource";
import { createDemoDataSource } from "./demoDataSource";
import { loadDemoMode, saveDemoMode } from "./demoModeStore";

export type { ConnectionState } from "./connectionState";

interface MobileApiContextValue {
  connection: ConnectionDetails | null;
  connectionState: ConnectionState;
  demoMode: boolean;
  bootstrap?: AppBootstrap;
  analytics?: AnalyticsSummary;
  summary?: HealthDataSummary;
  dashboardLoading: boolean;
  trackLoading: boolean;
  error?: string;
  transientRevision: number;
  reloadConnection(): Promise<void>;
  setDemoMode(enabled: boolean): Promise<void>;
  refreshDashboard(): Promise<void>;
  refreshTrack(): Promise<void>;
  healthDataDetail(measurementCode: string, page?: DetailPage): Promise<HealthDataDetail>;
  listHealthEvents(query?: HealthEventListQuery): Promise<Awaited<ReturnType<CompanionDataSource["listHealthEvents"]>>>;
  createHealthEvent(payload: CreateHealthEventInput): Promise<void>;
  updateHealthEvent(id: string, payload: CreateHealthEventInput): Promise<void>;
  deleteHealthEvent(id: string): Promise<void>;
  listCareItems(query?: CareItemListQuery): Promise<Awaited<ReturnType<CompanionDataSource["listCareItems"]>>>;
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
  const source = useMemo<CompanionDataSource | undefined>(() => {
    if (!preferencesLoaded) return undefined;
    if (demoMode) return demoSource;
    return connection?.token ? createCompanionApi(connection) : undefined;
  }, [connection, demoMode, demoSource, preferencesLoaded]);

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
    setConnectionState(demoMode ? "online" : next?.token ? "connecting" : "unpaired");
  }, [clearHealthData, demoMode]);

  const setDemoMode = useCallback(async (enabled: boolean) => {
    await saveDemoMode(enabled);
    generation.current += 1;
    setDemoModeState(enabled);
    clearHealthData();
    setError(undefined);
    setConnectionState(enabled ? "online" : connection?.token ? "connecting" : "unpaired");
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

  const listHealthEvents = useCallback(async (query?: HealthEventListQuery) => {
    if (!source) throw new Error("Care data is unavailable while the companion is disconnected.");
    return source.listHealthEvents(query);
  }, [source]);

  const createHealthEvent = useCallback(async (payload: CreateHealthEventInput) => {
    if (!source) throw new Error("Care data is unavailable while the companion is disconnected.");
    await source.createHealthEvent(payload);
  }, [source]);

  const updateHealthEvent = useCallback(async (id: string, payload: CreateHealthEventInput) => {
    if (!source) throw new Error("Care data is unavailable while the companion is disconnected.");
    await source.updateHealthEvent(id, payload);
  }, [source]);

  const deleteHealthEvent = useCallback(async (id: string) => {
    if (!source) throw new Error("Care data is unavailable while the companion is disconnected.");
    await source.deleteHealthEvent(id);
  }, [source]);

  const listCareItems = useCallback(async (query?: CareItemListQuery) => {
    if (!source) throw new Error("Care data is unavailable while the companion is disconnected.");
    return source.listCareItems(query);
  }, [source]);

  const createCareItem = useCallback(async (payload: CreateCareItemInput) => {
    if (!source) throw new Error("Care data is unavailable while the companion is disconnected.");
    await source.createCareItem(payload);
  }, [source]);

  const updateCareItem = useCallback(async (id: string, payload: CreateCareItemInput) => {
    if (!source) throw new Error("Care data is unavailable while the companion is disconnected.");
    await source.updateCareItem(id, payload);
  }, [source]);

  const deleteCareItem = useCallback(async (id: string) => {
    if (!source) throw new Error("Care data is unavailable while the companion is disconnected.");
    await source.deleteCareItem(id);
  }, [source]);

  const refreshAfterImport = useCallback(async () => {
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [refreshDashboard, refreshTrack]);

  const clearTransientData = useCallback(() => {
    setTransientRevision((current) => current + 1);
  }, []);

  const disconnect = useCallback(async () => {
    if (demoMode || !connection?.token) return;
    await pinnedFetch(`${connection.url.replace(/\/+$/, "")}/api/pairing/revoke-self`, connection.publicKeyHash, {
      method: "POST",
      headers: { "x-companion-token": connection.token }
    });
    generation.current += 1;
    await Promise.all([clearConnection(), clearSelectedProfileId()]);
    setConnection(null);
    setConnectionState("unpaired");
    clearHealthData();
    clearTransientData();
  }, [clearHealthData, clearTransientData, connection, demoMode]);

  useEffect(() => {
    let current = true;
    void Promise.all([loadConnection(), loadDemoMode()]).then(([nextConnection, nextDemoMode]) => {
      if (!current) return;
      generation.current += 1;
      setConnection(nextConnection);
      setDemoModeState(nextDemoMode);
      setConnectionState(nextDemoMode ? "online" : nextConnection?.token ? "connecting" : "unpaired");
      setPreferencesLoaded(true);
    });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (source) void Promise.all([refreshDashboard(), refreshTrack()]);
  }, [source, refreshDashboard, refreshTrack]);
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
    bootstrap,
    analytics,
    summary,
    dashboardLoading,
    trackLoading,
    error,
    transientRevision,
    reloadConnection,
    setDemoMode,
    refreshDashboard,
    refreshTrack,
    healthDataDetail,
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
    dashboardLoading, deleteCareItem, deleteHealthEvent, demoMode, disconnect, error, healthDataDetail,
    listCareItems, listHealthEvents, refreshAfterImport, refreshDashboard, refreshTrack, reloadConnection,
    setDemoMode, summary, trackLoading, transientRevision, updateCareItem, updateHealthEvent
  ]);
  return <MobileApiContext.Provider value={value}>{children}</MobileApiContext.Provider>;
}

export function useMobileApi(): MobileApiContextValue {
  const value = useContext(MobileApiContext);
  if (!value) throw new Error("useMobileApi must be used inside MobileApiProvider.");
  return value;
}
