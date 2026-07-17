import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AnalyticsSummary, AppBootstrap, HealthDataDetail, HealthDataSummary } from "@local-fitness-advisor/shared";
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
    refreshAfterImport,
    clearTransientData,
    disconnect
  }), [
    analytics, bootstrap, clearTransientData, connection, connectionState, dashboardLoading, demoMode,
    disconnect, error, healthDataDetail, refreshAfterImport, refreshDashboard, refreshTrack, reloadConnection,
    setDemoMode, summary, trackLoading, transientRevision
  ]);
  return <MobileApiContext.Provider value={value}>{children}</MobileApiContext.Provider>;
}

export function useMobileApi(): MobileApiContextValue {
  const value = useContext(MobileApiContext);
  if (!value) throw new Error("useMobileApi must be used inside MobileApiProvider.");
  return value;
}
