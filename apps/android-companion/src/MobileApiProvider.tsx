import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AnalyticsSummary, AppBootstrap, HealthDataSummary } from "@local-fitness-advisor/shared";
import { clearConnection, clearSelectedProfileId, loadConnection } from "./endpointStore";
import type { ConnectionDetails } from "./endpointStore";
import { createCompanionApi } from "./api";
import { pinnedFetch } from "./pinnedFetch";
import { connectionStateForError, type ConnectionState } from "./connectionState";

export type { ConnectionState } from "./connectionState";

interface MobileApiContextValue {
  connection: ConnectionDetails | null;
  connectionState: ConnectionState;
  bootstrap?: AppBootstrap;
  analytics?: AnalyticsSummary;
  summary?: HealthDataSummary;
  dashboardLoading: boolean;
  trackLoading: boolean;
  error?: string;
  transientRevision: number;
  reloadConnection(): Promise<void>;
  refreshDashboard(): Promise<void>;
  refreshTrack(): Promise<void>;
  refreshAfterImport(): Promise<void>;
  clearTransientData(): void;
  disconnect(): Promise<void>;
}

const MobileApiContext = createContext<MobileApiContextValue | undefined>(undefined);

export function MobileApiProvider({ children }: { children: React.ReactNode }) {
  const [connection, setConnection] = useState<ConnectionDetails | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [summary, setSummary] = useState<HealthDataSummary>();
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [transientRevision, setTransientRevision] = useState(0);
  const generation = useRef(0);
  const client = useMemo(() => connection?.token ? createCompanionApi(connection) : undefined, [connection]);

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
    setConnectionState(next?.token ? "connecting" : "unpaired");
  }, [clearHealthData]);

  const refreshDashboard = useCallback(async () => {
    if (!client) return;
    const requestGeneration = generation.current;
    setDashboardLoading(true);
    setError(undefined);
    try {
      const [nextBootstrap, nextAnalytics] = await Promise.all([client.bootstrap(), client.analytics()]);
      if (generation.current !== requestGeneration) return;
      setBootstrap(nextBootstrap);
      setAnalytics(nextAnalytics);
      setConnectionState("online");
    } catch (caught) {
      if (generation.current === requestGeneration) classifyError(caught);
    } finally {
      if (generation.current === requestGeneration) setDashboardLoading(false);
    }
  }, [classifyError, client]);

  const refreshTrack = useCallback(async () => {
    if (!client) return;
    const requestGeneration = generation.current;
    setTrackLoading(true);
    setError(undefined);
    try {
      const nextSummary = await client.summary();
      if (generation.current !== requestGeneration) return;
      setSummary(nextSummary);
      setConnectionState("online");
    } catch (caught) {
      if (generation.current === requestGeneration) classifyError(caught);
    } finally {
      if (generation.current === requestGeneration) setTrackLoading(false);
    }
  }, [classifyError, client]);

  const refreshAfterImport = useCallback(async () => {
    await Promise.all([refreshDashboard(), refreshTrack()]);
  }, [refreshDashboard, refreshTrack]);

  const clearTransientData = useCallback(() => {
    setTransientRevision((current) => current + 1);
  }, []);

  const disconnect = useCallback(async () => {
    if (!connection?.token) return;
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
  }, [clearHealthData, clearTransientData, connection]);

  useEffect(() => { void reloadConnection(); }, [reloadConnection]);
  useEffect(() => {
    if (client) void Promise.all([refreshDashboard(), refreshTrack()]);
  }, [client, refreshDashboard, refreshTrack]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") clearTransientData();
    });
    return () => subscription.remove();
  }, [clearTransientData]);

  const value = useMemo<MobileApiContextValue>(() => ({
    connection,
    connectionState,
    bootstrap,
    analytics,
    summary,
    dashboardLoading,
    trackLoading,
    error,
    transientRevision,
    reloadConnection,
    refreshDashboard,
    refreshTrack,
    refreshAfterImport,
    clearTransientData,
    disconnect
  }), [
    analytics, bootstrap, clearTransientData, connection, connectionState, dashboardLoading,
    disconnect, error, refreshAfterImport, refreshDashboard, refreshTrack, reloadConnection,
    summary, trackLoading, transientRevision
  ]);
  return <MobileApiContext.Provider value={value}>{children}</MobileApiContext.Provider>;
}

export function useMobileApi(): MobileApiContextValue {
  const value = useContext(MobileApiContext);
  if (!value) throw new Error("useMobileApi must be used inside MobileApiProvider.");
  return value;
}
